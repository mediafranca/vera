import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface SpokenAudio { bytes: Buffer; mediaType: 'audio/wav'; cached: boolean }
export interface SpeechSynthesizer {
  speak(text: string, signal?: AbortSignal): Promise<SpokenAudio>;
  close(): void;
}

export interface LocalSpeechOptions {
  cacheRoot: string;
  python: string;
  worker: string;
  modelRoot: string;
  voice?: string;
  threads?: number;
  maxCacheBytes?: number;
  maxCacheAgeMs?: number;
}

export interface SpeechDiagnosis {
  ready: boolean;
  python: string | null;
  worker: string | null;
  modelRoot: string | null;
  voice: string;
  missing: string[];
}

/**
 * Comprueba la instalación sin arrancar el modelo.
 *
 * Un directorio vacío no es una voz instalada. Kokoro necesita el intérprete,
 * el worker versionado, el modelo base y la voz elegida; el Centro de Vera
 * enumera exactamente cuál de esas piezas falta antes de activar el switch.
 */
export function speechDiagnosis(options: LocalSpeechOptions): SpeechDiagnosis {
  const voice = options.voice ?? 'em_alex';
  const files = {
    python: options.python,
    worker: options.worker,
    config: join(options.modelRoot, 'config.json'),
    model: join(options.modelRoot, 'kokoro-v1_0.pth'),
    voice: join(options.modelRoot, 'voices', `${voice}.pt`),
  };
  const missing = Object.entries(files)
    .filter(([, path]) => !existsSync(path))
    .map(([part]) => part);
  return {
    ready: missing.length === 0,
    python: existsSync(files.python) ? files.python : null,
    worker: existsSync(files.worker) ? files.worker : null,
    modelRoot: existsSync(files.config) && existsSync(files.model) ? options.modelRoot : null,
    voice,
    missing,
  };
}

interface Job {
  id: string;
  path: string;
  text: string;
  signal?: AbortSignal;
  onAbort?: () => void;
  settled: boolean;
  resolve: (audio: SpokenAudio) => void;
  reject: (error: Error) => void;
}

function interrupted(message = 'la lectura fue detenida'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function createLocalSpeech(options: LocalSpeechOptions): SpeechSynthesizer {
  const cacheRoot = resolve(options.cacheRoot);
  mkdirSync(cacheRoot, { recursive: true });
  const maxCacheBytes = Number.isFinite(options.maxCacheBytes)
    ? Math.max(0, options.maxCacheBytes as number)
    : 256 * 1024 * 1024;
  const maxCacheAgeMs = Number.isFinite(options.maxCacheAgeMs)
    ? Math.max(0, options.maxCacheAgeMs as number)
    : 30 * 24 * 60 * 60 * 1000;
  let child: ChildProcessWithoutNullStreams | null = null;
  let ready: Promise<void> | null = null;
  let active: Job | null = null;
  let queued: Job | null = null;

  /** El audio es una proyección regenerable: nunca crece sin límite. */
  const pruneCache = (): void => {
    const now = Date.now();
    const entries: Array<{ path: string; size: number; usedAt: number }> = [];
    for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(cacheRoot, entry.name);
      if (entry.name.endsWith('.part')) {
        try { unlinkSync(path); } catch { /* una limpieza no debe tumbar la voz */ }
        continue;
      }
      if (!entry.name.endsWith('.wav')) continue;
      try {
        const said = statSync(path);
        if (now - said.mtimeMs > maxCacheAgeMs) unlinkSync(path);
        else entries.push({ path, size: said.size, usedAt: said.mtimeMs });
      } catch { /* el archivo pudo desaparecer entre listado y lectura */ }
    }
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries.sort((left, right) => left.usedAt - right.usedAt)) {
      if (total <= maxCacheBytes) break;
      try {
        unlinkSync(entry.path);
        total -= entry.size;
      } catch { /* otro proceso ya lo retiró */ }
    }
  };
  pruneCache();

  const detach = (job: Job): void => {
    if (job.signal !== undefined && job.onAbort !== undefined) {
      job.signal.removeEventListener('abort', job.onAbort);
    }
  };
  const reject = (job: Job, error: Error): void => {
    if (job.settled) return;
    job.settled = true;
    detach(job);
    job.reject(error);
  };
  const fulfil = (job: Job, audio: SpokenAudio): void => {
    if (job.settled) return;
    job.settled = true;
    detach(job);
    job.resolve(audio);
  };

  const failProcess = (process: ChildProcessWithoutNullStreams, message: string): void => {
    if (child !== process) return;
    child = null;
    ready = null;
    if (active !== null) reject(active, new Error(message));
    if (queued !== null) reject(queued, new Error(message));
    active = null;
    queued = null;
  };

  const start = (): Promise<void> => {
    if (ready !== null) return ready;
    ready = new Promise<void>((resolveReady, rejectReady) => {
      if (!existsSync(options.python) || !existsSync(options.worker) || !existsSync(options.modelRoot)) {
        rejectReady(new Error('la voz local no está instalada; ejecuta scripts/setup-local-tts.sh'));
        ready = null;
        return;
      }
      const process = spawn(options.python, [options.worker], {
        env: {
          ...globalThis.process.env,
          VERA_TTS_MODEL_ROOT: options.modelRoot,
          VERA_TTS_VOICE: options.voice ?? 'em_alex',
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
        if (message.id === undefined || active?.id !== message.id) return;
        const finished = active;
        active = null;
        if (message.ok === true && existsSync(finished.path)) {
          const bytes = readFileSync(finished.path);
          pruneCache();
          fulfil(finished, { bytes, mediaType: 'audio/wav', cached: false });
        } else {
          reject(finished, new Error(message.error ?? 'la voz local no produjo audio'));
        }
        const next = queued;
        queued = null;
        if (next !== null) void dispatch(next);
      });
      process.stderr.on('data', () => undefined);
      process.on('error', (error) => {
        if (!becameReady) rejectReady(error);
        failProcess(process, error.message);
      });
      process.on('exit', (code) => {
        const message = `el proceso de voz terminó${code === null ? '' : ` (${code})`}`;
        if (!becameReady) rejectReady(new Error(message));
        failProcess(process, message);
      });
    });
    return ready;
  };

  const dispatch = async (job: Job): Promise<void> => {
    const wasAborted = (): boolean => job.signal?.aborted ?? false;
    if (wasAborted()) {
      reject(job, interrupted());
      return;
    }
    active = job;
    try {
      await start();
      if (wasAborted()) {
        reject(job, interrupted());
        active = null;
        const next = queued;
        queued = null;
        if (next !== null) void dispatch(next);
        return;
      }
      child?.stdin.write(`${JSON.stringify({ id: job.id, text: job.text, output: job.path })}\n`);
    } catch (problem) {
      if (active === job) active = null;
      const error = problem instanceof Error ? problem : new Error('la voz local no pudo iniciar');
      reject(job, error);
      if (queued !== null) reject(queued, error);
      queued = null;
    }
  };

  return {
    async speak(raw, signal) {
      const text = raw.trim().replace(/\s+/g, ' ');
      if (text.length === 0 || text.length > 300) {
        throw new Error('el fragmento debe tener entre 1 y 300 caracteres');
      }
      if (signal?.aborted === true) throw interrupted();
      const key = createHash('sha256').update(`kokoro-es-em-alex-v1\0${text}`).digest('hex');
      const path = join(cacheRoot, `${key}.wav`);
      if (existsSync(path)) {
        const bytes = readFileSync(path);
        const now = new Date();
        try { utimesSync(path, now, now); } catch { /* el audio ya está en memoria */ }
        return { bytes, mediaType: 'audio/wav', cached: true };
      }
      return new Promise<SpokenAudio>((resolveAudio, rejectAudio) => {
        const job: Job = {
          id: randomUUID(), path, text, settled: false,
          resolve: resolveAudio, reject: rejectAudio,
          ...(signal === undefined ? {} : { signal }),
        };
        job.onAbort = () => {
          reject(job, interrupted());
          if (queued === job) queued = null;
        };
        signal?.addEventListener('abort', job.onAbort, { once: true });
        if (active === null) {
          void dispatch(job);
          return;
        }
        if (queued !== null) reject(queued, interrupted('la lectura fue reemplazada por otra más reciente'));
        queued = job;
      });
    },
    close() {
      if (active !== null) reject(active, interrupted('la voz local se detuvo'));
      if (queued !== null) reject(queued, interrupted('la voz local se detuvo'));
      active = null;
      queued = null;
      const process = child;
      child = null;
      ready = null;
      process?.kill('SIGTERM');
    },
  };
}
