import { arch, cpus, totalmem } from 'node:os';
import { dirname } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import type { SpokenAudio } from './speech.ts';

export interface VoiceSwitches {
  enabled: boolean;
  speechToText: boolean;
  textToSpeech: boolean;
}

export interface VoiceEngineDiagnosis {
  ready: boolean;
  engine: string;
  paths: Record<string, string | null>;
  missing: string[];
}

export interface VoiceConfigurationView {
  switches: VoiceSwitches;
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
  diagnoseSpeechToText(): Promise<VoiceEngineDiagnosis & { language: string }>;
  diagnoseTextToSpeech(): VoiceEngineDiagnosis & { voice: string };
  transcribe(audio: Uint8Array): Promise<{ text: string } | { error: string }>;
  speak(text: string, signal?: AbortSignal): Promise<SpokenAudio>;
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

export class VoiceConfiguration {
  private switches: VoiceSwitches | null = null;
  private readonly options: VoiceConfigurationOptions;

  constructor(options: VoiceConfigurationOptions) { this.options = options; }

  private async read(): Promise<VoiceSwitches> {
    if (this.switches !== null) return this.switches;
    const defaults = { ...FALLBACK, ...this.options.defaults };
    try {
      const raw = JSON.parse(await readFile(this.options.path, 'utf8')) as Record<string, unknown>;
      this.switches = {
        enabled: boolean(raw['enabled'], defaults.enabled),
        speechToText: boolean(raw['speechToText'], defaults.speechToText),
        textToSpeech: boolean(raw['textToSpeech'], defaults.textToSpeech),
      };
    } catch {
      this.switches = defaults;
    }
    return this.switches;
  }

  async view(): Promise<VoiceConfigurationView> {
    const switches = await this.read();
    const speechToText = await this.options.diagnoseSpeechToText();
    const textToSpeech = this.options.diagnoseTextToSpeech();
    return {
      switches: { ...switches },
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

  async update(next: Partial<VoiceSwitches>): Promise<VoiceConfigurationView> {
    const current = await this.read();
    this.switches = {
      enabled: boolean(next.enabled, current.enabled),
      speechToText: boolean(next.speechToText, current.speechToText),
      textToSpeech: boolean(next.textToSpeech, current.textToSpeech),
    };
    await mkdir(dirname(this.options.path), { recursive: true });
    const temporary = `${this.options.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.switches, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.options.path);
    return this.view();
  }

  async transcribe(audio: Uint8Array): Promise<{ text: string } | { error: string }> {
    const state = await this.view();
    if (!state.switches.enabled || !state.switches.speechToText) {
      return { error: 'la escucha está desactivada en Centro de Vera → Conexiones → Voz' };
    }
    if (!state.speechToText.ready) {
      return { error: `la escucha no está lista: falta ${state.speechToText.missing.join(', ')}` };
    }
    return this.options.transcribe(audio);
  }

  async speak(text: string, signal?: AbortSignal): Promise<SpokenAudio> {
    const state = await this.view();
    if (!state.switches.enabled || !state.switches.textToSpeech) {
      throw new Error('el habla está desactivada en Centro de Vera → Conexiones → Voz');
    }
    if (!state.textToSpeech.ready) {
      throw new Error(`el habla no está lista: falta ${state.textToSpeech.missing.join(', ')}`);
    }
    return this.options.speak(text, signal);
  }

  close(): void { this.options.close(); }
}
