export interface ProcessConnection {
  baseUrl: string;
  key: string;
  timeoutMs?: number;
}

export interface RemoteProcessRequest {
  path: string;
  method: 'POST';
  body: unknown;
}

/**
 * Ejecuta una declaración HTTP del bloque contra una conexión gobernada.
 * La fuente elige ruta y cuerpo; la instalación conserva host y credencial.
 */
export async function runRemoteProcess(
  connection: ProcessConnection,
  request: RemoteProcessRequest,
): Promise<{ response: unknown } | { error: string }> {
  if (!request.path.startsWith('/') || request.path.startsWith('//')) {
    return { error: 'la ruta remota debe ser relativa a la conexión' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), connection.timeoutMs ?? 55_000);
  try {
    const response = await fetch(`${connection.baseUrl.replace(/\/$/, '')}${request.path}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${connection.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
      redirect: 'error',
    });
    const body = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) {
      const message = body !== null && typeof body === 'object' && !Array.isArray(body) &&
        typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
        ? String((body as { error: { message: string } }).error.message)
        : `el servicio remoto respondió ${response.status}`;
      return { error: message };
    }
    return { response: body };
  } catch (error) {
    return {
      error: error instanceof Error && error.name === 'AbortError'
        ? 'el proceso remoto excedió su plazo'
        : 'el servicio remoto no está disponible',
    };
  } finally {
    clearTimeout(timer);
  }
}
