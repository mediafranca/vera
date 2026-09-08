import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('../src/graph/renderD4.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('interacción de D4', () => {
  it('acusa el cambio de foco antes de esperar el nuevo vecindario', () => {
    assert.match(renderer, /const focusNow = \(\): void =>/);
    assert.match(renderer, /focusNow\(\);\s*onClickPage\(node\.id\)/);
  });

  it('no transforma el SVG que contiene foreignObject', () => {
    const rule = styles.match(/\.d4-map\s*\{[^}]*\}/s)?.[0] ?? '';
    assert.doesNotMatch(rule, /animation\s*:/);
    assert.doesNotMatch(styles, /@keyframes\s+d4-arrive/);
  });

  it('usa una sola cámara viewBox en iOS y conserva la matriz SVG de escritorio', () => {
    assert.match(renderer, /world\.selectAll<SVGGraphicsElement, unknown>\('\.d4-branch, \.d4-branch-hit, \.d4-thread, \.d4-thread-stop'\)[\s\S]*?\.attr\('transform', viewport\.toString\(\)\)/);
    assert.doesNotMatch(renderer, /world\.attr\('transform'/);
    assert.match(renderer, /const iosWebKit = \/iP/);
    assert.match(renderer, /if \(iosWebKit\) \{[\s\S]*?svg\.attr\([\s\S]*?'viewBox'/);
    assert.match(renderer, /-viewport\.x \/ viewport\.k/);
    assert.match(renderer, /width \/ viewport\.k/);
    assert.match(renderer, /if \(iosWebKit\) return;[\s\S]*?entry\.foreign\.attr\('transform', viewport\.toString\(\)\)/);
    assert.doesNotMatch(renderer, /entry\.card\.style\('transform'/);
    assert.match(renderer, /style\('height', `\$\{dim\.h\}px`\)/);
    assert.match(renderer, /svg\.append\('foreignObject'\)[\s\S]*?\.attr\('class', 'd4-card'\)/);
    assert.doesNotMatch(renderer, /world\.append\('foreignObject'\)/);
    assert.doesNotMatch(renderer, /\.attr\('transform', viewport\.toString\(\)\)[\s;]*\n\s*foreign/);
  });

  it('deja un solo scroll vertical en el editor de una relación', () => {
    assert.match(renderer, /const maximum = height \* 0\.8/);
    assert.match(renderer, /field\.style\.height = `\$\{field\.scrollHeight\}px`/);
    assert.match(styles, /\.d4-relation-block textarea\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*hidden;/);
    assert.match(styles, /\.d4-relation\.expanded\s*\{[\s\S]*?overflow:\s*auto;/);
  });

  it('elige el hover por la franja colapsada e ignora la proyección desplegada', () => {
    assert.match(renderer, /foldedLines[\s\S]*?getBoundingClientRect\(\)/);
    assert.match(renderer, /classList\.add\('hovered'\)/);
    assert.doesNotMatch(styles, /\.d4-line:hover[\s,{]/);
    assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.d4-line-content \{ pointer-events: none; \}/);
  });

  it('eleva la tarjeta completa al leer un bloque', () => {
    assert.match(renderer, /const raiseReadingCards =/);
    assert.match(renderer, /for \(const foreign of reading\) d3\.select\(foreign\)\.raise\(\)/);
    assert.match(renderer, /raiseReadingCards\(foreign\.node\(\)\)/);
    assert.match(renderer, /for \(const sibling of foldedLines\)/);
  });

  it('hace seleccionable una conectiva con un blanco táctil amplio', () => {
    assert.match(renderer, /attr\('class', 'd4-branch-hit'\)/);
    assert.match(styles, /\.d4-branch-hit\s*\{[\s\S]*?stroke-width:\s*44/);
    assert.match(renderer, /openRelations\.add\(crossing\)/);
  });

  it('enfoca una relación como lugar de trabajo y rectifica su cable', () => {
    assert.match(renderer, /let focusedRelation: string \| null = null/);
    assert.match(renderer, /held\.set\(source, \{ x: centreX - editorHalfWidth/);
    assert.match(renderer, /held\.set\(target, \{ x: centreX \+ editorHalfWidth/);
    assert.match(renderer, /isFocused\s*\? `M\$\{x1\},\$\{height \/ 2\} L\$\{x2\},\$\{height \/ 2\}`/);
    assert.match(renderer, /focusedRelation = crossing/);
    assert.match(renderer, /if \(focusedRelation === crossing\) focusedRelation = null/);
    assert.match(styles, /\.d4-map\.relation-focused \.d4-branch\.context\s*\{[^}]*opacity:\s*0\.1/);
    assert.match(styles, /\.d4-page\.relation-context\s*\{[^}]*opacity:\s*0\.16/);
  });

  it('separa páginas y puertos según la geometría interactiva, no la altura del viewport', () => {
    assert.match(renderer, /const branchHitWidth = 44/);
    assert.match(renderer, /const nodeGap = branchHitWidth \+ 12/);
    assert.match(renderer, /y \+= dim\.h \+ nodeGap/);
    assert.match(renderer, /const targetY = \(node: GraphNode, link: GraphLink\): number =>/);
    assert.match(renderer, /const y2 = targetY\(target, link\)/);
    assert.doesNotMatch(renderer, /const y2 = b\.y/);
  });

  it('relaja las columnas como anclas blandas y evita colisiones entre tarjetas', () => {
    assert.match(renderer, /const anchors = new Map/);
    assert.match(renderer, /for \(let pass = 0; pass < 144; pass \+= 1\)/);
    assert.match(renderer, /const spring = link\.kind === 'crossing' \? 0\.018 : 0\.009/);
    assert.match(renderer, /const desiredX =/);
    assert.match(renderer, /const overlapX =/);
    assert.match(renderer, /const overlapY =/);
    assert.match(renderer, /position\.x \+= \(anchor\.x - position\.x\) \* 0\.048/);
  });

  it('declara la dirección y permite abrir incluso una relación vacía desde el cable', () => {
    assert.match(renderer, /attr\('id', 'd4-relation-arrow'\)/);
    assert.match(renderer, /path\.attr\('marker-end', 'url\(#d4-relation-arrow\)'\)/);
    assert.match(renderer, /if \(link\.kind === 'crossing' && link\.crossing !== undefined\) \{/);
    assert.match(renderer, /attr\('class', 'd4-branch-hit'\)/);
    assert.match(renderer, /options\.relations\.createRelation\(source\.id, target\.id\)/);
    assert.match(renderer, /attr\('aria-label', link\.crossing === undefined/);
  });

  it('proyecta el árbol canónico de bloques sin aplanarlo en una etiqueta', () => {
    assert.match(renderer, /const byParent = new Map<string \| null, typeof blocks>/);
    assert.match(renderer, /drawBlocks\(block\.stableId, depth \+ 1\)/);
    assert.match(renderer, /options\.relations\.editBlock\(block\.stableId, content\)/);
    assert.match(renderer, /options\.relations!\.createBlock!\(crossing, source\.id, null, roots\.length\)/);
  });

  it('abre un editor enfocado incluso cuando la conectiva todavía no tiene texto', () => {
    assert.match(renderer, /if \(blocks\.length === 0 && options\.relations\?\.createBlock !== undefined\)/);
    assert.match(renderer, /attr\('class', 'd4-relation-empty'\)/);
    assert.match(renderer, /createBlock!\(crossing, source\.id, null, 0, content\)/);
    assert.match(renderer, /window\.setTimeout\(\(\) => empty\.node\(\)\?\.focus\(\), 0\)/);
    assert.match(styles, /\.d4-relation-empty\s*\{/);
  });

  it('dibuja el recorrido completo como hilo ordenado y no como aristas nuevas', () => {
    assert.match(renderer, /const thread = options\.thread \?\? null/);
    assert.match(renderer, /thread\.kinds\.forEach\(\(kind, index\) =>/);
    assert.match(renderer, /thread\.stops\[index \+ 1\]/);
    assert.match(renderer, /attr\('class', `d4-thread \$\{kind === 'by_path' \? 'by-path' : 'open-ground'\}`\)/);
    assert.match(renderer, /attr\('class', 'd4-thread-stop'\)/);
    assert.match(renderer, /\.text\(ordinals\.join\(' · '\)\)/);
    assert.match(renderer, /thread !== null && node\.id === thread\.page/);
    assert.doesNotMatch(renderer, /data\.links\.push\([^)]*thread/s);
  });
});
