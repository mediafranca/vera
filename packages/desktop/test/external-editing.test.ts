import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DesktopExternalEditing, type DesktopExternalEditInput } from '../src/external-editing.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    // Los directorios son fixtures efímeros creados por esta prueba.
    rmSync(root, { recursive: true, force: true });
  }
});

const input = (content = '# Página\n\n- bloque'): DesktopExternalEditInput => ({
  sessionId: 'session:uno',
  fileName: 'Página.md',
  content,
  manifest: {
    version: 1,
    sessionId: 'session:uno',
    target: { graph: 'graph:vera', kind: 'page_markdown', page: 'page:uno' },
    baseSequence: 42,
    stableBlockIds: ['block:uno'],
    status: 'active',
  },
});

describe('puente Desktop de edición externa', () => {
  it('crea fuente y manifiesto lateral y abre sólo la fuente', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vera-external-'));
    roots.push(root);
    const opened: string[] = [];
    const bridge = new DesktopExternalEditing(root, async (path) => { opened.push(path); }, () => {});

    const view = await bridge.open(input());
    assert.equal(view.content, '# Página\n\n- bloque');
    assert.equal(view.manifest.target.page, 'page:uno');
    assert.equal(opened.length, 1);
    assert.equal(opened[0]?.endsWith('Página.md'), true);
    assert.equal(readFileSync(join(root, 'session:uno', 'manifest.json'), 'utf8').includes('block:uno'), true);
    bridge.stopAll();
  });

  it('reabrir conserva el borrador ya guardado', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vera-external-'));
    roots.push(root);
    const bridge = new DesktopExternalEditing(root, async () => {}, () => {});
    const first = await bridge.open(input());
    writeFileSync(join(root, first.sessionId, first.fileName), 'borrador de Luca');
    const reopened = await bridge.open(input('proyección nueva que no debe pisar'));
    assert.equal(reopened.content, 'borrador de Luca');
    bridge.stopAll();
  });

  it('observa un guardado atómico sin leer el temporal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vera-external-'));
    roots.push(root);
    const changes: string[] = [];
    const bridge = new DesktopExternalEditing(root, async () => {}, (_id, content) => changes.push(content));
    const view = await bridge.open(input());
    const source = join(root, view.sessionId, view.fileName);
    const temporary = `${source}.editor-tmp`;
    writeFileSync(temporary, 'guardado atómico');
    renameSync(temporary, source);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(changes, ['guardado atómico']);
    bridge.stopAll();
  });

  it('aceptar o descartar cierra la observación pero conserva el material', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vera-external-'));
    roots.push(root);
    const bridge = new DesktopExternalEditing(root, async () => {}, () => {});
    const view = await bridge.open(input());
    assert.equal(bridge.close(view.sessionId, 'accepted').manifest.status, 'accepted');
    assert.equal(bridge.read(view.sessionId).content, '# Página\n\n- bloque');
  });

  it('rechaza identidades y nombres que puedan salir del directorio gobernado', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vera-external-'));
    roots.push(root);
    const bridge = new DesktopExternalEditing(root, async () => {}, () => {});
    await assert.rejects(() => bridge.open({ ...input(), sessionId: '../fuera' }), /no es seguro/);
    await assert.rejects(() => bridge.open({ ...input(), fileName: '..' }), /no es seguro/);
  });
});
