import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { DesktopConecta, type ConectaState, type SecureConectaStore } from '../src/conecta.ts';

class MemoryStore implements SecureConectaStore {
  state: ConectaState | null = null;
  private readonly secure: boolean;
  constructor(secure = true) { this.secure = secure; }
  available(): boolean { return this.secure; }
  read(): ConectaState | null { return this.state === null ? null : structuredClone(this.state); }
  write(state: ConectaState): void { this.state = structuredClone(state); }
  clear(): void { this.state = null; }
}

class FakeSocket extends EventTarget {
  sent: string[] = [];
  readonly url: string;
  constructor(url: string) { super(); this.url = url; }
  send(value: string): void { this.sent.push(value); }
  close(): void { this.dispatchEvent(new Event('close')); }
}

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

describe('Vera Conecta dentro de Desktop', () => {
  it('rechaza activar si el sistema no ofrece custodia segura real', async () => {
    const conecta = new DesktopConecta(new MemoryStore(false), 'http://127.0.0.1:4173');
    await assert.rejects(() => conecta.pair('https://conecta.example'), /almacén seguro/);
    assert.equal(conecta.status().status, 'bloqueado');
  });

  it('empareja, guarda el secreto fuera del corpus y abre un enlace saliente', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return url.endsWith('/pairings')
        ? Response.json({ codigo: 'una-vez' }, { status: 201 })
        : Response.json({ id_publico: 'instalacion-1', secreto_de_enlace: 'secreto' }, { status: 201 });
    }) as typeof fetch;
    let socket: FakeSocket | null = null;
    globalThis.WebSocket = class {
      constructor(url: string | URL) {
        socket = new FakeSocket(String(url));
        return socket as unknown as WebSocket;
      }
    } as unknown as typeof WebSocket;

    const store = new MemoryStore();
    const conecta = new DesktopConecta(store, 'http://127.0.0.1:4173');
    const paired = await conecta.pair('https://conecta.example');

    assert.equal(paired.installationId, 'instalacion-1');
    assert.equal(store.state?.linkSecret, 'secreto');
    assert.deepEqual(calls, [
      'https://conecta.example/pairings',
      'https://conecta.example/pairings/una-vez/claim',
    ]);
    assert.match(socket?.url ?? '', /^wss:\/\/conecta\.example\/v\/instalacion-1\/link\?/);
    assert.doesNotMatch(JSON.stringify(conecta.status()), /secreto/);
    conecta.stop();
  });

  it('olvidar detiene el enlace y elimina el material cifrado', () => {
    const store = new MemoryStore();
    store.state = {
      relayUrl: 'https://conecta.example', installationId: 'i', linkSecret: 's', credentials: {},
    };
    globalThis.WebSocket = class {
      constructor(url: string | URL) { return new FakeSocket(String(url)) as unknown as WebSocket; }
    } as unknown as typeof WebSocket;
    const conecta = new DesktopConecta(store, 'http://127.0.0.1:4173');
    conecta.start();
    conecta.forget();
    assert.equal(store.state, null);
    assert.equal(conecta.status().status, 'desactivado');
  });
});
