import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { supportsAutomaticUpdates, UPDATE_CHECK_INTERVAL_MS } from './update-policy.ts';
import { DesktopConecta, type ConectaState, type SecureConectaStore } from './conecta.ts';

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

const databaseExists = (): boolean => existsSync(databasePath) && statSync(databasePath).size > 0;

async function startVera(): Promise<void> {
  if (running === null) {
    const { listen } = await import('../../server/src/server.ts');
    mkdirSync(dirname(databasePath), { recursive: true });
    mkdirSync(objectsRoot, { recursive: true });
    running = listen({
      port: PORT,
      host: '127.0.0.1',
      databasePath,
      objectsRoot,
      webRoot,
    });
  }
  if (conecta === null) {
    conecta = new DesktopConecta(secureConectaStore(), `http://127.0.0.1:${PORT}`, (status) => {
      window?.webContents.send('vera-conecta:status', status);
    });
    conecta.start();
  }
  await window?.loadURL(`http://127.0.0.1:${PORT}`);
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
  })) return;

  const { autoUpdater } = await import('electron-updater');
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

ipcMain.handle('vera:initialize', async (_event, rawName: unknown) => {
  if (typeof rawName !== 'string' || rawName.trim().length < 2) {
    throw new Error('Escribe el nombre con que firmarás esta memoria.');
  }
  if (databaseExists()) throw new Error('Esta memoria ya fue inicializada.');
  const name = rawName.trim();
  const { initializeStarterMemory } = await import('../../server/src/starter-memory.ts');
  initializeStarterMemory({
    databasePath,
    owner: { id: `participant:${randomUUID()}`, name },
  });
  await startVera();
  return { ok: true };
});

ipcMain.handle('vera:system-name', () => userInfo().username);
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
  if (updateTimer !== null) clearInterval(updateTimer);
  void closeVera().finally(() => {
    if (installOnQuit && installDownloadedUpdate !== null) installDownloadedUpdate();
    else app.quit();
  });
});
