// Almacén de objetos direccionado por contenido.
//
// Los binarios no viven en SQLite. La base conserva identidad, hash, tipo,
// tamaño y procedencia; los bytes viven aquí, bajo el SHA-256 de su contenido.
//
// @invariant SourceFidelity: el original nunca se reemplaza ni se transcodifica.
// Direccionar por contenido lo vuelve estructural: la ruta de un objeto es su
// hash, así que escribir otros bytes es escribir otro objeto, y escribir los
// mismos no cambia nada. Un archivo guardado no se puede pisar por accidente.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Un hash con esta forma, y ninguna otra, puede convertirse en una ruta. */
export const HASH = /^[0-9a-f]{64}$/;

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Se reparte en dos niveles por el primer byte del hash. Con 94 objetos daría
 * igual, pero un directorio plano deja de ser manejable mucho antes de que
 * alguien se acuerde de cambiarlo.
 */
export function objectPath(root: string, hash: string): string {
  if (!HASH.test(hash)) throw new Error(`hash inválido: ${hash}`);
  return join(root, hash.slice(0, 2), hash.slice(2));
}

export function hasObject(root: string, hash: string): boolean {
  return HASH.test(hash) && existsSync(objectPath(root, hash));
}

export interface StoredObject {
  hash: string;
  byteSize: number;
  /** Falso cuando el objeto ya estaba: dos referencias al mismo archivo lo comparten. */
  written: boolean;
}

/**
 * Guarda los bytes bajo su hash. Escribe primero a un temporal y renombra, para
 * que un objeto a medio escribir nunca sea visible bajo su nombre definitivo.
 */
export function putObject(root: string, bytes: Uint8Array): StoredObject {
  const hash = hashBytes(bytes);
  const target = objectPath(root, hash);

  if (existsSync(target)) return { hash, byteSize: bytes.byteLength, written: false };

  mkdirSync(dirname(target), { recursive: true });
  const pending = `${target}.pending`;
  writeFileSync(pending, bytes);
  renameSync(pending, target);

  return { hash, byteSize: bytes.byteLength, written: true };
}

export function readObject(root: string, hash: string): Uint8Array {
  return readFileSync(objectPath(root, hash));
}

export function objectSize(root: string, hash: string): number {
  return statSync(objectPath(root, hash)).size;
}

// ---------------------------------------------------------------------------
// Tipos de medio
// ---------------------------------------------------------------------------

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  markdown: 'text/markdown; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  edn: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  mp4: 'video/mp4',
};

/** Se deduce de la extensión, que es lo que el corpus declara. */
export function mediaTypeFor(name: string): string {
  const extension = /\.([a-zA-Z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  return MEDIA_TYPES[extension] ?? 'application/octet-stream';
}

const SIGNATURES: { type: string; bytes: number[] }[] = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

/**
 * Lo que los primeros bytes dicen que es, o `null` si no lo declaran.
 *
 * Hace falta porque la extensión miente. El corpus trae cuatro archivos con
 * nombre `.png` y `.jpg` que en realidad son páginas de error HTML de una
 * descarga que falló. Guardar `image/png` para eso sería registrar una mentira
 * y, peor, presentarla como si fuera una imagen.
 */
export function sniffMediaType(bytes: Uint8Array): string | null {
  for (const signature of SIGNATURES) {
    if (signature.bytes.every((byte, at) => bytes[at] === byte)) return signature.type;
  }

  const head = new TextDecoder('utf8', { fatal: false })
    .decode(bytes.subarray(0, 200))
    .trimStart()
    .toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'text/html';
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';

  return null;
}

/** Lo que el navegador presenta dentro de la página sin abrir otra aplicación. */
export function isPresentableImage(mediaType: string): boolean {
  return mediaType.startsWith('image/');
}
