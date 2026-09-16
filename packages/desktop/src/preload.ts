import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('veraSetup', {
  initialize: (name: string) => ipcRenderer.invoke('vera:initialize', name),
  systemName: () => ipcRenderer.invoke('vera:system-name'),
});

contextBridge.exposeInMainWorld('veraConecta', {
  status: () => ipcRenderer.invoke('vera-conecta:status'),
  pair: (relayUrl: string) => ipcRenderer.invoke('vera-conecta:pair', relayUrl),
  forget: () => ipcRenderer.invoke('vera-conecta:forget'),
  onStatus: (listener: (status: unknown) => void) => {
    ipcRenderer.on('vera-conecta:status', (_event, status) => listener(status));
  },
});
