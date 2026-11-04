import { arch, cpus, totalmem } from 'node:os';
import { dirname } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import type { SpokenAudio } from './speech.ts';

export interface VoiceSwitches {
  enabled: boolean;
  speechToText: boolean;
  textToSpeech: boolean;
}

/**
 * Rutas y elecciones operativas de esta instalación.
 *
 * No son constitución ni secretos: describen cómo este host materializa una
 * capacidad del bibliotecario. Se guardan junto a la base y pueden cambiar al
 * migrar Vera sin reescribir ninguna página ni manifiesto.
 */
export interface VoiceRuntimePaths {
  ffmpeg: string;
  speechToTextEngine: string;
  speechToTextModel: string;
  speechToTextLanguage: string;
  textToSpeechPython: string;
  textToSpeechWorker: string;
  textToSpeechModelRoot: string;
  textToSpeechVoice: string;
  textToSpeechCacheRoot: string;
}

export interface VoiceEngineDiagnosis {
  ready: boolean;
  engine: string;
  paths: Record<string, string | null>;
  missing: string[];
}

export interface VoiceConfigurationView {
  switches: VoiceSwitches;
  paths: VoiceRuntimePaths;
  speechToText: VoiceEngineDiagnosis & { effective: boolean; language: string };
  textToSpeech: VoiceEngineDiagnosis & { effective: boolean; voice: string };
  hardware: { architecture: string; logicalCpus: number; memoryGiB: number };
  installation: {
    host: string;
    container: string;
    note: string;
  };
}

export interface VoiceConfigurationOptions {
  path: string;
  defaults?: Partial<VoiceSwitches>;
  defaultPaths: VoiceRuntimePaths;
  diagnoseSpeechToText(paths: VoiceRuntimePaths): Promise<VoiceEngineDiagnosis & { language: string }>;
  diagnoseTextToSpeech(paths: VoiceRuntimePaths): VoiceEngineDiagnosis & { voice: string };
  transcribe(audio: Uint8Array, paths: VoiceRuntimePaths): Promise<{ text: string } | { error: string }>;
  speak(text: string, paths: VoiceRuntimePaths, signal?: AbortSignal): Promise<SpokenAudio>;
  close(): void;
}

const FALLBACK: VoiceSwitches = {
  // Conserva la voz de una instalación existente al migrar. En una máquina sin
  // motores el switch queda solicitado pero no efectivo, y el Centro explica
  // cada requisito que falta.
  enabled: true,
  speechToText: true,
  textToSpeech: true,
};

const boolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const pathValue = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value.trim() : fallback;

type PersistedVoiceConfiguration = VoiceSwitches & { paths: VoiceRuntimePaths };

export class VoiceConfiguration {
  private configuration: PersistedVoiceConfiguration | null = null;
  private readonly options: VoiceConfigurationOptions;

  constructor(options: VoiceConfigurationOptions) { this.options = options; }

  private async read(): Promise<PersistedVoiceConfiguration> {
    if (this.configuration !== null) return this.configuration;
    const defaults = { ...FALLBACK, ...this.options.defaults };
    try {
      const raw = JSON.parse(await readFile(this.options.path, 'utf8')) as Record<string, unknown>;
      const rawPaths = raw['paths'] !== null && typeof raw['paths'] === 'object'
        ? raw['paths'] as Record<string, unknown> : {};
      this.configuration = {
        enabled: boolean(raw['enabled'], defaults.enabled),
        speechToText: boolean(raw['speechToText'], defaults.speechToText),
        textToSpeech: boolean(raw['textToSpeech'], defaults.textToSpeech),
        paths: Object.fromEntries(Object.entries(this.options.defaultPaths).map(([key, fallback]) =>
          [key, pathValue(rawPaths[key], fallback)])) as unknown as VoiceRuntimePaths,
      };
    } catch {
      this.configuration = { ...defaults, paths: { ...this.options.defaultPaths } };
    }
    return this.configuration;
  }

  async view(): Promise<VoiceConfigurationView> {
    const configuration = await this.read();
    const switches = configuration;
    const speechToText = await this.options.diagnoseSpeechToText(configuration.paths);
    const textToSpeech = this.options.diagnoseTextToSpeech(configuration.paths);
    return {
      switches: {
        enabled: switches.enabled,
        speechToText: switches.speechToText,
        textToSpeech: switches.textToSpeech,
      },
      paths: { ...configuration.paths },
      speechToText: {
        ...speechToText,
        effective: switches.enabled && switches.speechToText && speechToText.ready,
      },
      textToSpeech: {
        ...textToSpeech,
        effective: switches.enabled && switches.textToSpeech && textToSpeech.ready,
      },
      hardware: {
        architecture: arch(),
        logicalCpus: cpus().length,
        memoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      },
      installation: {
        host: 'npm run voice:setup',
        container: 'fly ssh console -C "npm run voice:setup -- /data/models"',
        note: 'La instalación es explícita y corre con autoridad del dueño; el navegador nunca descarga ni ejecuta modelos por sí solo.',
      },
    };
  }

  async update(next: Partial<VoiceSwitches> & { paths?: Partial<VoiceRuntimePaths> }): Promise<VoiceConfigurationView> {
    const current = await this.read();
    this.configuration = {
      enabled: boolean(next.enabled, current.enabled),
      speechToText: boolean(next.speechToText, current.speechToText),
      textToSpeech: boolean(next.textToSpeech, current.textToSpeech),
      paths: Object.fromEntries(Object.entries(current.paths).map(([key, fallback]) =>
        [key, pathValue(next.paths?.[key as keyof VoiceRuntimePaths], fallback)])) as unknown as VoiceRuntimePaths,
    };
    await mkdir(dirname(this.options.path), { recursive: true });
    const temporary = `${this.options.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.configuration, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.options.path);
    return this.view();
  }

  async transcribe(audio: Uint8Array): Promise<{ text: string } | { error: string }> {
    const state = await this.view();
    if (!state.switches.enabled || !state.switches.speechToText) {
      return { error: 'la escucha está desactivada en Centro de Vera → Agente de biblioteca → Voz' };
    }
    if (!state.speechToText.ready) {
      return { error: `la escucha no está lista: falta ${state.speechToText.missing.join(', ')}` };
    }
    const configuration = await this.read();
    return this.options.transcribe(audio, configuration.paths);
  }

  async speak(text: string, signal?: AbortSignal): Promise<SpokenAudio> {
    const state = await this.view();
    if (!state.switches.enabled || !state.switches.textToSpeech) {
      throw new Error('el habla está desactivada en Centro de Vera → Agente de biblioteca → Voz');
    }
    if (!state.textToSpeech.ready) {
      throw new Error(`el habla no está lista: falta ${state.textToSpeech.missing.join(', ')}`);
    }
    const configuration = await this.read();
    return this.options.speak(text, configuration.paths, signal);
  }

  close(): void { this.options.close(); }
}
