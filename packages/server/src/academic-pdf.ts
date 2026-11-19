// Extracción académica local y trazable.
//
// GROBID entrega TEI para artículos nacidos digitales; Docling queda como
// segunda vía para disposiciones complejas. Ambos producen un artefacto que se
// conserva junto al PDF. Si ninguno está disponible, el importador aplica su
// limpieza determinista sobre PDF.js.

import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { DOMParser } from '@xmldom/xmldom';

import type { AcademicPdfExtraction } from '@vera/importer/document';
import { findTool } from './transcribe.ts';

const run = promisify(execFile);

const local = (element: Element, name: string): Element[] => {
  const nodes = element.getElementsByTagNameNS('*', name);
  return Array.from({ length: nodes.length }, (_, index) => nodes.item(index)).filter((one): one is Element => one !== null);
};

const own = (element: Element, name: string): Element[] => Array.from(element.childNodes)
  .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === name);

const plain = (node: Node | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Convierte la estructura semántica de GROBID sin reescribir su contenido. */
export function teiToMarkdown(tei: string): { markdown: string; title: string | null } | null {
  const document = new DOMParser().parseFromString(tei, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) return null;
  const root = document.documentElement;
  if (root === null) return null;

  const titleNode = local(root, 'title').find((element) => {
    const parent = element.parentNode as Element | null;
    return parent?.localName === 'titleStmt';
  }) ?? local(root, 'title')[0] ?? null;
  const title = plain(titleNode) || null;
  const lines: string[] = [];
  if (title !== null) lines.push(`# ${title}`);

  const abstracts = local(root, 'abstract');
  for (const abstract of abstracts) {
    const paragraphs = local(abstract, 'p').map(plain).filter(Boolean);
    if (paragraphs.length > 0) lines.push('## Resumen', ...paragraphs);
  }

  const renderSection = (division: Element, depth: number): void => {
    const heading = own(division, 'head').map(plain).find(Boolean);
    if (heading !== undefined) lines.push(`${'#'.repeat(Math.min(6, depth + 1))} ${heading}`);
    for (const child of Array.from(division.childNodes)) {
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (element.localName === 'p') {
        const text = plain(element);
        if (text !== '') lines.push(text);
      } else if (element.localName === 'div') {
        renderSection(element, depth + 1);
      }
    }
  };
  const body = local(root, 'body')[0];
  if (body !== undefined) {
    for (const child of Array.from(body.childNodes)) {
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (element.localName === 'div') renderSection(element, 1);
      else if (element.localName === 'p') {
        const text = plain(element);
        if (text !== '') lines.push(text);
      }
    }
  }

  const bibliography = local(root, 'listBibl')[0];
  if (bibliography !== undefined) {
    const entries = local(bibliography, 'biblStruct').map(plain).filter(Boolean);
    if (entries.length > 0) lines.push('## Referencias', ...entries.map((entry) => `- ${entry}`));
  }

  const markdown = lines.join('\n\n').trim();
  return markdown === '' ? null : { markdown, title };
}

async function withGrobid(bytes: Buffer, filename: string, baseUrl: string): Promise<AcademicPdfExtraction | null> {
  const form = new FormData();
  form.append('input', new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' }), filename);
  form.append('consolidateHeader', '0');
  form.append('consolidateCitations', '0');
  form.append('includeRawCitations', '1');
  form.append('teiCoordinates', 's');
  form.append('teiCoordinates', 'figure');
  form.append('teiCoordinates', 'biblStruct');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/processFulltextDocument`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) return null;
  const tei = await response.text();
  const converted = teiToMarkdown(tei);
  if (converted === null) return null;
  return {
    ...converted,
    engine: 'grobid',
    losses: ['figuras y tablas permanecen en el PDF original y en el TEI estructurado'],
    artifact: {
      filename: `${basename(filename, extname(filename))}.grobid.tei.xml`,
      mediaType: 'application/tei+xml',
      bytes: Buffer.from(tei),
    },
  };
}

const filesBelow = (root: string): string[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
};

async function withDocling(bytes: Buffer, filename: string, command: string): Promise<AcademicPdfExtraction | null> {
  const work = await mkdtemp(join(tmpdir(), 'vera-docling-'));
  try {
    const source = join(work, filename.replace(/[^a-zA-Z0-9._-]/g, '_'));
    const output = join(work, 'out');
    await writeFile(source, bytes);
    await run(command, ['convert', source, '--to', 'md', '--to', 'json', '--output', output], {
      timeout: 5 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const produced = filesBelow(output);
    const markdownPath = produced.find((path) => path.endsWith('.md'));
    if (markdownPath === undefined) return null;
    const markdown = await readFile(markdownPath, 'utf8');
    if (markdown.trim() === '') return null;
    const jsonPath = produced.find((path) => path.endsWith('.json'));
    const artifactBytes = jsonPath === undefined ? Buffer.from(markdown) : await readFile(jsonPath);
    const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? null;
    return {
      markdown,
      title,
      engine: 'docling',
      artifact: {
        filename: `${basename(filename, extname(filename))}.docling.${jsonPath === undefined ? 'md' : 'json'}`,
        mediaType: jsonPath === undefined ? 'text/markdown' : 'application/json',
        bytes: artifactBytes,
      },
    };
  } catch {
    return null;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** La ausencia o falla de un ayudante no bloquea el extractor incorporado. */
export async function extractAcademicPdf(bytes: Buffer, filename: string): Promise<AcademicPdfExtraction | null> {
  // La distribución oficial de GROBID escucha aquí. Una variable vacía lo
  // desactiva; otra URL permite una instalación administrada sin cambiar Vera.
  const declaredGrobid = process.env['VERA_GROBID_URL'];
  const grobid = declaredGrobid === '' ? null : declaredGrobid ?? 'http://127.0.0.1:8070';
  if (grobid !== null) {
    try {
      const extracted = await withGrobid(bytes, filename, grobid);
      if (extracted !== null) return extracted;
    } catch {
      // La siguiente vía conserva la capacidad de importar sin red ni servicio.
    }
  }
  const docling = findTool(['docling'], process.env['VERA_DOCLING']);
  return docling === null ? null : withDocling(bytes, filename, docling);
}
