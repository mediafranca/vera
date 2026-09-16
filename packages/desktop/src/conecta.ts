export type LinkStatus = 'desactivado' | 'conectando' | 'conectado' | 'esperando' | 'bloqueado';

export interface ConectaState {
  relayUrl: string;
  installationId: string;
  linkSecret: string;
  credentials: Record<string, { token: string; client: string; scopes: string[] }>;
}

export interface SecureConectaStore {
  available(): boolean;
  read(): ConectaState | null;
  write(state: ConectaState): void;
  clear(): void;
}

export interface ConectaStatus {
  status: LinkStatus;
  installationId: string | null;
  secureStorage: boolean;
  error?: string;
}

type LiveSocket = WebSocket;

const keyFor = (principal: string, scopes: readonly string[]): string =>
  `${principal}:${[...scopes].sort().join(',')}`;

export class DesktopConecta {
  private readonly store: SecureConectaStore;
  private readonly localUrl: string;
  private readonly notify: (status: ConectaStatus) => void;
  private socket: LiveSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private failures = 0;
  private current: ConectaStatus;

  constructor(
    store: SecureConectaStore,
    localUrl: string,
    notify: (status: ConectaStatus) => void = () => undefined,
  ) {
    this.store = store;
    this.localUrl = localUrl;
    this.notify = notify;
    const saved = store.read();
    this.current = {
      status: store.available() ? 'desactivado' : 'bloqueado',
      installationId: saved?.installationId ?? null,
      secureStorage: store.available(),
    };
  }

  status(): ConectaStatus {
    return this.current;
  }

  private report(status: LinkStatus, error?: string): void {
    this.current = {
      status,
      installationId: this.store.read()?.installationId ?? null,
      secureStorage: this.store.available(),
      ...(error === undefined ? {} : { error }),
    };
    this.notify(this.current);
  }

  async pair(relayUrl: string): Promise<{ installationId: string }> {
    if (!this.store.available()) {
      this.report('bloqueado', 'el sistema operativo no ofrece un almacén seguro');
      throw new Error('Vera Conecta requiere el almacén seguro del sistema operativo');
    }
    const challenge = await fetch(new URL('/pairings', relayUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version_ofrecida: 1 }),
    });
    if (!challenge.ok) throw new Error(`Vera Conecta rechazó el emparejamiento (${challenge.status})`);
    const { codigo } = (await challenge.json()) as { codigo?: unknown };
    if (typeof codigo !== 'string') throw new Error('Vera Conecta no devolvió un desafío válido');
    const claimed = await fetch(new URL(`/pairings/${encodeURIComponent(codigo)}/claim`, relayUrl), {
      method: 'POST',
    });
    if (!claimed.ok) throw new Error(`el desafío no pudo reclamarse (${claimed.status})`);
    const body = (await claimed.json()) as { id_publico?: unknown; secreto_de_enlace?: unknown };
    if (typeof body.id_publico !== 'string' || typeof body.secreto_de_enlace !== 'string') {
      throw new Error('Vera Conecta devolvió una identidad incompleta');
    }
    this.store.write({
      relayUrl,
      installationId: body.id_publico,
      linkSecret: body.secreto_de_enlace,
      credentials: {},
    });
    this.start();
    return { installationId: body.id_publico };
  }

  start(): void {
    if (!this.store.available()) {
      this.report('bloqueado', 'el sistema operativo no ofrece un almacén seguro');
      return;
    }
    if (this.store.read() === null || !this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.close(1000, 'desktop_stopped');
    this.socket = null;
    this.report('desactivado');
  }

  forget(): void {
    this.stop();
    this.store.clear();
  }

  private open(): void {
    const saved = this.store.read();
    if (this.stopped || saved === null || this.socket !== null) return;
    this.report('conectando');
    const url = new URL(`/v/${encodeURIComponent(saved.installationId)}/link`, saved.relayUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('prueba_de_secreto', saved.linkSecret);
    url.searchParams.set('version_ofrecida', '1');
    url.searchParams.set('identificador_efimero', crypto.randomUUID());
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.failures = 0;
      this.report('conectado');
      socket.send(JSON.stringify({ tipo: 'latido' }));
      this.heartbeat = setInterval(() => {
        if (this.socket === socket) socket.send(JSON.stringify({ tipo: 'latido' }));
      }, 30_000);
    });
    socket.addEventListener('message', (event) => void this.receive(socket, event.data));
    const lost = (): void => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.heartbeat !== null) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (this.stopped) return;
      this.failures += 1;
      this.report('esperando');
      const ceiling = Math.min(30_000, 1_000 * 2 ** (this.failures - 1));
      this.retry = setTimeout(() => {
        this.retry = null;
        this.open();
      }, Math.round(ceiling * (0.5 + Math.random() * 0.5)));
    };
    socket.addEventListener('close', lost);
    socket.addEventListener('error', lost);
  }

  private async receive(socket: LiveSocket, raw: unknown): Promise<void> {
    if (typeof raw !== 'string') return;
    let envelope: any;
    try { envelope = JSON.parse(raw); } catch { return; }
    if (envelope?.tipo !== 'sobre' || typeof envelope.request_id !== 'string') return;
    socket.send(JSON.stringify({ tipo: 'sobre_acuse', request_id: envelope.request_id }));
    const scopes = Array.isArray(envelope.alcances) ? envelope.alcances.filter((x: unknown) => typeof x === 'string') : [];
    const credential = await this.credential(String(envelope.principal_id ?? ''), scopes);
    if (credential === null) {
      socket.send(JSON.stringify({ tipo: 'sobre_respuesta', request_id: envelope.request_id,
        payload: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'acceso local no autorizado' } } }));
      return;
    }
    try {
      const response = await fetch(`${this.localUrl}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential.token}`, 'x-vera-client': credential.client,
          'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: String(envelope.cuerpo ?? ''),
      });
      const payload = await response.json();
      socket.send(JSON.stringify({ tipo: 'sobre_respuesta', request_id: envelope.request_id, payload }));
    } catch {
      socket.send(JSON.stringify({ tipo: 'sobre_respuesta', request_id: envelope.request_id,
        payload: { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Vera local no está disponible' } } }));
    }
  }

  private async credential(principal: string, scopes: string[]): Promise<{ token: string; client: string } | null> {
    const saved = this.store.read();
    if (saved === null || principal === '') return null;
    const key = keyFor(principal, scopes);
    const existing = saved.credentials[key];
    if (existing !== undefined) return existing;
    const deal = scopes.includes('write') ? 'propio' : 'leer';
    const client = `conecta-${principal.slice(0, 12)}`;
    const response = await fetch(`${this.localUrl}/mcp/connections`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Vera Conecta ${principal.slice(0, 8)}`, client, deal,
        ...(deal === 'propio' ? { kind: 'Captura remota', source: principal } : {}) }),
    });
    if (!response.ok) return null;
    const made = (await response.json()) as { secret?: unknown; client?: unknown };
    if (typeof made.secret !== 'string' || typeof made.client !== 'string') return null;
    saved.credentials[key] = { token: made.secret, client: made.client, scopes };
    this.store.write(saved);
    return saved.credentials[key];
  }
}
