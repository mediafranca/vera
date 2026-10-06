import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('veraSetup', {
  initialize: (name: string) => ipcRenderer.invoke('vera:initialize', name),
  systemName: () => ipcRenderer.invoke('vera:system-name'),
});

contextBridge.exposeInMainWorld('veraConecta', {
  status: () => ipcRenderer.invoke('vera-conecta:status'),
  pair: (relayUrl: string) => ipcRenderer.invoke('vera-conecta:pair', relayUrl),
  forget: () => ipcRenderer.invoke('vera-conecta:forget'),
  clients: () => ipcRenderer.invoke('vera-conecta:clients'),
  authorizeClient: (label: string, scopes: string[]) =>
    ipcRenderer.invoke('vera-conecta:authorize-client', label, scopes),
  revokeClient: (principalId: string) => ipcRenderer.invoke('vera-conecta:revoke-client', principalId),
  onStatus: (listener: (status: unknown) => void) => {
    ipcRenderer.on('vera-conecta:status', (_event, status) => listener(status));
  },
});
