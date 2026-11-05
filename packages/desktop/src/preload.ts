import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('veraSetup', {
  initialize: (input: {
    personName: string;
    libraryName: string;
    profile: 'personal' | 'collective';
    ownerLibrarianName: string;
    initialCollectiveSurfaceName: string | null;
    inferenceChoice: 'later' | 'configure';
    librarianRuntime: { apiKey: string; endpoint: string; model: string } | null;
    voiceChoice: 'later' | 'install';
  }) => ipcRenderer.invoke('vera:initialize', input),
  systemName: () => ipcRenderer.invoke('vera:system-name'),
  capabilities: () => ipcRenderer.invoke('vera:setup-capabilities'),
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
  editors: () => ipcRenderer.invoke('vera-external-editing:editors'),
  chooseEditor: (kind: string) => ipcRenderer.invoke('vera-external-editing:choose-editor', kind),
  clearEditor: (kind: string) => ipcRenderer.invoke('vera-external-editing:clear-editor', kind),
  onChanged: (listener: (change: unknown) => void) => {
    ipcRenderer.on('vera-external-editing:changed', (_event, change) => listener(change));
  },
});

contextBridge.exposeInMainWorld('veraVoiceConfiguration', {
  choosePath: (kind: string) => ipcRenderer.invoke('vera-voice:choose-path', kind),
});

contextBridge.exposeInMainWorld('veraLibrarianSecret', {
  status: () => ipcRenderer.invoke('vera-librarian-secret:status'),
  save: (input: { apiKey: string; endpoint: string; model: string }) =>
    ipcRenderer.invoke('vera-librarian-secret:save', input),
  clear: () => ipcRenderer.invoke('vera-librarian-secret:clear'),
});
