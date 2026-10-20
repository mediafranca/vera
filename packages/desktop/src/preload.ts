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

contextBridge.exposeInMainWorld('veraExternalEditing', {
  open: (input: unknown) => ipcRenderer.invoke('vera-external-editing:open', input),
  read: (sessionId: string) => ipcRenderer.invoke('vera-external-editing:read', sessionId),
  close: (sessionId: string, status: 'accepted' | 'discarded') =>
    ipcRenderer.invoke('vera-external-editing:close', sessionId, status),
  onChanged: (listener: (change: unknown) => void) => {
    ipcRenderer.on('vera-external-editing:changed', (_event, change) => listener(change));
  },
});
