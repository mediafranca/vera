import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface SpokenAudio { bytes: Buffer; mediaType: 'audio/wav'; cached: boolean }
export interface SpeechSynthesizer { speak(text: string): Promise<SpokenAudio>; close(): void }

export interface LocalSpeechOptions {
  cacheRoot: string;
  python: string;
  worker: string;
  source: string;
  prompt: string;
  threads?: number;
}

interface Pending { path: string; resolve: (audio: SpokenAudio) => void; reject: (error: Error) => void }

export function createLocalSpeech(options: LocalSpeechOptions): SpeechSynthesizer {
  const cacheRoot = resolve(options.cacheRoot);
  mkdirSync(cacheRoot, { recursive: true });
  let child: ChildProcessWithoutNullStreams | null = null;
  let ready: Promise<void> | null = null;
  const pending = new Map<string, Pending>();

  const failAll = (message: string): void => {
    for (const waiting of pending.values()) waiting.reject(new Error(message));
    pending.clear();
    child = null;
    ready = null;
  };

  const start = (): Promise<void> => {
    if (ready !== null) return ready;
    ready = new Promise<void>((resolveReady, rejectReady) => {
      if (!existsSync(options.python) || !existsSync(options.worker) || !existsSync(options.prompt)) {
        rejectReady(new Error('la voz local no está instalada; ejecuta scripts/setup-local-tts.sh'));
        ready = null;
        return;
      }
      const process = spawn(options.python, [options.worker], {
        env: {
          ...globalThis.process.env,
          VERA_TTS_SOURCE: options.source,
          VERA_TTS_PROMPT: options.prompt,
          VERA_TTS_THREADS: String(options.threads ?? 3),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child = process;
      const lines = createInterface({ input: process.stdout });
      let becameReady = false;
      lines.on('line', (line) => {
        let message: { ready?: boolean; id?: string; ok?: boolean; error?: string };
        try { message = JSON.parse(line) as typeof message; } catch { return; }
        if (message.ready === true && !becameReady) {
          becameReady = true;
          resolveReady();
          return;
        }
        if (message.id === undefined) return;
        const waiting = pending.get(message.id);
        if (waiting === undefined) return;
        pending.delete(message.id);
        if (message.ok === true && existsSync(waiting.path)) {
          waiting.resolve({ bytes: readFileSync(waiting.path), mediaType: 'audio/wav', cached: false });
        } else {
          waiting.reject(new Error(message.error ?? 'la voz local no produjo audio'));
        }
      });
      process.stderr.on('data', () => undefined);
      process.on('error', (error) => {
        if (!becameReady) rejectReady(error);
        failAll(error.message);
      });
      process.on('exit', (code) => {
        const message = `el proceso de voz terminó${code === null ? '' : ` (${code})`}`;
        if (!becameReady) rejectReady(new Error(message));
        failAll(message);
      });
    });
    return ready;
  };

  return {
    async speak(raw) {
      const text = raw.trim().replace(/\s+/g, ' ');
      if (text.length === 0 || text.length > 300) {
        throw new Error('el fragmento debe tener entre 1 y 300 caracteres');
      }
      const key = createHash('sha256').update(`chatterbox-es-mx-f1-v1\0${text}`).digest('hex');
      const path = join(cacheRoot, `${key}.wav`);
      if (existsSync(path)) return { bytes: readFileSync(path), mediaType: 'audio/wav', cached: true };
      await start();
      const id = randomUUID();
      return new Promise<SpokenAudio>((resolveAudio, rejectAudio) => {
        pending.set(id, { path, resolve: resolveAudio, reject: rejectAudio });
        child?.stdin.write(`${JSON.stringify({ id, text, output: path })}\n`);
      });
    },
    close() {
      child?.kill('SIGTERM');
      failAll('la voz local se detuvo');
    },
  };
}
