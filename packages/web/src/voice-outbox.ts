// La voz pendiente: bytes que ya existen en este aparato y todavía no llegaron
// al almacén canónico.

export interface PendingRecording {
  id: string;
  hash: string;
  audio: Blob;
  mediaType: string;
  durationMs: number;
  placedInBlock: string;
  placedInPage: string;
  capturedAt: number;
  status: 'local' | 'sending';
}

export interface RecordingStore {
  put(recording: PendingRecording): Promise<void>;
  drop(id: string): Promise<void>;
  all(): Promise<PendingRecording[]>;
}

export interface VoiceOutbox {
  restore(): Promise<PendingRecording[]>;
  remember(recording: PendingRecording): Promise<void>;
  mark(id: string, status: PendingRecording['status']): Promise<void>;
  settle(id: string): Promise<void>;
  pending(): PendingRecording[];
}

/** La identidad canónica de una grabación ya sale de sus propios bytes. */
export async function identityOf(audio: Blob): Promise<{ hash: string; id: string }> {
  const digest = await crypto.subtle.digest('SHA-256', await audio.arrayBuffer());
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { hash, id: `recording:${hash.slice(0, 16)}` };
}

export function createVoiceOutbox(store: RecordingStore): VoiceOutbox {
  const pending = new Map<string, PendingRecording>();
  const ordered = (): PendingRecording[] => [...pending.values()]
    .sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id));

  return {
    restore: async () => {
      for (const recording of await store.all()) {
        const local = recording.status === 'sending' ? { ...recording, status: 'local' as const } : recording;
        pending.set(local.id, local);
        if (local !== recording) await store.put(local);
      }
      return ordered();
    },
    remember: async (recording) => {
      await store.put(recording);
      pending.set(recording.id, recording);
    },
    mark: async (id, status) => {
      const recording = pending.get(id);
      if (recording === undefined) return;
      const next = { ...recording, status };
      await store.put(next);
      pending.set(id, next);
    },
    settle: async (id) => {
      await store.drop(id);
      pending.delete(id);
    },
    pending: ordered,
  };
}

export function inMemoryVoiceStore(): RecordingStore {
  const held = new Map<string, PendingRecording>();
  return {
    put: async (recording) => void held.set(recording.id, recording),
    drop: async (id) => void held.delete(id),
    all: async () => [...held.values()],
  };
}

const DB = 'vera-voice-outbox';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function within<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('pending', mode);
    const request = act(transaction.objectStore('pending'));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export function indexedDbVoiceStore(): RecordingStore {
  return {
    put: (recording) => within<void>('readwrite', (store) => store.put(recording)),
    drop: (id) => within<void>('readwrite', (store) => store.delete(id)),
    all: () => within<PendingRecording[]>('readonly', (store) => store.getAll()),
  };
}

export async function durableVoiceStore(): Promise<{ store: RecordingStore; durable: boolean }> {
  if (typeof indexedDB === 'undefined') return { store: inMemoryVoiceStore(), durable: false };
  try {
    const store = indexedDbVoiceStore();
    await store.all();
    return { store, durable: true };
  } catch {
    return { store: inMemoryVoiceStore(), durable: false };
  }
}
