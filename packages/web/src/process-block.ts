export interface ProcessInvocationSource {
  definition: string;
  version: number;
  input: string;
}

export interface ProcessResult {
  content: string;
  durationMs: number;
  inputRevision: string;
}

const OPEN = '```proceso';

export function writeProcessBlock(input: string): string {
  return `${OPEN}\ndefinición: vera/estructura-textual\nversión: 1\nentrada: ((${input}))\n\`\`\``;
}

export function readProcessBlock(content: string): ProcessInvocationSource | null {
  const lines = content.trim().split(/\r?\n/);
  if (lines[0]?.trim().toLowerCase() !== OPEN || lines.at(-1)?.trim() !== '```') return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, -1)) {
    const split = line.indexOf(':');
    if (split < 0) continue;
    fields.set(line.slice(0, split).trim().toLowerCase(), line.slice(split + 1).trim());
  }
  const definition = fields.get('definición') ?? '';
  const version = Number(fields.get('versión'));
  const input = /^\(\(([^)]+)\)\)$/.exec(fields.get('entrada') ?? '')?.[1]?.trim() ?? '';
  if (definition === '' || !Number.isInteger(version) || version < 1 || input === '') return null;
  return { definition, version, input };
}

export function looksLikeProcess(content: string): boolean {
  return readProcessBlock(content) !== null;
}

function hexadecimal(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Ejecuta la primera definición incorporada sin darle acceso al DOM ni al grafo.
 * El Worker sólo recibe texto y sólo puede devolver datos serializables.
 */
export async function executeTextStructure(text: string, timeoutMs = 2_000): Promise<ProcessResult> {
  const started = performance.now();
  const revision = hexadecimal(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const source = `self.onmessage = ({ data }) => {
    const text = String(data);
    const lines = text.split(/\\r?\\n/).filter((line) => line.trim() !== '');
    const words = text.trim() === '' ? [] : text.trim().split(/\\s+/);
    const sentences = text.split(/(?<=[.!?])\\s+/).map((part) => part.trim()).filter(Boolean);
    self.postMessage({ source: text, structure: { lines, sentences, words }, measures: { characters: text.length, words: words.length, lines: lines.length } });
  };`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        worker.terminate();
        reject(new Error('el proceso excedió su plazo'));
      }, timeoutMs);
      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        window.clearTimeout(timer);
        resolve(event.data);
      }, { once: true });
      worker.addEventListener('error', () => {
        window.clearTimeout(timer);
        reject(new Error('el proceso no pudo ejecutarse'));
      }, { once: true });
      worker.postMessage(text);
    });
    return {
      content: `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
      durationMs: Math.max(0, performance.now() - started),
      inputRevision: revision,
    };
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

