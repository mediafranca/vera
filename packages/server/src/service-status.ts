// Salud observable de las puertas de Vera.
//
// Un puerto abierto no basta. Cada prueba exige la respuesta propia del
// protocolo: MCP debe presentar su desafío Bearer y Vera Conecta debe declarar
// su identidad, estado y versión. La superficie recibe sólo el resultado; las
// direcciones internas y cualquier detalle operativo permanecen en el servidor.

export type ObservedServiceCondition = 'available' | 'degraded' | 'unavailable' | 'unknown';

export interface ObservedServiceStatus {
  id: 'mcp' | 'conecta';
  service: string;
  condition: ObservedServiceCondition;
  detail: string;
  checkedAt: number;
  latencyMs: number | null;
}

export interface ServiceStatusOptions {
  mcpOrigin?: string;
  conectaHealthUrl?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

async function measured(
  run: (signal: AbortSignal) => Promise<{ condition: ObservedServiceCondition; detail: string }>,
  now: () => number,
  timeoutMs: number,
): Promise<Omit<ObservedServiceStatus, 'id' | 'service'>> {
  const began = now();
  try {
    const result = await run(AbortSignal.timeout(timeoutMs));
    const finished = now();
    return { ...result, checkedAt: finished, latencyMs: Math.max(0, finished - began) };
  } catch {
    return {
      condition: 'unavailable',
      detail: 'El servicio no respondió dentro del plazo de comprobación.',
      checkedAt: now(),
      latencyMs: null,
    };
  }
}

export async function observeServiceStatuses(
  options: ServiceStatusOptions,
): Promise<ObservedServiceStatus[]> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 3_000;

  const mcp = options.mcpOrigin === undefined
    ? Promise.resolve<Omit<ObservedServiceStatus, 'id' | 'service'>>({
        condition: 'unknown',
        detail: 'Esta Vera no tiene una puerta MCP pública configurada.',
        checkedAt: now(),
        latencyMs: null,
      })
    : measured(async (signal) => {
        const response = await fetcher(new URL('/mcp', options.mcpOrigin), {
          method: 'POST',
          signal,
        });
        const challenge = response.headers.get('www-authenticate') ?? '';
        return response.status === 401 && /^Bearer\b/i.test(challenge)
          ? { condition: 'available', detail: 'La puerta MCP responde y exige una credencial.' }
          : { condition: 'degraded', detail: 'La puerta MCP respondió sin presentar el desafío esperado.' };
      }, now, timeoutMs);

  const conecta = options.conectaHealthUrl === undefined
    ? Promise.resolve<Omit<ObservedServiceStatus, 'id' | 'service'>>({
        condition: 'unknown',
        detail: 'Vera Conecta no tiene una comprobación configurada.',
        checkedAt: now(),
        latencyMs: null,
      })
    : measured(async (signal) => {
        const response = await fetcher(options.conectaHealthUrl!, { signal });
        if (!response.ok) {
          return { condition: 'unavailable', detail: `Vera Conecta respondió con estado ${response.status}.` };
        }
        const body = await response.json() as { service?: unknown; status?: unknown; protocol?: unknown };
        return body.service === 'vera-conecta' && body.status === 'ok' && body.protocol === 1
          ? { condition: 'available', detail: 'El servicio comunitario de Vera Conecta responde normalmente.' }
          : { condition: 'degraded', detail: 'Vera Conecta respondió con una identidad o versión inesperada.' };
      }, now, timeoutMs);

  const [mcpStatus, conectaStatus] = await Promise.all([mcp, conecta]);
  return [
    { id: 'mcp', service: 'MCP', ...mcpStatus },
    { id: 'conecta', service: 'Conecta', ...conectaStatus },
  ];
}
