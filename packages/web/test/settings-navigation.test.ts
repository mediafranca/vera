import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { COMMANDS } from '../src/autocomplete.ts';

const settings = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('arquitectura de configuración', () => {
  it('ordena el Centro de Vera por propósitos humanos', () => {
    for (const label of ['Biblioteca', 'Participantes', 'Agente de biblioteca', 'Conexiones', 'Gobierno', 'Apariencia', 'Sistema']) {
      assert.match(settings, new RegExp(`label: '${label}'`));
    }
    assert.doesNotMatch(settings, /label: 'Ayuda'/);
    assert.doesNotMatch(settings, /label: 'Inicio'/);
    assert.doesNotMatch(settings, /function drawStart/);
    assert.match(settings, /'Directorio',[\s\S]*handlers\.onOpenPeople/);
    assert.match(settings, /'Espacios compartidos',[\s\S]*handlers\.onOpenSharing/);
    assert.match(settings, /'Archivos',[\s\S]*handlers\.onOpenFiles/);
    assert.match(settings, /'Registro de actividad',[\s\S]*handlers\.onOpenActivity/);
    assert.match(settings, /'Importar documentos',[\s\S]*handlers\.onImportDocuments/);
    const library = settings.match(/function drawLibrary[\s\S]*?function drawPeople/)?.[0] ?? '';
    const librarian = settings.match(/async function drawLibrarian[\s\S]*?async function drawConnections/)?.[0] ?? '';
    const system = settings.match(/async function drawSystem[\s\S]*?async function drawInstanceConfiguration/)?.[0] ?? '';
    assert.match(library, /Registro de actividad/);
    assert.doesNotMatch(librarian, /Registro de actividad/);
    assert.doesNotMatch(system, /Registro de actividad/);
    assert.match(settings, /section: 'conexiones', label: 'Zotero'/);
    assert.match(settings, /service\.access === 'read-write'/);
  });

  it('mantiene tema, bibliotecario y Centro en la barra cotidiana', () => {
    assert.match(shell, /id="theme"/);
    assert.match(shell, /id="librarian"/);
    assert.match(shell, /id="settings" aria-label="Centro de Vera"/);
    assert.match(main, /openLibrarianConversation\(openView, callbacksFor\(openView\)\)/);
    assert.match(main, /workspace\.scheme === 'dark' \? 'light' : 'dark'/);
  });

  it('busca sólo ajustes operables desde un campo transversal', () => {
    assert.match(settings, /placeholder = 'Buscar ajustes'/);
    assert.match(settings, /CENTRE_DESTINATIONS\.filter/);
    assert.match(settings, /entry\.terms/);
    assert.match(settings, /handlers\.onSectionChange\(entry\.section\)/);
    assert.doesNotMatch(settings, /section: 'ayuda'/);
    assert.doesNotMatch(settings, /open: \(h\) => h\.onOpenPage\('VERA —/);
  });

  it('explica que una Vera personal no se convierte con un interruptor', () => {
    assert.match(settings, /el acceso local sigue funcionando sin iniciar sesión/);
    assert.match(settings, /No es un interruptor sobre este corpus/);
    assert.match(settings, /antes de migrar se registra y comprueba una passkey administrativa/);
  });

  it('asocia editores por tipo y por dispositivo sin escribir rutas en el grafo', () => {
    assert.match(settings, /Estas asociaciones pertenecen a este dispositivo/);
    assert.match(settings, /Markdown[\s\S]*Mermaid[\s\S]*SVG[\s\S]*p5\.js \/ JavaScript/);
    assert.match(settings, /chooseEditor\(row\.key\)/);
    assert.match(settings, /Usar la del sistema/);
  });

  it('gobierna escuchar y hablar como capacidades locales separadas', () => {
    assert.match(settings, /active === 'bibliotecario'\) void drawLibrarian/);
    assert.match(settings, /function drawConnections[\s\S]*drawExternalEditors/);
    assert.doesNotMatch(settings.match(/function drawConnections[\s\S]*?async function drawVoiceConfiguration/)?.[0] ?? '', /drawVoiceConfiguration\(host\)/);
    assert.match(settings, /'Activar voz'/);
    assert.match(settings, /'Escuchar · speech-to-text'/);
    assert.match(settings, /'Hablar · text-to-speech'/);
    assert.match(settings, /api\.configureVoice/);
    assert.match(settings, /Copiar instalación ·/);
    assert.match(settings, /Guardar rutas y comprobar/);
    assert.match(settings, /veraVoiceConfiguration/);
  });

  it('reemplaza la explicación abstracta por controles y estados concretos', () => {
    assert.doesNotMatch(settings, /Dentro de su contexto/);
    assert.doesNotMatch(settings, /Fuera de su contexto/);
    assert.match(settings, /Configurar \$\{librarianName\}/);
    assert.match(settings, /Leyendo el agente de biblioteca activo…/);
    assert.match(settings, /Bitácora de hoy/);
    const librarian = settings.match(/async function drawLibrarian[\s\S]*?async function drawConnections/)?.[0] ?? '';
    assert.doesNotMatch(librarian, /pendingDestination\('Dialéctica bibliotecaria'/);
    assert.match(settings, /pendingDestination/);
  });

  it('presenta páginas del sistema sin exponer el espacio de nombres ni la taxonomía técnica', () => {
    assert.match(main, /replace\(\/\^VERA\\s\*:\\s\*\/i, ''\)/);
    assert.match(main, /kind\.mode !== 'documentación'/);
    assert.match(main, /item\.classList\.add\('is-pending'\)/);
    assert.doesNotMatch(main, /openPage\(page\.id[\s\S]*gesture: 'opened_directly'/);
  });

  it('da más ancho al menú y conserva una sola columna en teléfono', () => {
    assert.match(styles, /#tokens\s*\{[\s\S]*?width:\s*42rem/);
    assert.match(styles, /\.settings-destinations\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.settings-destinations\s*\{\s*grid-template-columns:\s*1fr/);
  });

  it('presenta las secciones como nav-pills que conservan sentido al envolver', () => {
    assert.match(settings, /tabs\.className = 'settings-pills'/);
    assert.match(settings, /'settings-pill selected' : 'settings-pill'/);
    assert.match(main, /querySelectorAll\('\.settings-pill'\)/);
    assert.match(styles, /\.settings-pills\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    assert.match(styles, /\.settings-pill\s*\{[\s\S]*?border-radius:\s*999px/);
    assert.match(styles, /\.settings-pill\.selected\s*\{[\s\S]*?background:\s*var\(--accent\)/);
  });

  it('conserva el lugar al reconciliar ajustes locales con su nueva representación', () => {
    assert.match(main, /const heldScroll = panel\.scrollTop/);
    assert.match(main, /panel\.scrollTop = heldScroll/);
    assert.match(main, /focus\(\{ preventScroll: true \}\)/);
  });

  it('deja respaldo e identidad de instancia en Sistema', () => {
    assert.match(settings, /function drawSystem[\s\S]*drawInstanceConfiguration[\s\S]*drawPortability/);
    assert.match(settings, /Nombre de esta Vera · Pendiente/);
    assert.match(settings, /settings-backup/);
    assert.match(styles, /\.instance-configuration :is\(input, select\)[\s\S]*height:\s*var\(--form-control-height\)/);
  });

  it('reúne el gobierno ontológico en un destino y conserva Gobierno como inventario', () => {
    assert.match(main, /row\('Ontología', 'Objetos, propiedades y relaciones en un visor facetado'\)/);
    assert.match(main, /ontologyKinds = new Set\(\['objects', 'properties', 'relations'\]\)/);
    assert.match(main, /page\.kind === 'objects'/);
    assert.match(main, /!ontologyKinds\.has\(kind\.key\)/);
    assert.match(main, /const elsewhere = new Set/);
  });

  it('reserva las instrucciones del agente para su oficio singular', () => {
    assert.match(main, /'instructions'/);
    assert.match(settings, /Configurar \$\{librarianName\}/);
  });

  it('conserva la ontología histórica fuera del Gobierno vigente', () => {
    assert.doesNotMatch(settings, /Ontología anterior/);
    assert.match(main, /kind\.mode !== 'documentación'/);
  });

  it('presenta cada comando una sola vez en Teclado', () => {
    const names = COMMANDS.map((command) => command.name);
    assert.equal(new Set(names).size, names.length);
    assert.equal(names.filter((name) => name === 'tarea').length, 1);
  });
});
