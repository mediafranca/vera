import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
  build?: {
    asar?: { unpack?: string[] };
    mac?: { universal?: { x64ArchFiles?: string } };
    extraResources?: Array<{ from?: string; to?: string }>;
  };
};
const documentReader = readFileSync(
  new URL('../../importer/src/document.ts', import.meta.url),
  'utf8',
);
const packageVerifier = readFileSync(
  new URL('../../../scripts/verify-desktop-package.mjs', import.meta.url),
  'utf8',
);
const desktopMain = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const desktopWorkflow = readFileSync(
  new URL('../../../.github/workflows/desktop.yml', import.meta.url),
  'utf8',
);

test('Desktop lleva el canvas nativo que PDF.js resuelve en ejecución', () => {
  assert.equal(root.dependencies?.['@napi-rs/canvas'], '0.1.80');
  assert.ok(root.build?.asar?.unpack?.includes('node_modules/@napi-rs/canvas*/**/*'));
  assert.equal(
    root.build?.mac?.universal?.x64ArchFiles,
    'Contents/Resources/app.asar.unpacked/node_modules/@napi-rs/canvas-*/**/*.node',
  );
  assert.match(packageVerifier, /canvas-win32-x64-msvc/);
  assert.match(packageVerifier, /canvas-darwin-arm64/);
  assert.match(packageVerifier, /canvas-darwin-x64/);
  assert.match(packageVerifier, /canvas-linux-x64-gnu/);
  assert.match(desktopWorkflow, /canvas-darwin-arm64@0\.1\.80/);
  assert.match(desktopWorkflow, /canvas-darwin-x64@0\.1\.80/);
});

test('la lectura de PDF no condiciona el arranque de una biblioteca', () => {
  assert.doesNotMatch(documentReader, /^import .* from 'pdf-parse';/m);
  assert.match(documentReader, /const \{ PDFParse \} = await import\('pdf-parse'\)/);
});

test('Desktop compone PDF y Mermaid con el Chromium incorporado', () => {
  assert.match(desktopMain, /webContents\.printToPDF/);
  assert.match(desktopMain, /pdfRenderer: renderPdfWithElectron/);
  assert.match(desktopMain, /diagramRenderer: renderDiagramsWithElectron/);
  assert.ok(root.build?.extraResources?.some((resource) => resource.to === 'mermaid.min.js'));
});

test('Desktop observa su MCP local y la disponibilidad del relay comunitario', () => {
  assert.match(desktopMain, /mcpStatusOrigin:\s*LOCAL_VERA_URL/);
  assert.match(desktopMain, /conectaHealthUrl:\s*VERA_CONECTA_HEALTH_URL/);
  assert.match(desktopMain, /https:\/\/conecta\.mediafranca\.net\/health/);
});

test('un cargador CommonJS distinto no convierte el actualizador en pantalla blanca', () => {
  assert.match(desktopMain, /updaterModule\.autoUpdater \?\? updaterModule\.default\?\.autoUpdater/);
  assert.match(desktopMain, /if \(autoUpdater === undefined\)/);
});
