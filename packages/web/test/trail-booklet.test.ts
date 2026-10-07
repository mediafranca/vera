import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('el rastro hecho librillo', () => {
  it('ordena las acciones como PDF, argumento y limpiar, y conserva el orden de las páginas', () => {
    assert.match(main, /className = 'trail-booklet'[\s\S]*?trail\.append\(booklet\);[\s\S]*?className = 'trail-keep'[\s\S]*?trail\.append\(keep\);[\s\S]*?className = 'trail-clear'/);
    assert.match(main, /booklet\.innerHTML = icon\('book-down'\)/);
    assert.match(main, /keep\.innerHTML = icon\('feather'\)/);
    assert.match(main, /clear\.innerHTML = icon\('circle-x'\)/);
    assert.match(main, /workspace\.trace\.map\(\(step\) => step\.page\)/);
    assert.match(main, /query\.append\('page', id\)/);
    assert.match(main, /const endpoint = `\/booklet\/pdf\?\$\{query\.toString\(\)\}`/);
  });

  it('abre el PDF en la misma ventana en iOS y no revoca prematuramente el blob en escritorio', () => {
    assert.match(main, /iosWebKit[\s\S]*?query\.set\('inline', '1'\);[\s\S]*?location\.assign\(`\/booklet\/pdf/);
    assert.match(main, /fetch\(endpoint\)[\s\S]*?document\.body\.append\(link\);[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?URL\.revokeObjectURL/);
  });

  it('conserva el toque del libro dentro de la capa sorda del mapa', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /\.trail-keep,\s*\.trail-booklet,\s*\.trail-clear\s*\{[\s\S]*?pointer-events: auto/);
  });

  it('dibuja cada breadcrumb como una unidad que contiene sus dos acciones', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /\.trail-step \{[\s\S]*?border: 1px solid color-mix\(in srgb, var\(--text-dim\) 58%, transparent\);/);
    assert.match(styles, /\.trail-step \.trail-pill \{[\s\S]*?border: 0;/);
    assert.match(main, /item\.append\(grip, pill, remove\)/);
  });

  it('marca el intersticio de inserción y eleva ópticamente el rótulo', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(main, /classList\.add\(side === 'before' \? 'drop-before' : 'drop-after'\)/);
    assert.match(main, /movedBeside\(workspace\.trace, from, target, side\)/);
    assert.match(styles, /\.trail-step\.drop-before::before,[\s\S]*?\.trail-step\.drop-after::after[\s\S]*?background: var\(--accent\)/);
    assert.match(main, /label\.className = 'trail-label'[\s\S]*?pill\.append\(label\)/);
    assert.match(styles, /\.trail-step \.trail-label \{[\s\S]*?transform: translateY\(-0\.12rem\)/);
    assert.doesNotMatch(styles, /\.trail-step \.trail-pill \{[^}]*transform:/);
  });

  it('acerca el asa al título y hace visible todo truncamiento como elipsis', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /\.trail-step \.trail-pill \{[\s\S]*?padding-left: max\(0px, calc\(0\.25rem - 0\.7ex\)\)/);
    assert.match(styles, /\.trail-step \.trail-label \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  });
});
