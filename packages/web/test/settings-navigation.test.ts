import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('arquitectura de configuración', () => {
  it('separa destinos administrativos de ajustes personales', () => {
    assert.match(settings, /label: 'Vera'/);
    assert.match(settings, /label: 'Teclado'/);
    assert.match(settings, /label: 'Apariencia'/);
    assert.doesNotMatch(settings, /id: 'archivos', label: 'Archivos'/);
    assert.match(settings, /'Espacios compartidos',[\s\S]*handlers\.onOpenSharing/);
    assert.match(settings, /'Archivos',[\s\S]*handlers\.onOpenFiles/);
    assert.match(settings, /'Registro de actividad',[\s\S]*handlers\.onOpenActivity/);
  });

  it('presenta páginas del sistema sin exponer el espacio de nombres ni la taxonomía técnica', () => {
    assert.match(main, /replace\(\/\^VERA\\s\*:\\s\*\/i, ''\)/);
    assert.match(main, /known === undefined[\s\S]*known\.what/);
    assert.doesNotMatch(main, /`\$\{known\.mode\} · \$\{known\.what\}`/);
    assert.match(main, /page\.kind !== 'activity' && page\.kind !== 'publication'/);
  });

  it('da más ancho al menú y conserva una sola columna en teléfono', () => {
    assert.match(styles, /#tokens\s*\{[\s\S]*?width:\s*42rem/);
    assert.match(styles, /\.settings-destinations\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.settings-destinations\s*\{\s*grid-template-columns:\s*1fr/);
  });

  it('deja respaldo y traslado al final de la portada', () => {
    const government = settings.indexOf("'Gobierno de Vera'");
    const backup = settings.indexOf("'Respaldo y traslado'");
    assert.ok(government >= 0 && backup > government);
    assert.match(settings, /settings-backup/);
  });
});
