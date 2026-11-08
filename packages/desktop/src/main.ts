import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { supportsAutomaticUpdates, UPDATE_CHECK_INTERVAL_MS } from './update-policy.ts';
import { DesktopConecta, type ConectaState, type SecureConectaStore } from './conecta.ts';
import {
  DesktopExternalEditing,
  type DesktopExternalEditInput,
} from './external-editing.ts';
import { createMCPHandler } from '../../mcp/src/http.ts';
import { VoiceConfiguration, type VoiceRuntimePaths } from '../../server/src/voice-configuration.ts';
import { transcribeAudio, transcriberDiagnosis } from '../../server/src/transcribe.ts';
import { createLocalSpeech, speechDiagnosis, type SpeechSynthesizer } from '../../server/src/speech.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const PORT = 4173;

const portableRoot = process.env['PORTABLE_EXECUTABLE_DIR'];
const localRoot = process.platform === 'win32'
  ? process.env['LOCALAPPDATA']
  : undefined;
const dataRoot = portableRoot === undefined
  ? join(localRoot ?? app.getPath('userData'), localRoot === undefined ? 'data' : 'Vera')
  : join(portableRoot, 'VeraData');

// En Windows la memoria no debe viajar por AppData/Roaming. El programa se
// reemplaza; los datos viven en LocalAppData o junto al ejecutable portable.
app.setPath('userData', dataRoot);

const databasePath = join(dataRoot, 'data', 'vera.sqlite');
const objectsRoot = join(dataRoot, 'objects');
const webRoot = app.isPackaged ? join(process.resourcesPath, 'web') : join(ROOT, 'packages/web/dist');
const setupPage = join(HERE, 'setup.html');
const preload = join(HERE, 'preload.cjs');
const conectaSecretPath = join(dataRoot, 'secrets', 'vera-conecta.bin');
const librarianSecretPath = join(dataRoot, 'secrets', 'vera-librarian.bin');
const voiceConfigurationPath = join(dataRoot, 'data', 'voice.json');
const voiceRuntimeRoot = join(dataRoot, 'voice');
const voiceSetupRoot = app.isPackaged ? join(process.resourcesPath, 'voice-setup') : join(ROOT, 'scripts');
const externalEditsRoot = join(dataRoot, 'external-edits');
const externalEditorsPath = join(dataRoot, 'external-editors.json');

const EXTERNAL_EDITOR_KEYS = new Set([
  'markdown', 'mermaid', 'svg', 'html', 'javascript', 'process', 'mediawiki', 'code',
]);

const externalEditorKey = (kind: string): string => {
  if (kind === 'page_markdown' || kind === 'block_markdown') return 'markdown';
  return kind;
};

const readExternalEditors = (): Record<string, string> => {
  if (!existsSync(externalEditorsPath)) return {};
  try {
    const value = JSON.parse(readFileSync(externalEditorsPath, 'utf8')) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, path]) =>
      EXTERNAL_EDITOR_KEYS.has(key) && typeof path === 'string' && path !== ''
    ));
  } catch {
    return {};
  }
};

const writeExternalEditors = (editors: Record<string, string>): void => {
  mkdirSync(dirname(externalEditorsPath), { recursive: true });
  writeFileSync(externalEditorsPath, `${JSON.stringify(editors, null, 2)}\n`, { mode: 0o600 });
};

const launchConfiguredEditor = async (path: string, kind: string): Promise<void> => {
  const editor = readExternalEditors()[externalEditorKey(kind)];
  if (editor === undefined) {
    const failure = await shell.openPath(path);
    if (failure !== '') throw new Error(failure);
    return;
  }
  if (!existsSync(editor)) throw new Error(`el editor configurado ya no existe: ${editor}`);
  await new Promise<void>((resolve, reject) => {
    const command = process.platform === 'darwin' && editor.endsWith('.app') ? '/usr/bin/open' : editor;
    const args = command === '/usr/bin/open' ? ['-a', editor, '--args', path] : [path];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
};

if (app.isPackaged) {
  process.env['VERA_SCHEMA'] = join(process.resourcesPath, 'schema.sql');
  process.env['VERA_P5_RUNTIME'] = join(process.resourcesPath, 'p5.min.js');
}

let running: { close(): Promise<void> } | null = null;
let window: BrowserWindow | null = null;
let updateTimer: NodeJS.Timeout | null = null;
let installDownloadedUpdate: (() => void) | null = null;
let installOnQuit = false;
let preparingQuit = false;
let downloadingUpdate = false;
let conecta: DesktopConecta | null = null;
const externalEditing = new DesktopExternalEditing(
  externalEditsRoot,
  launchConfiguredEditor,
  (sessionId, content) => {
    window?.webContents.send('vera-external-editing:changed', { sessionId, content });
  },
);

const secureConectaStore = (): SecureConectaStore => ({
  available: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  read: () => {
    if (!existsSync(conectaSecretPath) || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(conectaSecretPath))) as ConectaState;
    } catch {
      return null;
    }
  },
  write: (state) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('no hay almacén seguro disponible');
    mkdirSync(dirname(conectaSecretPath), { recursive: true });
    writeFileSync(conectaSecretPath, safeStorage.encryptString(JSON.stringify(state)), { mode: 0o600 });
  },
  clear: () => {
    if (existsSync(conectaSecretPath)) unlinkSync(conectaSecretPath);
  },
});

interface LibrarianSecretState {
  apiKey: string;
  endpoint: string;
  model: string;
}

const secureSecretStorageAvailable = (): boolean =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');

const writeLibrarianSecret = (state: LibrarianSecretState): void => {
  if (!secureSecretStorageAvailable()) {
    throw new Error('este equipo no ofrece un almacén seguro para la clave de inferencia');
  }
  mkdirSync(dirname(librarianSecretPath), { recursive: true });
  writeFileSync(librarianSecretPath, safeStorage.encryptString(JSON.stringify(state)), { mode: 0o600 });
};

const desktopVoicePaths = (): VoiceRuntimePaths => {
  const kokoro = join(voiceRuntimeRoot, 'kokoro');
  return {
    ffmpeg: '',
    speechToTextEngine: join(voiceRuntimeRoot, 'whisper/source/build/bin/whisper-cli'),
    speechToTextModel: join(voiceRuntimeRoot, 'whisper/ggml-small.bin'),
    speechToTextLanguage: 'es',
    textToSpeechPython: join(kokoro, 'venv/bin/python'),
    textToSpeechWorker: join(voiceSetupRoot, 'tts-worker.py'),
    textToSpeechModelRoot: join(kokoro, 'model'),
    textToSpeechVoice: 'em_alex',
    textToSpeechCacheRoot: join(kokoro, 'cache'),
  };
};

const writeInitialVoiceConfiguration = (prepared: boolean): void => {
  mkdirSync(dirname(voiceConfigurationPath), { recursive: true });
  writeFileSync(voiceConfigurationPath, `${JSON.stringify({
    enabled: prepared,
    speechToText: prepared,
    textToSpeech: prepared,
    paths: desktopVoicePaths(),
  }, null, 2)}\n`, { mode: 0o600 });
};

const prepareLocalVoice = (): Promise<void> => new Promise((resolve, reject) => {
  if (process.platform === 'win32') {
    reject(new Error('la preparación automática de voz todavía no está disponible en Windows'));
    return;
  }
  const script = join(voiceSetupRoot, 'setup-local-voice.sh');
  if (!existsSync(script)) {
    reject(new Error('esta edición no contiene el preparador de voz local'));
    return;
  }
  const child = spawn('/usr/bin/env', ['bash', script, voiceRuntimeRoot], {
    env: { ...process.env, VERA_TTS_RUNTIME: join(voiceRuntimeRoot, 'kokoro') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let error = '';
  child.stderr?.on('data', (chunk: Buffer) => { error = `${error}${chunk.toString('utf8')}`.slice(-8_000); });
  child.once('error', reject);
  child.once('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(error.trim() || `el preparador de voz terminó con código ${String(code)}`));
  });
});

const readLibrarianSecret = (): LibrarianSecretState | null => {
  if (!existsSync(librarianSecretPath) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(librarianSecretPath))) as Partial<LibrarianSecretState>;
    if (typeof parsed.apiKey !== 'string' || parsed.apiKey.trim() === '') return null;
    return {
      apiKey: parsed.apiKey,
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
    };
  } catch {
    return null;
  }
};

const applyLibrarianSecret = (state: LibrarianSecretState | null): void => {
  if (state === null) {
    delete process.env['VERA_LIBRARIAN_API_KEY'];
    return;
  }
  process.env['VERA_LIBRARIAN_API_KEY'] = state.apiKey;
  if (state.endpoint.trim() !== '') process.env['OPENAI_BASE_URL'] = state.endpoint.trim();
  if (state.model.trim() !== '') process.env['VERA_OPENAI_MODELS'] = state.model.replace(/^openai:/, '').trim();
};

const databaseExists = (): boolean => existsSync(databasePath) && statSync(databasePath).size > 0;

const desktopVoiceConfiguration = (): VoiceConfiguration => {
  let speech: SpeechSynthesizer | null = null;
  let speechIdentity = '';
  const speechOptions = (paths: VoiceRuntimePaths) => ({
    cacheRoot: paths.textToSpeechCacheRoot,
    python: paths.textToSpeechPython,
    worker: paths.textToSpeechWorker,
    modelRoot: paths.textToSpeechModelRoot,
    voice: paths.textToSpeechVoice,
  });
  return new VoiceConfiguration({
    path: voiceConfigurationPath,
    defaults: { enabled: false, speechToText: false, textToSpeech: false },
    defaultPaths: desktopVoicePaths(),
    diagnoseSpeechToText: async (paths) => {
      const found = await transcriberDiagnosis({
        ...(paths.ffmpeg === '' ? {} : { ffmpeg: paths.ffmpeg }),
        ...(paths.speechToTextEngine === '' ? {} : { command: paths.speechToTextEngine }),
        model: paths.speechToTextModel,
        language: paths.speechToTextLanguage,
      });
      return {
        ready: found.ready,
        engine: 'whisper.cpp',
        language: paths.speechToTextLanguage,
        paths: { ffmpeg: found.ffmpeg, engine: found.whisper, model: found.model },
        missing: [
          ...(found.ffmpeg === null ? ['ffmpeg'] : []),
          ...(found.whisper === null ? ['whisper.cpp'] : []),
          ...(found.model === null ? ['modelo'] : []),
        ],
      };
    },
    diagnoseTextToSpeech: (paths) => {
      const found = speechDiagnosis(speechOptions(paths));
      return {
        ready: found.ready,
        engine: 'Kokoro',
        voice: found.voice,
        paths: { python: found.python, worker: found.worker, model: found.modelRoot },
        missing: found.missing,
      };
    },
    transcribe: (audio, paths) => transcribeAudio(audio, {
      ...(paths.ffmpeg === '' ? {} : { ffmpeg: paths.ffmpeg }),
      ...(paths.speechToTextEngine === '' ? {} : { command: paths.speechToTextEngine }),
      model: paths.speechToTextModel,
      language: paths.speechToTextLanguage,
    }),
    speak: (text, paths, signal) => {
      const options = speechOptions(paths);
      const identity = JSON.stringify(options);
      if (speech === null || speechIdentity !== identity) {
        speech?.close();
        speech = createLocalSpeech(options);
        speechIdentity = identity;
      }
      return speech.speak(text, signal);
    },
    close: () => { speech?.close(); speech = null; speechIdentity = ''; },
  });
};

async function startVera(initialPath = '/'): Promise<void> {
  if (running === null) {
    applyLibrarianSecret(readLibrarianSecret());
    // El starter es un registro versionado e idempotente. Al abrir una memoria
    // existente aplica únicamente las adiciones de la distribución nueva; no
    // vuelve a crear ni pisa operaciones que esa memoria ya recibió.
    const { initializeStarterMemory } = await import('../../server/src/starter-memory.ts');
    initializeStarterMemory({ databasePath });
    const { listen } = await import('../../server/src/server.ts');
    mkdirSync(dirname(databasePath), { recursive: true });
    mkdirSync(objectsRoot, { recursive: true });
    running = listen({
      port: PORT,
      host: '127.0.0.1',
      databasePath,
      objectsRoot,
      webRoot,
      voiceConfiguration: desktopVoiceConfiguration(),
      localMcpHandler: createMCPHandler(`http://127.0.0.1:${PORT}`),
    });
  }
  if (conecta === null) {
    conecta = new DesktopConecta(secureConectaStore(), `http://127.0.0.1:${PORT}`, (status) => {
      window?.webContents.send('vera-conecta:status', status);
    });
    conecta.start();
  }
  await window?.loadURL(`http://127.0.0.1:${PORT}${initialPath}`);
}

async function closeVera(): Promise<void> {
  conecta?.stop();
  conecta = null;
  const server = running;
  running = null;
  await server?.close();
}

async function enableAutomaticUpdates(): Promise<void> {
  if (!supportsAutomaticUpdates({
    isPackaged: app.isPackaged,
    platform: process.platform,
    portableRoot,
    // La edición Catalina queda fijada a un runtime fuera de soporte. Nunca
    // debe reemplazarse sola por una release que ese sistema no abre.
    releaseChannel: process.env['VERA_LEGACY_DESKTOP'] === '1' ? 'legacy' : 'stable',
  })) return;

  /*
   * electron-updater es CommonJS. En el paquete ESM, Node puede exponerlo como
   * exportación nombrada o debajo de `default` según la plataforma y la versión
   * del cargador. Tratar una forma como universal dejó `autoUpdater` indefinido
   * en macOS y convirtió una capacidad secundaria en otro bloqueo de arranque.
   */
  const updaterModule = await import('electron-updater');
  const autoUpdater = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater;
  if (autoUpdater === undefined) {
    console.warn('La actualización automática no está disponible en este paquete.');
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('error', (error) => {
    window?.setProgressBar(-1);
    console.error('No se pudo actualizar VERA:', error);
    if (downloadingUpdate) {
      downloadingUpdate = false;
      void dialog.showMessageBox(window ?? undefined, {
        type: 'warning',
        title: 'La actualización no se descargó',
        message: 'Vera sigue funcionando con la versión instalada.',
        detail: 'Comprueba la conexión y vuelve a intentarlo en la próxima comprobación.',
        buttons: ['Entendido'],
        noLink: true,
      });
    }
  });
  autoUpdater.on('download-progress', ({ percent }) => {
    window?.setProgressBar(Math.max(0, Math.min(1, percent / 100)));
  });
  autoUpdater.on('update-available', async ({ version }) => {
    const choice = await dialog.showMessageBox(window ?? undefined, {
      type: 'info',
      title: 'Actualización disponible',
      message: `Vera ${version} está disponible`,
      detail: 'Puedes descargarla ahora y seguir usando Vera mientras termina.',
      buttons: ['Descargar', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response === 0) {
      downloadingUpdate = true;
      try {
        await autoUpdater.downloadUpdate();
      } catch (error) {
        downloadingUpdate = false;
        console.error('No se pudo iniciar la descarga de VERA:', error);
      }
    }
  });
  autoUpdater.on('update-downloaded', async ({ version }) => {
    downloadingUpdate = false;
    window?.setProgressBar(-1);
    installDownloadedUpdate = () => autoUpdater.quitAndInstall(false, true);
    const choice = await dialog.showMessageBox(window ?? undefined, {
      type: 'info',
      title: 'Actualización preparada',
      message: `Vera ${version} está lista para instalarse`,
      detail: 'La memoria está separada del programa y no será reemplazada.',
      buttons: ['Reiniciar e instalar', 'Instalar al cerrar'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    installOnQuit = true;
    if (choice.response === 0) app.quit();
  });

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.error('No se pudo comprobar si hay una actualización:', error);
    });
  };
  setTimeout(check, 10_000).unref();
  updateTimer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  updateTimer.unref();
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: 'Vera',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (databaseExists()) void startVera();
  else void window.loadFile(setupPage);
}

ipcMain.handle('vera:initialize', async (_event, rawInput: unknown) => {
  if (typeof rawInput !== 'object' || rawInput === null) {
    throw new Error('La constitución de la biblioteca está incompleta.');
  }
  const input = rawInput as Record<string, unknown>;
  if (typeof input.personName !== 'string' || input.personName.trim().length < 2) {
    throw new Error('Escribe el nombre con que firmarás esta memoria.');
  }
  if (typeof input.libraryName !== 'string' || input.libraryName.trim().length < 2) {
    throw new Error('Escribe el nombre de la biblioteca.');
  }
  if (input.profile !== 'personal' && input.profile !== 'collective') {
    throw new Error('Elige si la biblioteca es personal o colectiva.');
  }
  if (typeof input.ownerLibrarianName !== 'string' || input.ownerLibrarianName.trim().length < 2) {
    throw new Error('Escribe el nombre de la bibliotecaria.');
  }
  if (input.profile === 'collective' &&
    (typeof input.initialCollectiveSurfaceName !== 'string' ||
      input.initialCollectiveSurfaceName.trim().length < 2)) {
    throw new Error('La biblioteca colectiva necesita una primera superficie compartida.');
  }
  if (input.inferenceChoice !== 'later' && input.inferenceChoice !== 'configure') {
    throw new Error('Elige si configurarás ahora la inferencia de la bibliotecaria.');
  }
  if (input.voiceChoice !== 'later' && input.voiceChoice !== 'install') {
    throw new Error('Elige si prepararás ahora la voz local.');
  }
  if (databaseExists()) throw new Error('Esta memoria ya fue inicializada.');
  let inference: 'deferred' | 'configured' = 'deferred';
  let inferenceEndpoint = '';
  let inferenceModel = '';
  if (input.inferenceChoice === 'configure') {
    if (input.librarianRuntime === null || typeof input.librarianRuntime !== 'object') {
      throw new Error('La configuración remota de la bibliotecaria está incompleta.');
    }
    const runtime = input.librarianRuntime as Record<string, unknown>;
    const apiKey = typeof runtime.apiKey === 'string' ? runtime.apiKey.trim() : '';
    const endpoint = typeof runtime.endpoint === 'string' ? runtime.endpoint.trim() : '';
    const model = typeof runtime.model === 'string' ? runtime.model.trim() : '';
    if (apiKey === '') throw new Error('La clave de inferencia está vacía.');
    writeLibrarianSecret({ apiKey, endpoint, model });
    inference = 'configured';
    inferenceEndpoint = endpoint;
    inferenceModel = model;
  }
  let voice: 'deferred' | 'configured' | 'unavailable' | 'failed' = 'deferred';
  if (input.voiceChoice === 'install') {
    if (process.platform === 'win32') voice = 'unavailable';
    else {
      try {
        await prepareLocalVoice();
        voice = 'configured';
      } catch (error) {
        console.error('No se pudo preparar la voz local durante la instalación:', error);
        voice = 'failed';
      }
    }
  }
  writeInitialVoiceConfiguration(voice === 'configured');
  const name = input.personName.trim();
  const { initializeStarterMemory } = await import('../../server/src/starter-memory.ts');
  initializeStarterMemory({
    databasePath,
    owner: { id: `participant:${randomUUID()}`, name },
    libraryName: input.libraryName.trim(),
    profile: input.profile,
    ownerLibrarianName: input.ownerLibrarianName.trim(),
    ...(input.profile === 'collective'
      ? { initialCollectiveSurfaceName: (input.initialCollectiveSurfaceName as string).trim() }
      : {}),
    installation: { inference, voice, inferenceEndpoint, inferenceModel },
  });
  await startVera('/p/page:starter-installation-day');
  return { ok: true };
});

ipcMain.handle('vera:system-name', () => userInfo().username);
ipcMain.handle('vera:setup-capabilities', () => ({
  secureStorage: secureSecretStorageAvailable(),
  localVoiceInstaller: process.platform !== 'win32' && existsSync(join(voiceSetupRoot, 'setup-local-voice.sh')),
  platform: process.platform,
}));
ipcMain.handle('vera-conecta:status', () => conecta?.status() ?? {
  status: 'desactivado', installationId: null, secureStorage: false,
});
ipcMain.handle('vera-conecta:pair', async (_event, relayUrl: unknown) => {
  if (typeof relayUrl !== 'string' || !/^https?:\/\//.test(relayUrl)) {
    throw new Error('La dirección de Vera Conecta no es válida.');
  }
  if (conecta === null) throw new Error('Vera todavía no está iniciada.');
  return conecta.pair(relayUrl);
});
ipcMain.handle('vera-conecta:forget', () => conecta?.forget());
ipcMain.handle('vera-conecta:clients', () => conecta?.clients() ?? []);
ipcMain.handle('vera-conecta:authorize-client', async (_event, label: unknown, scopes: unknown) => {
  if (typeof label !== 'string' || !Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
    throw new Error('La autorización remota no es válida.');
  }
  if (conecta === null) throw new Error('Vera todavía no está iniciada.');
  return conecta.authorizeClient(label, scopes);
});
ipcMain.handle('vera-conecta:revoke-client', async (_event, principalId: unknown) => {
  if (typeof principalId !== 'string' || principalId === '') throw new Error('El cliente remoto no es válido.');
  if (conecta === null) throw new Error('Vera todavía no está iniciada.');
  await conecta.revokeClient(principalId);
  return { ok: true };
});

ipcMain.handle('vera-librarian-secret:status', () => ({
  available: readLibrarianSecret() !== null,
  secureStorage: secureSecretStorageAvailable(),
}));
ipcMain.handle('vera-librarian-secret:save', (_event, raw: unknown) => {
  if (raw === null || typeof raw !== 'object') throw new Error('la configuración del secreto está incompleta');
  const input = raw as Record<string, unknown>;
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (apiKey === '') throw new Error('la clave de inferencia está vacía');
  const state = { apiKey, endpoint, model };
  writeLibrarianSecret(state);
  applyLibrarianSecret(state);
  return { available: true, secureStorage: true };
});
ipcMain.handle('vera-librarian-secret:clear', () => {
  if (existsSync(librarianSecretPath)) unlinkSync(librarianSecretPath);
  applyLibrarianSecret(null);
  return { available: false, secureStorage: safeStorage.isEncryptionAvailable() };
});

ipcMain.handle('vera-external-editing:open', async (_event, raw: unknown) => {
  if (raw === null || typeof raw !== 'object') throw new Error('la sesión externa no es válida');
  const input = raw as Partial<DesktopExternalEditInput>;
  if (
    typeof input.sessionId !== 'string'
    || typeof input.fileName !== 'string'
    || typeof input.content !== 'string'
    || input.manifest === null
    || typeof input.manifest !== 'object'
  ) throw new Error('la sesión externa está incompleta');
  return externalEditing.open(input as DesktopExternalEditInput);
});
ipcMain.handle('vera-external-editing:read', (_event, sessionId: unknown) => {
  if (typeof sessionId !== 'string') throw new Error('la sesión externa no es válida');
  return externalEditing.read(sessionId);
});
ipcMain.handle('vera-external-editing:close', (_event, sessionId: unknown, status: unknown) => {
  if (typeof sessionId !== 'string' || (status !== 'accepted' && status !== 'discarded')) {
    throw new Error('el cierre de la sesión externa no es válido');
  }
  return externalEditing.close(sessionId, status);
});
ipcMain.handle('vera-external-editing:editors', () => readExternalEditors());
ipcMain.handle('vera-external-editing:choose-editor', async (_event, key: unknown) => {
  if (typeof key !== 'string' || !EXTERNAL_EDITOR_KEYS.has(key)) {
    throw new Error('el tipo de editor externo no es válido');
  }
  const chosen = await dialog.showOpenDialog({
    title: 'Elegir aplicación externa',
    properties: ['openFile'],
  });
  if (chosen.canceled || chosen.filePaths[0] === undefined) return readExternalEditors();
  const editors = readExternalEditors();
  editors[key] = chosen.filePaths[0];
  writeExternalEditors(editors);
  return editors;
});
ipcMain.handle('vera-external-editing:clear-editor', (_event, key: unknown) => {
  if (typeof key !== 'string' || !EXTERNAL_EDITOR_KEYS.has(key)) {
    throw new Error('el tipo de editor externo no es válido');
  }
  const editors = readExternalEditors();
  delete editors[key];
  writeExternalEditors(editors);
  return editors;
});

ipcMain.handle('vera-voice:choose-path', async (_event, kind: unknown) => {
  const choices = {
    ffmpeg: { title: 'Elegir ffmpeg', directory: false },
    speechToTextEngine: { title: 'Elegir whisper.cpp', directory: false },
    speechToTextModel: { title: 'Elegir modelo de transcripción', directory: false },
    textToSpeechPython: { title: 'Elegir intérprete de Python', directory: false },
    textToSpeechWorker: { title: 'Elegir worker de síntesis', directory: false },
    textToSpeechModelRoot: { title: 'Elegir carpeta del modelo de voz', directory: true },
    textToSpeechCacheRoot: { title: 'Elegir carpeta de caché de voz', directory: true },
  } as const;
  if (typeof kind !== 'string' || !(kind in choices)) {
    throw new Error('el componente de voz no es válido');
  }
  const choice = choices[kind as keyof typeof choices];
  const chosen = await dialog.showOpenDialog({
    title: choice.title,
    properties: [choice.directory ? 'openDirectory' : 'openFile'],
  });
  return chosen.canceled ? null : chosen.filePaths[0] ?? null;
});

app.whenReady().then(() => {
  createWindow();
  void enableAutomaticUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (preparingQuit) return;
  if (running === null && !(installOnQuit && installDownloadedUpdate !== null)) return;

  event.preventDefault();
  preparingQuit = true;
  externalEditing.stopAll();
  if (updateTimer !== null) clearInterval(updateTimer);
  void closeVera().finally(() => {
    if (installOnQuit && installDownloadedUpdate !== null) installDownloadedUpdate();
    else app.quit();
  });
});
