export interface PictosApiOptions {
  baseUrl: string;
  key: string;
  timeoutMs?: number;
}

export interface PictosApiResult {
  content: string;
  executor: string;
  requestId: string;
  processVersion: string;
  schemaId: string;
  schemaVersion: string;
  model: string;
}

interface PictosEnvelope {
  executor?: unknown;
  request_id?: unknown;
  process?: { version?: unknown };
  schema?: { id?: unknown; version?: unknown };
  model?: { actual?: unknown };
  output?: unknown;
  error?: { message?: unknown };
}

const fencedJson = (value: unknown): string =>
  `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/**
 * Frontera servidor→servidor con PICTOS. La llave nunca llega al navegador y
 * Vera conserva el artefacto nativo, no una reducción inventada localmente.
 */
export async function runPictosApi(
  options: PictosApiOptions,
  phase: 'comprender' | 'componer',
  input: string,
): Promise<PictosApiResult | { error: string }> {
  let body: Record<string, unknown>;
  if (phase === 'comprender') {
    const utterance = input.trim();
    if (utterance === '') return { error: 'Comprender necesita una frase' };
    body = {
      utterance,
      config: { lang: 'es-419', geoContext: { region: 'Chile' }, domainContext: 'hogar' },
    };
  } else {
    const raw = /^```json\s*\n([\s\S]*?)\n```/m.exec(input)?.[1] ?? input;
    let nlu: unknown;
    try { nlu = JSON.parse(raw); }
    catch { return { error: 'Componer necesita la salida JSON aceptada de Comprender' }; }
    body = { nlu, config: { domainContext: 'hogar' } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 55_000);
  try {
    const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/api/v1/${phase}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const envelope = await response.json().catch(() => ({})) as PictosEnvelope;
    if (!response.ok) {
      const message = typeof envelope.error?.message === 'string'
        ? envelope.error.message
        : `PICTOS respondió ${response.status}`;
      return { error: message };
    }
    if (
      envelope.output === undefined ||
      typeof envelope.executor !== 'string' ||
      typeof envelope.request_id !== 'string' ||
      typeof envelope.process?.version !== 'string' ||
      typeof envelope.schema?.id !== 'string' ||
      typeof envelope.schema.version !== 'string' ||
      typeof envelope.model?.actual !== 'string'
    ) return { error: 'PICTOS devolvió una respuesta incompleta' };
    return {
      content: fencedJson(envelope.output),
      executor: envelope.executor,
      requestId: envelope.request_id,
      processVersion: envelope.process.version,
      schemaId: envelope.schema.id,
      schemaVersion: envelope.schema.version,
      model: envelope.model.actual,
    };
  } catch (error) {
    return {
      error: error instanceof Error && error.name === 'AbortError'
        ? 'PICTOS excedió su plazo'
        : 'PICTOS no está disponible',
    };
  } finally {
    clearTimeout(timer);
  }
}
