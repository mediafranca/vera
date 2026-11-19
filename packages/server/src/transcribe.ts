// Transcripción local con whisper.cpp.
//
// Corre en esta máquina y nada sale de ella: una memoria personal soberana no
// manda su voz a un servicio ajeno para saber qué dijo.
//
// @invariant EveryLinkIsHumanlyConfirmed: esto sólo PROPONE. Deja la grabación
// en `transcribed`, nunca en validada. Declarar que el texto dice lo que se dijo
// es un acto de una persona, y ninguna máquina puede hacerlo en su nombre.

import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { homedir, platform, tmpdir } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface TranscriberOptions {
  /** El binario de whisper.cpp. */
  command?: string;
  /** El modelo, que decide la calidad y el tiempo. */
  model?: string;
  language?: string;
  /** Tope de espera: una grabación larga no puede colgar una petición. */
  timeoutMs?: number;
  /** El conversor a wav. */
  ffmpeg?: string;
}

const home = homedir();

const DEFAULTS = {
  language: 'es',
  timeoutMs: 10 * 60 * 1000,
  /*
   * `small` cuesta más CPU que `base`, pero mejora bastante nombres propios,
   * frases largas y puntuación en español. En Vera la voz se transcribe de
   * forma explícita y fuera del gesto de grabar, así que aquí manda la calidad;
   * el tiempo se hace visible en la interfaz y no bloquea seguir leyendo.
   */
  model: `${home}/.local/share/whisper/ggml-small.bin`,
};

// El servidor no siempre nace de un shell de inicio de sesión: un lanzador de
// escritorio o un servicio systemd le entregan un PATH mínimo, sin los binarios
// que uno instaló en su propia casa. Buscar aquí también evita que la voz
// dependa de cómo se arrancó el proceso.
const EXTRA_DIRS = [
  join(home, '.local', 'bin'),
  join(home, 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/home/linuxbrew/.linuxbrew/bin',
];

// whisper.cpp cambió de nombre entre versiones: `main` en las viejas,
// `whisper-cli` en las nuevas.
const WHISPER_NAMES = ['whisper-cli', 'whisper-cpp', 'whisper', 'main'];

export type WhisperDialect = 'whisper.cpp' | 'openai-whisper';

interface WhisperRuntime {
  command: string;
  prefix: string[];
  dialect: WhisperDialect;
  model: string;
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Nombres efectivos que Windows resuelve mediante PATHEXT. */
export function executableNames(
  names: readonly string[],
  operatingSystem = platform(),
  pathExt = process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD',
): string[] {
  if (operatingSystem !== 'win32') return [...names];
  const extensions = pathExt.split(';').map((one) => one.trim().toLowerCase()).filter(Boolean);
  return [...new Set(names.flatMap((name) => {
    const lower = name.toLowerCase();
    return extensions.some((extension) => lower.endsWith(extension))
      ? [name]
      : [name, ...extensions.map((extension) => `${name}${extension}`)];
  }))];
}

const childDirectories = (root: string | undefined, child: string): string[] => {
  if (root === undefined || !existsSync(root)) return [];
  try {
    return readdirSync(root)
      .map((name) => join(root, name, child))
      .filter((candidate) => existsSync(candidate) && statSync(candidate).isDirectory());
  } catch {
    return [];
  }
};

/** Directorios usuales que un proceso Desktop de Windows no siempre hereda. */
export function windowsExecutableDirectories(environment = process.env): string[] {
  const local = environment['LOCALAPPDATA'];
  const roaming = environment['APPDATA'];
  const profile = environment['USERPROFILE'];
  return [
    environment['CONDA_PREFIX'] === undefined ? '' : join(environment['CONDA_PREFIX'], 'Scripts'),
    environment['VIRTUAL_ENV'] === undefined ? '' : join(environment['VIRTUAL_ENV'], 'Scripts'),
    profile === undefined ? '' : join(profile, 'scoop', 'shims'),
    environment['ProgramData'] === undefined ? '' : join(environment['ProgramData'], 'chocolatey', 'bin'),
    ...childDirectories(local === undefined ? undefined : join(local, 'Programs', 'Python'), 'Scripts'),
    ...childDirectories(roaming === undefined ? undefined : join(roaming, 'Python'), 'Scripts'),
  ].filter((candidate) => candidate !== '');
}

function toolDirectories(): string[] {
  return [...new Set([
    ...(process.env['PATH'] ?? '').split(delimiter).filter((directory) => directory !== ''),
    ...EXTRA_DIRS,
    ...(platform() === 'win32' ? windowsExecutableDirectories() : []),
  ])];
}

/**
 * Encuentra un binario por nombre, mirando el PATH heredado y además los
 * lugares donde una instalación personal suele dejarlo.
 */
export function findTool(names: string[], override?: string): string | null {
  if (override !== undefined && override !== '') {
    if (isAbsolute(override) && executable(override)) return override;
    names = [override, ...names];
  }
  const dirs = toolDirectories();
  for (const name of executableNames(names)) {
    if (isAbsolute(name)) continue;
    for (const dir of dirs) {
      const candidate = join(dir, name);
      if (executable(candidate)) return candidate;
    }
  }
  return null;
}

async function helpFor(command: string, prefix: readonly string[] = []): Promise<string> {
  try {
    const result = await run(command, [...prefix, '--help'], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    return `${result.stdout}\n${result.stderr}`.toLowerCase();
  } catch (error) {
    return `${String((error as { stdout?: unknown }).stdout ?? '')}\n${String((error as { stderr?: unknown }).stderr ?? '')}`.toLowerCase();
  }
}

function dialectFromHelp(help: string): WhisperDialect | null {
  if (/--output_dir|--output_format/.test(help)) return 'openai-whisper';
  if (/whisper\.cpp|--output-txt|-otxt|\[-m model\]/.test(help)) return 'whisper.cpp';
  return null;
}

const derivedPythonModel = (requested: string): string => {
  const match = /(?:ggml-)?([a-z0-9.-]+?)(?:\.bin|\.pt)?$/i.exec(requested);
  return match?.[1]?.replace(/\.en$/, '.en') || 'small';
};

const cppModelCandidates = (requested: string): string[] => {
  const local = process.env['LOCALAPPDATA'];
  const profile = process.env['USERPROFILE'];
  const modelName = requested === '' || requested.includes('/') || requested.includes('\\')
    ? 'small' : requested.replace(/^ggml-/, '').replace(/\.bin$/, '');
  return [...new Set([
    requested,
    join(home, '.local', 'share', 'whisper', `ggml-${modelName}.bin`),
    local === undefined ? '' : join(local, 'Vera', 'voice', 'whisper', `ggml-${modelName}.bin`),
    profile === undefined ? '' : join(profile, '.cache', 'whisper', `ggml-${modelName}.bin`),
  ].filter(Boolean))];
};

async function discoverWhisper(options: TranscriberOptions): Promise<WhisperRuntime | null> {
  const requested = options.model ?? process.env['VERA_WHISPER_MODEL'] ?? DEFAULTS.model;
  const override = options.command ?? process.env['VERA_WHISPER'];
  const commands = [...new Set([
    ...(override === undefined || override === '' ? [] : [findTool([], override)]),
    ...WHISPER_NAMES.map((name) => findTool([name])),
  ].filter((candidate): candidate is string => candidate !== null))];
  for (const command of commands) {
    const dialect = dialectFromHelp(await helpFor(command));
    if (dialect === null) continue;
    if (dialect === 'openai-whisper') return { command, prefix: [], dialect, model: derivedPythonModel(requested) };
    const model = cppModelCandidates(requested).find((candidate) => existsSync(candidate));
    if (model !== undefined) return { command, prefix: [], dialect, model };
  }
  // Algunas instalaciones de pip no crean el lanzador `whisper.exe`, pero el
  // módulo sigue siendo invocable. En Windows se prueban ambos lanzadores
  // habituales; guardar sólo la ruta a Python perdería el `-m whisper`.
  if (platform() === 'win32') {
    for (const command of [...new Set(['py', 'python'].map((name) => findTool([name])).filter((one): one is string => one !== null))]) {
      if (dialectFromHelp(await helpFor(command, ['-m', 'whisper'])) === 'openai-whisper') {
        return { command, prefix: ['-m', 'whisper'], dialect: 'openai-whisper', model: derivedPythonModel(requested) };
      }
    }
  }
  return null;
}

function whyFailed(error: unknown): string {
  if (error instanceof Error) {
    // execFile cuelga la salida de error del proceso en el error mismo; ahí está
    // el motivo real, y callarlo deja a quien graba sin nada que hacer.
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    if (stderr !== '') {
      const lines = stderr.split('\n').filter((line) => line.trim() !== '');
      return lines.slice(-3).join('; ');
    }
    return error.message;
  }
  return 'error desconocido';
}

export type Transcription = { text: string } | { error: string };

/**
 * Transcribe un audio.
 *
 * whisper.cpp sólo lee wav, flac, mp3 y ogg, y el navegador graba en webm, así
 * que ffmpeg convierte antes a wav mono de 16 kHz, que es lo que el modelo
 * espera. La conversión es de trabajo y va a un temporal: el original no se
 * toca, porque es la cabeza de la cadena.
 */
export async function transcribeAudio(
  audio: Uint8Array,
  options: TranscriberOptions = {},
): Promise<Transcription> {
  const language = options.language ?? process.env['VERA_WHISPER_LANGUAGE'] ?? DEFAULTS.language;
  const timeout = options.timeoutMs ?? DEFAULTS.timeoutMs;

  const ffmpeg = findTool(['ffmpeg'], options.ffmpeg ?? process.env['VERA_FFMPEG']);
  if (ffmpeg === null) {
    return { error: 'no encuentro ffmpeg; instálalo o apunta VERA_FFMPEG al binario' };
  }
  const runtime = await discoverWhisper(options);
  if (runtime === null) {
    return {
      error: `no encuentro una instalación compatible de Whisper (${WHISPER_NAMES.join(', ')}); Vera prueba las instalaciones encontradas antes de usarlas`,
    };
  }

  let work: string | null = null;
  try {
    work = await mkdtemp(join(tmpdir(), 'vera-voz-'));
    const source = join(work, 'origen');
    const wav = join(work, 'audio.wav');
    const transcript = join(work, 'transcript');
    await writeFile(source, audio);

    try {
      await run(ffmpeg, ['-i', source, '-ar', '16000', '-ac', '1', '-y', wav], { timeout });
    } catch (error) {
      return { error: `no se pudo convertir el audio: ${whyFailed(error)}` };
    }

    try {
      /*
       * El archivo de texto y no stdout.
       *
       * Con `-nt`, whisper.cpp 1.8.2 deja de recorrer algunas grabaciones
       * largas y devuelve sólo el primer minuto como si estuviera completo. Con
       * timestamps sí llega al final, y `-otxt` escribe esa misma transcripción
       * completa sin las marcas. stdout no sirve como respaldo: puede contener
       * sólo el fragmento que precisamente estamos evitando.
       */
      const output = runtime.dialect === 'whisper.cpp' ? `${transcript}.txt` : join(work, 'audio.txt');
      const args = runtime.dialect === 'whisper.cpp'
        ? ['-m', runtime.model, '-l', language, '-np', '-otxt', '-of', transcript, wav]
        : [wav, '--model', runtime.model, '--language', language, '--output_format', 'txt', '--output_dir', work];
      await run(runtime.command, [...runtime.prefix, ...args], { timeout, maxBuffer: 32 * 1024 * 1024 });
      const text = (await readFile(output, 'utf8')).replace(/\s+/g, ' ').trim();
      return text === '' ? { error: 'la transcripción salió vacía' } : { text };
    } catch (error) {
      return { error: `whisper no pudo transcribir: ${whyFailed(error)}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'error desconocido' };
  } finally {
    if (work !== null) await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * ¿Están las herramientas? Se dice al arrancar, no cuando alguien graba: quien
 * levanta el servidor puede arreglarlo antes de que alguien confíe su voz.
 */
export async function transcriberDiagnosis(
  options: TranscriberOptions = {},
): Promise<{ ready: boolean; ffmpeg: string | null; whisper: string | null; model: string | null; dialect: WhisperDialect | null }> {
  const ffmpeg = findTool(['ffmpeg'], options.ffmpeg ?? process.env['VERA_FFMPEG']);
  const runtime = await discoverWhisper(options);
  return {
    ready: ffmpeg !== null && runtime !== null,
    ffmpeg,
    whisper: runtime?.command ?? null,
    model: runtime?.model ?? null,
    dialect: runtime?.dialect ?? null,
  };
}
