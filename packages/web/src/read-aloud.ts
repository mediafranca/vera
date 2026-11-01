import { renderMarkdown, type RenderOptions } from '@vera/core';
import { api } from './api.ts';
import { icon } from './icons.ts';
import { countInto, type Counting } from './waiting.ts';

export interface SpeechPart { key: string; text: string }

interface Prepared<T> {
  settled: boolean;
  result: Promise<{ ok: true; value: T } | { ok: false; problem: unknown }>;
}

interface Reading {
  key: string;
  button: HTMLButtonElement;
  controller: AbortController;
  audio: HTMLAudioElement | null;
  count: Counting | null;
  objectUrl: string | null;
}

let current: Reading | null = null;
let generation = 0;

function label(button: HTMLButtonElement, state: 'play' | 'waiting' | 'pause' | 'resume'): void {
  const page = button.classList.contains('read-page');
  const conversation = button.classList.contains('librarian-conversation-read');
  const said = state === 'waiting' ? 'Detener preparación'
    : state === 'pause' ? 'Pausar lectura'
    : state === 'resume' ? 'Continuar lectura'
    : button.dataset['speechLabel']
      ?? (page ? 'Leer página' : conversation ? 'Leer respuesta' : 'Leer bloque');
  button.innerHTML = icon(state === 'pause' ? 'player-pause' : state === 'resume' ? 'player-play' : state === 'waiting' ? 'x' : 'volume');
  button.setAttribute('aria-label', said);
  button.title = said;
  button.dataset['speechState'] = state;
}

function clear(reading: Reading): void {
  reading.count?.close('failed');
  reading.count = null;
  reading.audio?.pause();
  reading.controller.abort();
  if (reading.objectUrl !== null) URL.revokeObjectURL(reading.objectUrl);
  label(reading.button, 'play');
}

export function stopReading(): void {
  generation += 1;
  if (current !== null) clear(current);
  current = null;
}

/** Markdown leído como palabras, nunca como signos de formato o HTML ejecutable. */
export function speechText(source: string, options: RenderOptions = {}): string {
  const host = document.createElement('div');
  host.innerHTML = renderMarkdown(source, options);
  host.querySelectorAll('script, style, audio, video, iframe, canvas, svg').forEach((one) => one.remove());
  return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Corta por frases y, si hace falta, por palabras: Chatterbox admite 300 caracteres. */
export function speechParts(key: string, text: string, maximum = 280): SpeechPart[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  const parts: SpeechPart[] = [];
  let buffer = '';
  const push = (): void => {
    if (buffer !== '') parts.push({ key: `${key}:${parts.length}`, text: buffer });
    buffer = '';
  };
  for (const sentence of sentences.map((one) => one.trim())) {
    if (sentence.length <= maximum) {
      if (buffer === '') buffer = sentence;
      else if (`${buffer} ${sentence}`.length <= maximum) buffer += ` ${sentence}`;
      else { push(); buffer = sentence; }
      continue;
    }
    push();
    for (const word of sentence.split(/\s+/)) {
      const pieces = word.length <= maximum
        ? [word]
        : Array.from({ length: Math.ceil(word.length / maximum) }, (_, index) =>
          word.slice(index * maximum, (index + 1) * maximum));
      for (const piece of pieces) {
        if (buffer === '') buffer = piece;
        else if (`${buffer} ${piece}`.length <= maximum) buffer += ` ${piece}`;
        else { push(); buffer = piece; }
      }
    }
  }
  push();
  return parts;
}

/**
 * Prepara sólo la próxima pieza mientras se consume la actual. Así una lectura
 * larga no parece terminar en cada límite del sintetizador y tampoco llena al
 * trabajador local con una cola oculta.
 */
export async function runSpeechQueue<T>(
  parts: readonly SpeechPart[],
  prepare: (part: SpeechPart) => Promise<T>,
  consume: (value: T, part: SpeechPart) => Promise<void>,
  beforeAwait: (part: SpeechPart, waiting: boolean) => void = () => undefined,
): Promise<void> {
  const begin = (part: SpeechPart): Prepared<T> => {
    const prepared: Prepared<T> = {
      settled: false,
      result: Promise.resolve({ ok: false, problem: new Error('voz sin preparar') }),
    };
    prepared.result = prepare(part)
      .then((value) => ({ ok: true as const, value }), (problem: unknown) => ({ ok: false as const, problem }))
      .finally(() => { prepared.settled = true; });
    return prepared;
  };

  let upcoming = parts[0] === undefined ? null : begin(parts[0]);
  for (let index = 0; index < parts.length && upcoming !== null; index += 1) {
    const part = parts[index] as SpeechPart;
    beforeAwait(part, !upcoming.settled);
    const outcome = await upcoming.result;
    if (!outcome.ok) throw outcome.problem;
    const following = parts[index + 1];
    upcoming = following === undefined ? null : begin(following);
    await consume(outcome.value, part);
  }
}

async function play(blob: Blob, reading: Reading, token: number): Promise<void> {
  if (token !== generation) return;
  const url = URL.createObjectURL(blob);
  reading.objectUrl = url;
  const audio = new Audio(url);
  reading.audio = audio;
  label(reading.button, 'pause');
  await audio.play();
  await new Promise<void>((resolve, reject) => {
    audio.addEventListener('ended', () => resolve(), { once: true });
    audio.addEventListener('error', () => reject(new Error('no se pudo reproducir la voz')), { once: true });
  });
  URL.revokeObjectURL(url);
  reading.objectUrl = null;
  reading.audio = null;
}

export function wireReadingButton(
  button: HTMLButtonElement,
  parts: () => readonly SpeechPart[],
  report: (message: string) => void,
): void {
  label(button, 'play');
  button.addEventListener('click', () => {
    if (current?.button === button && current.audio !== null) {
      if (current.audio.paused) {
        void current.audio.play();
        label(button, 'pause');
      } else {
        current.audio.pause();
        label(button, 'resume');
      }
      return;
    }
    if (current?.button === button) {
      stopReading();
      return;
    }
    stopReading();
    const queue = [...parts()].filter((part) => part.text !== '');
    if (queue.length === 0) {
      report('no hay texto que leer');
      return;
    }
    const token = generation;
    const reading: Reading = {
      key: queue[0]?.key ?? '', button, controller: new AbortController(),
      audio: null, count: null, objectUrl: null,
    };
    current = reading;
    void (async () => {
      try {
        await runSpeechQueue(
          queue,
          (part) => api.speak(part.text, reading.controller.signal),
          async (blob) => {
            reading.count?.close();
            reading.count = null;
            await play(blob, reading, token);
          },
          (part, waiting) => {
            if (token !== generation) return;
            reading.key = part.key;
            if (!waiting) return;
            label(button, 'waiting');
            const wait = document.createElement('span');
            wait.className = 'speech-wait';
            wait.setAttribute('role', 'status');
            wait.setAttribute('aria-live', 'polite');
            button.append(wait);
            reading.count = countInto(wait, 'Preparando voz…', 'speech:kokoro');
          },
        );
      } catch (problem) {
        if (!reading.controller.signal.aborted) {
          report(problem instanceof Error ? problem.message : 'no se pudo leer en voz alta');
        }
      } finally {
        if (current === reading) {
          clear(reading);
          current = null;
        }
      }
    })();
  });
}
