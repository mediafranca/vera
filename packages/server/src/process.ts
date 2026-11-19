// Procesar una página: leerla y decir qué se ve en ella.
//
// Salen proposiciones y ninguna decisión. @invariant ProcessingProposesAndNothing-
// More, de controlled-ontology.allium: lo que esto deja son sugerencias, y una
// página procesada y luego ignorada es exactamente la página que era.
//
// @invariant ReachingOutIsAnOutwardAct: resolver un enlace es preguntarle al
// servidor que lo tiene, y preguntar le dice a ese servidor que aquí alguien está
// leyendo sobre esto. Por eso ocurre porque se pidió, sobre la página que se
// pidió, y queda dicho qué se preguntó.

import { setTimeout as delay } from 'node:timers/promises';

/** Lo que se averiguó de una dirección. */
export interface LinkReading {
  url: string;
  /** El título que el documento declara, si lo declara. */
  title: string | null;
  /** Qué parece ser, por lo que el servidor dijo que era. */
  kind: 'página' | 'imagen' | 'pdf' | 'vídeo' | 'audio' | 'archivo' | null;
  /** Por qué no se pudo, cuando no se pudo. */
  unreachable: string | null;
}

export interface PageReading {
  links: LinkReading[];
  /** Qué parte no se pudo hacer y por qué. Nunca se calla un resultado parcial. */
  notDone: string[];
}

/**
 * Las direcciones que un texto nombra.
 *
 * Sin los paréntesis y comillas de cierre que el Markdown pone alrededor: una
 * URL dentro de `[texto](url)` termina en el paréntesis, y llevárselo produciría
 * una petición a una dirección que nadie escribió.
 */
export function urlsIn(text: string): string[] {
  const found = new Set<string>();
  // Los invisibles van primero: el corpus trae direcciones pegadas a un espacio
  // de ancho cero (U+200B) y a marcas de dirección de texto, que `\s` no cuenta
  // como espacio. Sin quitarlos, el recorte se detiene antes de llegar al
  // paréntesis y se pide una dirección que nadie escribió.
  const CLOSERS = '.,;:!?»"\'’]​‌‍⁠﻿‎‏';

  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    let url = match[0];
    // Se recorta desde el final, de a un carácter, mientras lo último sea
    // puntuación de cierre. Un paréntesis se queda si la propia dirección lo
    // abrió —`Mercurio_(planeta)` en Wikipedia— y se va si lo abrió el Markdown
    // de alrededor: `[algo](url)` deja un `)` que nadie escribió como parte de
    // la dirección.
    for (;;) {
      const last = url.at(-1);
      if (last === undefined) break;
      if (last === ')') {
        const opens = (url.match(/\(/g) ?? []).length;
        const closes = (url.match(/\)/g) ?? []).length;
        if (opens >= closes) break;
      } else if (!CLOSERS.includes(last)) {
        break;
      }
      url = url.slice(0, -1);
    }
    if (url !== '') found.add(url);
  }
  return [...found];
}

const KINDS: { test: RegExp; kind: LinkReading['kind'] }[] = [
  { test: /^text\/html/, kind: 'página' },
  { test: /^image\//, kind: 'imagen' },
  { test: /^application\/pdf/, kind: 'pdf' },
  { test: /^video\//, kind: 'vídeo' },
  { test: /^audio\//, kind: 'audio' },
];

/** El título que un HTML declara. Nada más: no se interpreta la página. */
function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  if (match === null) return null;
  const raw = (match[1] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  return raw === '' ? null : raw;
}

/**
 * Le pregunta a una dirección qué es.
 *
 * Se traen como mucho 64 KB: el título va en la cabecera del documento, y
 * descargar un vídeo entero para leer su primera línea sería absurdo y además
 * caro para el servidor al que se le pide.
 */
async function read(url: string, timeoutMs: number): Promise<LinkReading> {
  const reading: LinkReading = { url, title: null, kind: null, unreachable: null };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    reading.unreachable = 'no es una dirección válida';
    return reading;
  }
  // Sólo hacia fuera. Una dirección que apunta a esta misma máquina o a la red
  // local haría que Vera pidiera cosas en nombre de quien escribió el enlace, y
  // un enlace puede haberlo escrito cualquiera que participe en el grafo.
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[?::1)/.test(parsed.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(parsed.hostname)) {
    reading.unreachable = 'apunta a esta red; no se consulta';
    return reading;
  }

  const stop = AbortSignal.timeout(timeoutMs);
  try {
    const answer = await fetch(url, {
      signal: stop,
      redirect: 'follow',
      headers: {
        // Se dice qué es quien pregunta. Fingir un navegador para sortear un
        // bloqueo sería entrar donde a uno no lo quieren.
        'user-agent': 'Vera/0.2 (memoria personal; resolviendo un enlace citado)',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.5',
      },
    });

    const type = answer.headers.get('content-type') ?? '';
    reading.kind = KINDS.find((k) => k.test.test(type))?.kind ?? 'archivo';

    if (!answer.ok) {
      reading.unreachable = `el servidor respondió ${answer.status}`;
      return reading;
    }
    if (reading.kind !== 'página') return reading;

    const body = answer.body;
    if (body === null) return reading;
    let html = '';
    const reader = body.getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      html += Buffer.from(chunk as Uint8Array).toString('utf8');
      if (html.length > 64 * 1024 || /<\/title>/i.test(html)) break;
    }
    await reader.cancel().catch(() => undefined);
    reading.title = titleOf(html);
  } catch (error) {
    reading.unreachable =
      stop.aborted ? 'no respondió a tiempo' : error instanceof Error ? error.message : 'no se pudo alcanzar';
  }
  return reading;
}

export interface ProcessOptions {
  timeoutMs?: number;
  /** Cuántas se preguntan a la vez. Pocas: no se atropella a nadie. */
  concurrency?: number;
  /** Tope de direcciones por página, para que procesar termine siempre. */
  limit?: number;
}

/**
 * Lee las direcciones de un texto.
 *
 * De a poco y con pausa entre tandas: una página con cuarenta enlaces no puede
 * convertirse en cuarenta peticiones simultáneas a servidores que no pidieron
 * nada.
 */
export async function readLinks(
  text: string,
  options: ProcessOptions = {},
  /** Se llama con cada enlace en cuanto se resuelve, para poder contarlo mientras pasa. */
  onLink?: (link: LinkReading, done: number, total: number) => void,
): Promise<PageReading> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const concurrency = options.concurrency ?? 4;
  const limit = options.limit ?? 40;

  const all = urlsIn(text);
  const urls = all.slice(0, limit);
  const notDone: string[] = [];
  if (all.length > urls.length) {
    // @guarantee ProcessingSaysWhatItDidAndWhatItCouldNot: un recorte callado se
    // lee como un resultado completo.
    notDone.push(`la página nombra ${all.length} direcciones; se consultaron las primeras ${urls.length}`);
  }

  const links: LinkReading[] = [];
  for (let at = 0; at < urls.length; at += concurrency) {
    const batch = urls.slice(at, at + concurrency);
    const read_ = await Promise.all(batch.map((url) => read(url, timeoutMs)));
    for (const link of read_) {
      links.push(link);
      onLink?.(link, links.length, urls.length);
    }
    if (at + concurrency < urls.length) await delay(200);
  }

  return { links, notDone };
}
