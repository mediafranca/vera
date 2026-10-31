// Pruebas de la lógica pura del outliner: no tocan el DOM.
//
// La sesión de edición vive ahora en session.ts y se prueba aparte: Escape dejó
// de descartar, así que los casos que lo fijaban ya no describen nada.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildNeighbourhoods,
  buildTree,
  applyFrontMatterMode,
  bodyBlocks,
  blockRemovalOrder,
  externalDestination,
  foldsWhileRevealing,
  foldedState,
  hasDerivedRepresentation,
  invokeMenuAction,
  initialFoldingOpen,
  isFencedCodeContent,
  isSpecialPage,
  matchingMovePages,
  needsProgressiveComposition,
  nearestContinuityFocus,
  nodeMarkdown,
  offeredPropertyOptions,
  pageReferenceRows,
  projectedReferenceText,
  referenceExcerptAddsContext,
  reloadAfterServerWriting,
  reloadAfterDerivedWriting,
  reloadOptionsFor,
  unavailableTranscriptReason,
} from '../src/outliner.ts';
import type { BlockView, CrossingRow } from '../src/api.ts';

const block = (stableId: string, parent: string | null, position: number, content = stableId): BlockView => ({
  stableId,
  parent,
  position,
  content,
});

describe('vocabularios de propiedades', () => {
  it('muestra entero un vocabulario gobernado aunque tenga más de doce respuestas', () => {
    const offered = Array.from({ length: 17 }, (_, index) => ({
      value: `Tipo ${index + 1}`,
      uses: 0,
      declared: true,
    }));
    assert.deepEqual(offeredPropertyOptions(offered), offered);
  });

  it('limita a doce respuestas la cola de un vocabulario inferido', () => {
    const offered = Array.from({ length: 17 }, (_, index) => ({
      value: `Uso ${index + 1}`,
      uses: 17 - index,
    }));
    assert.deepEqual(offeredPropertyOptions(offered), offered.slice(0, 12));
  });
});

describe('tipografía del fuente cercado', () => {
  it('reconoce código y cercados ejecutables desde la valla inicial', () => {
    for (const source of [
      '```\nconst answer = 42',
      '```html\n<main>hola</main>\n```',
      '```p5js\ncreateCanvas(40, 40)\n```',
      '```mermaid\ngraph TD\n```',
      '~~~svg\n<svg></svg>\n~~~',
    ]) assert.equal(isFencedCodeContent(source), true, source);
  });

  it('no vuelve monoespaciado un bloque de prosa que sólo contiene un ejemplo', () => {
    assert.equal(isFencedCodeContent('Una explicación.\n```ts\nconst x = 1\n```'), false);
    assert.equal(isFencedCodeContent('texto ordinario'), false);
  });
});

describe('modo global del front matter', () => {
  it('abre o cierra todos los metadatos y sus controles en la superficie', () => {
    const metadata = [{ hidden: true }, { hidden: true }];
    const controls = [false, false].map(() => {
      const attributes = new Map<string, string>();
      const control = {
        attributes,
        title: '',
        open: false,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        classList: { toggle: (_name: string, open: boolean) => { control.open = open; } },
      };
      return control;
    });
    const root = {
      querySelectorAll: (selector: string) => selector === '.page-metadata' ? metadata : controls,
    } as unknown as ParentNode;

    applyFrontMatterMode(root, true);
    assert.deepEqual(metadata.map((one) => one.hidden), [false, false]);
    assert.deepEqual(controls.map((one) => one.attributes.get('aria-expanded')), ['true', 'true']);
    assert.deepEqual(controls.map((one) => one.title), ['Ocultar propiedades', 'Ocultar propiedades']);
    assert.deepEqual(controls.map((one) => one.open), [true, true]);

    applyFrontMatterMode(root, false);
    assert.deepEqual(metadata.map((one) => one.hidden), [true, true]);
    assert.deepEqual(controls.map((one) => one.attributes.get('aria-expanded')), ['false', 'false']);
    assert.deepEqual(controls.map((one) => one.open), [false, false]);
  });
});

describe('fuente y representación derivada', () => {
  const withoutRenderedObject = {
    querySelector: () => null,
  } as unknown as ParentNode;

  it('reconoce los regímenes que terminan de componerse fuera de Markdown', () => {
    assert.equal(hasDerivedRepresentation('```dibujo\n0,0,50\n```', withoutRenderedObject), true);
    assert.equal(hasDerivedRepresentation('? tipo=proyecto', withoutRenderedObject), true);
    assert.equal(hasDerivedRepresentation('prosa ordinaria', withoutRenderedObject), false);
  });

  it('confía en la representación ya reconocida para embeds y ejecutables', () => {
    let asked = '';
    const rendered = {
      querySelector: (selector: string) => {
        asked = selector;
        return {};
      },
    } as unknown as ParentNode;
    assert.equal(hasDerivedRepresentation('https://youtu.be/dQw4w9WgXcQ', rendered), true);
    assert.match(asked, /\.embed/);
    assert.match(asked, /\.table-scroll/);
    assert.match(asked, /code\.language-mermaid/);
  });

  it('usa un solo pie y alterna code-xml con ojo sin herramientas de prosa', () => {
    const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
    assert.match(source, /foot\.className = 'derived-source-foot'/);
    assert.match(source, /button\.innerHTML = icon\('code-xml'\)/);
    assert.match(source, /button\.innerHTML = icon\('eye'\)/);
    assert.match(source, /if \(sourceMode\) body\.append\(editor\)/);
    assert.match(source, /if \(!sourceMode && row !== null\)/);
    assert.match(source, /if \(sourceMode\) callbacks\.onReload\(null\)/);
  });
});

describe('composición progresiva de páginas', () => {
  it('reparte una página mediana antes del antiguo umbral de cien bloques', () => {
    assert.equal(
      needsProgressiveComposition(Array.from({ length: 32 }, (_, index) => block(`b${index}`, null, index))),
      true,
    );
  });

  it('reparte una página de menos bloques cuando su fuente es costosa', () => {
    const blocks = Array.from({ length: 16 }, (_, index) =>
      block(`b${index}`, null, index, index < 2 ? '| una | tabla |\n| --- | --- |' : 'prosa'),
    );
    assert.equal(needsProgressiveComposition(blocks), true);
  });

  it('mantiene inmediata una página breve y liviana', () => {
    assert.equal(
      needsProgressiveComposition(Array.from({ length: 20 }, (_, index) => block(`b${index}`, null, index, 'prosa'))),
      false,
    );
  });
});

describe('enlaces salientes', () => {
  const here = 'https://vera.mediafranca.net/p/Bit%C3%A1cora';

  it('reconoce sólo HTTP de otro origen', () => {
    assert.equal(externalDestination('https://ejemplo.cl/a', here), 'https://ejemplo.cl/a');
    assert.equal(externalDestination('/p/Otra', here), null);
    assert.equal(externalDestination('#seccion', here), null);
    assert.equal(externalDestination('mailto:alguien@ejemplo.cl', here), null);
  });

  it('los marca con Lucide sin introducir otro color de enlace', () => {
    const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(source, /link\.classList\.add\('external-link'\)/);
    assert.match(source, /icon\('external-link', \{ className: 'external-link-mark' \}\)/);
    assert.match(styles, /\.wiki,[\s\S]*?\.external-link \{[\s\S]*?color: var\(--accent\);/);
    assert.match(styles, /\.external-link \.external-link-mark \{[\s\S]*?display: inline-block;/);
  });
});

describe('redibujar después de escribir', () => {
  it('un renombrado vuelve al corpus y reemplaza la ruta actual', () => {
    assert.deepEqual(
      reloadOptionsFor({ kind: 'rename_page', page: 'page:1', title: 'Nombre definitivo' }),
      { fromCorpus: true, replaceRoute: true },
    );
  });

  it('una edición local sigue redibujándose desde la réplica', () => {
    assert.equal(
      reloadOptionsFor({ kind: 'edit_block', block: 'block:1', content: 'texto' }),
      undefined,
    );
  });

  it('una transformación escrita por el servidor vuelve al corpus', () => {
    assert.deepEqual(reloadAfterServerWriting(), { fromCorpus: true });
  });

  it('una relación vuelve al corpus porque no vive en la réplica de una página', () => {
    assert.deepEqual(reloadAfterDerivedWriting(), { fromCorpus: true });
  });
});

describe('continuidad después de una acción estructural', () => {
  const before = ['primero', 'padre', 'hijo', 'siguiente', 'último'];

  it('permanece en el mismo bloque cuando sobrevive', () => {
    assert.deepEqual(
      nearestContinuityFocus(before, before, 'padre', 7),
      { block: 'padre', at: 7 },
    );
  });

  it('prefiere el siguiente bloque visible al eliminar un subárbol', () => {
    assert.deepEqual(
      nearestContinuityFocus(before, ['primero', 'siguiente', 'último'], 'padre', null),
      { block: 'siguiente', at: null },
    );
  });

  it('retrocede al anterior cuando no queda nada después', () => {
    assert.deepEqual(
      nearestContinuityFocus(before, ['primero', 'padre', 'hijo'], 'último', null),
      { block: 'hijo', at: null },
    );
  });

  it('no inventa un foco cuando la página quedó vacía', () => {
    assert.equal(nearestContinuityFocus(['único'], [], 'único', null), null);
  });

  it('devuelve el foco a un control real y no al espaciador de una hoja', () => {
    const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
    assert.match(source, /querySelector<HTMLButtonElement>\('button\.fold, button\.bullet'\)/);
  });
});

describe('menú encadenado', () => {
  it('detiene el clic antes de abrir el siguiente menú', () => {
    const order: string[] = [];
    invokeMenuAction(
      { stopPropagation: () => order.push('stop') },
      { run: () => order.push('run') },
    );
    assert.deepEqual(order, ['stop', 'run']);
  });
});

describe('videos de YouTube', () => {
  it('explica cuando YouTube no publica ninguna pista en vez de abrir un diálogo vacío', () => {
    assert.equal(
      unavailableTranscriptReason([]),
      'YouTube no ofrece subtítulos publicados ni automáticos para este video',
    );
    assert.equal(unavailableTranscriptReason([{
      source: 'published', language: 'es', label: 'Español', translated: false,
    }]), null);
  });

  it('los controles del video quedan fuera del gesto que abre el editor', () => {
    const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
    assert.match(source, /closest\('a, button, input, select, textarea, \.audio-block, \.process-block, \.embed'\)/);
  });
});

describe('barra de formato', () => {
  it('ofrece una partición táctil visible y comparte la operación con Retorno móvil', () => {
    const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(source, /editor\.addEventListener\('beforeinput'/);
    assert.match(source, /beforeInputSplitsBlock\(event\.inputType, physicalNewline\)/);
    assert.match(source, /splitControl\.className = 'split-block-action'/);
    assert.match(source, />Partir aquí<\/span>/);
    assert.match(source, /splitControl\.addEventListener\('click', \(\) => splitAt\(/);
    assert.match(source, /row\.append\(splitControl\)/);
    assert.doesNotMatch(source, /body\.append\(splitControl\)/);
    assert.match(source, /caretTopIn\(editor, endpoint\)/);
    assert.match(source, /const viewportLeft = window\.visualViewport\?\.offsetLeft \?\? 0/);
    assert.match(source, /const preferredScreenX = editorBox\.left - touchRadius - 6/);
    assert.match(source, /Math\.max\(viewportLeft \+ touchRadius, preferredScreenX\)/);
    assert.doesNotMatch(source, /--format-tools-shift/);
    assert.match(styles, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*?\.block > \.split-block-action \{[\s\S]*?position: absolute;[\s\S]*?left: var\(--split-action-x[\s\S]*?top: var\(--split-action-y/);
    assert.match(styles, /\.format-tools-trigger::after \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
    assert.match(styles, /\.block > \.split-block-action::after \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  });

  it('devuelve sutilmente ancho al texto móvil sin encoger los blancos táctiles', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /#text \{\s*padding: 1rem calc\(0\.85rem \+ env\(safe-area-inset-right\)\)[\s\S]*?calc\(1\.1rem \+ env\(safe-area-inset-left\)\);/);
    assert.match(styles, /\.blocks \{\s*--indent-scale: 0\.55;/);
    assert.match(styles, /\.split-block-action::after \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  });

  it('cede dentro de la columna sin crear desplazamiento horizontal del documento', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /\.format-bar \{[\s\S]*?flex-wrap: wrap;[\s\S]*?flex: 0 1 27\.2rem;[\s\S]*?width: min\(calc\(100% - 2\.6rem\), 27\.2rem\);/);
    assert.match(styles, /\.format-tools-row \{[\s\S]*?width: 100%;[\s\S]*?pointer-events: none;/);
    assert.match(styles, /\.format-action \{[\s\S]*?flex: 1 1 2\.35rem;[\s\S]*?min-width: 1\.7rem;/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.format-bar \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow-x: auto;[\s\S]*?touch-action: pan-x;/);
    assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.format-action \{ flex: 0 0 2\.35rem; \}/);
  });

  it('usa una sola familia Lucide y deja sus trazos por encima del texto', () => {
    const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    for (const name of [
      'bold', 'italic', 'strikethrough', 'underline', 'superscript', 'subscript',
      'quote', 'code', 'link', 'external-link',
    ]) {
      assert.match(source, new RegExp(`icon: '${name}'`));
    }
    assert.doesNotMatch(source, /icon: 'brackets'.*enlace interno/);
    assert.match(styles, /\.format-bar \{[\s\S]*?z-index:\s*90;/);
    assert.match(styles, /\.format-action \.icon \{[\s\S]*?z-index:\s*2;/);
  });

  it('ofrece sólo herramientas inline y omite la jerarquía de encabezados', () => {
    const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /format-heading|headingLevels|chooseHeading|icon\('heading-[1-6]'\)/);
    assert.doesNotMatch(styles, /\.format-heading/);
    assert.match(source, /icon: 'bold'/);
    assert.match(source, /icon: 'external-link'/);
  });

  it('nace colapsada y un botón exterior la gobierna sin quitarle el menú a la viñeta', () => {
    const source = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(source, /formatBar\.hidden = true/);
    assert.match(source, /formatTrigger\.className = 'format-tools-trigger'/);
    assert.match(source, /formatTrigger\.innerHTML = icon\('wrench'\)/);
    assert.match(source, /formatBarAnchor\.className = 'format-bar-anchor'/);
    assert.match(source, /body\.append\(formatBarAnchor, editor\)/);
    assert.match(source, /formatTools\.append\(formatBar, formatTrigger\)/);
    assert.match(source, /formatBarAnchor\.append\(formatTools\)/);
    assert.match(source, /formatBar\.hidden = !formatBar\.hidden/);
    assert.match(source, /formatTrigger\.addEventListener\('mousedown', \(event\) => event\.preventDefault\(\)\)/);
    assert.doesNotMatch(source, /bullet\.classList\.add\('editing-tools'\)/);
    assert.match(source, /bullet\.setAttribute\('aria-haspopup', 'menu'\)/);
    assert.match(styles, /\.format-bar\[hidden\] \{\s*display: none;/);
    assert.match(source, /new ResizeObserver\(rememberFormatBarHeight\)/);
    assert.match(source, /if \(!formatBar\.hidden\) requestAnimationFrame\(rememberFormatBarHeight\)/);
    assert.match(styles, /\.format-tools-row \{[\s\S]*?position: sticky;[\s\S]*?top: calc\(0\.65rem \+ var\(--format-bar-measured-height\) \+ var\(--format-bar-gap\)\);[\s\S]*?transform: translateY\(calc\(0px - var\(--format-bar-measured-height\) - var\(--format-bar-gap\)\)\);/);
    assert.match(styles, /\.format-bar-anchor \{\s*position: absolute;\s*inset: 0;[\s\S]*?pointer-events: none;/);
    assert.match(styles, /\.format-tools-trigger \{[\s\S]*?width: var\(--format-bar-height\);[\s\S]*?height: var\(--format-bar-height\);[\s\S]*?margin: 0;[\s\S]*?border-radius: 5px;[\s\S]*?color: var\(--bg\);[\s\S]*?background: var\(--accent\);/);
    assert.match(styles, /@keyframes format-tools-slide-in[\s\S]*?translateX\(\.65rem\)[\s\S]*?translateX\(0\)/);
  });
});

describe('páginas especiales', () => {
  it('reconoce tanto la declaración humana como la junta canónica', () => {
    assert.equal(isSpecialPage([{ key: 'tipo', value: 'página especial' }]), true);
    assert.equal(isSpecialPage([{ key: 'special-kind', value: 'ontology' }]), true);
    assert.equal(isSpecialPage([{ key: 'tipo', value: 'argumento' }]), false);
  });
});

describe('buildTree', () => {
  it('anida por parent y ordena por position', () => {
    const tree = buildTree([
      block('b', 'a', 1),
      block('a', null, 0),
      block('c', 'a', 0),
    ]);

    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.block.stableId, 'a');
    assert.deepEqual(tree[0]?.children.map((n) => n.block.stableId), ['c', 'b']);
  });

  it('trata como raíz un bloque cuyo padre no vino en la página', () => {
    const tree = buildTree([block('huerfano', 'ausente', 0)]);
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.block.stableId, 'huerfano');
  });

  it('no pierde ningún bloque', () => {
    const blocks = [
      block('a', null, 0),
      block('b', 'a', 0),
      block('c', 'b', 0),
      block('d', null, 1),
    ];
    const count = (nodes: ReturnType<typeof buildTree>): number =>
      nodes.reduce((n, node) => n + 1 + count(node.children), 0);
    assert.equal(count(buildTree(blocks)), blocks.length);
  });
});

describe('aparatos de enlaces proyectados fuera del cuerpo', () => {
  const blocks = [
    block('cara', null, 0, 'La cara'),
    block('aparato', null, 1, 'Conectivas de salida'),
    block('poema', 'aparato', 0, 'Poema entero → [[Otra]]'),
  ];
  const page = {
    blocks,
    blockProperties: {
      aparato: [{ key: 'presentación', value: 'referencias salientes' }],
    },
  };

  it('deja el cuerpo principal sin el aparato ni sus descendientes', () => {
    assert.deepEqual(bodyBlocks(page, null).map((one) => one.stableId), ['cara']);
  });

  it('lo conserva al enfocarlo para que siga siendo editable y auditable', () => {
    assert.deepEqual(bodyBlocks(page, 'aparato'), blocks);
  });

  it('presenta el texto canónico completo en la referencia saliente', () => {
    assert.equal(projectedReferenceText(page, 'poema', 'Poema entero…'), 'Poema entero → [[Otra]]');
  });
});

describe('extractos de referencias', () => {
  it('no repite debajo del título un bloque que sólo contiene ese mismo enlace', () => {
    assert.equal(referenceExcerptAddsContext('William Wong', '[[William Wong]]'), false);
  });

  it('conserva una frase que explica el contexto de la referencia', () => {
    assert.equal(referenceExcerptAddsContext('William Wong', 'Conversé con [[William Wong]]'), true);
  });
});

describe('referencias explicadas', () => {
  const crossing = (
    stableId: string,
    fromPage: string,
    toPage: string,
    title: string,
    said: string,
  ): CrossingRow => ({
    stableId,
    revision: `operation:${stableId}`,
    connective: `block:${stableId}`,
    said,
    blocks: [{ stableId: `block:${stableId}`, parent: null, position: 0, content: said }],
    fromBlock: null,
    fromPage,
    toPage,
    targetTitle: title,
    title,
    sense: 'directed',
    term: null,
    reads: null,
    says: said,
  });

  it('enriquece una referencia existente en vez de duplicarla como afirmación', () => {
    const relation = crossing('vera-mediafranca', 'page:vera', 'page:mediafranca', 'MediaFranca', 'Forma parte de');
    const rows = pageReferenceRows({
      blocks: [block('block:mención', null, 0, '[[MediaFranca]]')],
      blockProperties: {},
      references: [{ page: 'page:mediafranca', title: 'MediaFranca', block: 'block:mención', excerpt: '[[MediaFranca]]' }],
      backlinks: [],
      crossingsOut: [relation],
      crossingsIn: [],
    });
    assert.equal(rows.names.length, 1);
    assert.equal(rows.names[0]?.relation, relation);
  });

  it('incluye una relación explicada aunque no exista una mención literal', () => {
    const relation = crossing('vera-otra', 'page:vera', 'page:otra', 'Otra', 'La explica');
    const rows = pageReferenceRows({
      blocks: [], blockProperties: {}, references: [], backlinks: [],
      crossingsOut: [relation], crossingsIn: [],
    });
    assert.deepEqual(rows.names.map((row) => row.title), ['Otra']);
    assert.equal(rows.names[0]?.relation, relation);
  });

  it('mantiene las dos direcciones en La nombran y Nombra a, sin una tercera categoría', () => {
    const outgoing = crossing('vera-otra', 'page:vera', 'page:otra', 'Otra', 'Sale hacia Otra');
    const incoming = crossing('otra-vera', 'page:otra', 'page:vera', 'Otra', 'Llega desde Otra');
    const rows = pageReferenceRows({
      blocks: [block('block:mención', null, 0, '[[Otra]]')],
      blockProperties: {},
      references: [{ page: 'page:otra', title: 'Otra', block: 'block:mención', excerpt: '[[Otra]]' }],
      backlinks: [{ page: 'page:otra', title: 'Otra', block: 'block:otra', excerpt: '[[VERA]]' }],
      crossingsOut: [outgoing],
      crossingsIn: [incoming],
    });
    assert.equal(rows.names.length, 1);
    assert.equal(rows.namedBy.length, 1);
    assert.equal(rows.names[0]?.relation, outgoing);
    assert.equal(rows.namedBy[0]?.relation, incoming);
  });
});

describe('plegado inicial del pie', () => {
  it('abre las secciones ordinarias y deja las referencias recogidas', () => {
    assert.equal(initialFoldingOpen('otra sección'), true);
    assert.equal(initialFoldingOpen('referencias:page:una'), false);
    assert.equal(initialFoldingOpen('referencias:page:otra'), false);
  });

  it('recuerda el gesto de la persona por encima del valor inicial', () => {
    assert.equal(initialFoldingOpen('referencias:page:una', true), true);
    assert.equal(initialFoldingOpen('otra', false), false);
  });
});

describe('borrar un subárbol', () => {
  it('quita cada hoja antes que su padre y deja la raíz para el final', () => {
    const tree = buildTree([
      block('raíz', null, 0),
      block('hijo', 'raíz', 0),
      block('nieto', 'hijo', 0),
      block('otro', 'raíz', 1),
    ]);

    assert.deepEqual(blockRemovalOrder(tree[0]!), ['nieto', 'hijo', 'otro', 'raíz']);
  });
});

describe('nodeMarkdown', () => {
  it('copia el bloque completo con todos sus descendientes', () => {
    const tree = buildTree([
      block('raíz', null, 0, 'Idea'),
      block('hijo', 'raíz', 0, 'Primer punto'),
      block('nieto', 'hijo', 0, 'Detalle'),
      block('otro', 'raíz', 1, 'Segundo punto'),
    ]);
    assert.equal(
      nodeMarkdown(tree[0]!),
      ['Idea', '- Primer punto', '  - Detalle', '- Segundo punto'].join('\n'),
    );
  });

  it('una hoja copia sólo su Markdown', () => {
    const tree = buildTree([block('hoja', null, 0, 'Texto **limpio**')]);
    assert.equal(nodeMarkdown(tree[0]!), 'Texto **limpio**');
  });
});

describe('foldedState', () => {
  it('proyecta inmediatamente plegar y desplegar en la vista local', () => {
    assert.deepEqual(foldedState([], 'padre', true), ['padre']);
    assert.deepEqual(foldedState(['padre'], 'padre', false), []);
  });

  it('no duplica un bloque ya plegado', () => {
    assert.deepEqual(foldedState(['padre'], 'padre', true), ['padre']);
  });
});

describe('llegar a un bloque referido', () => {
  it('abre sólo sus ancestros plegados y conserva los demás pliegues', () => {
    const blocks = [
      block('raíz', null, 0),
      block('padre', 'raíz', 0),
      block('destino', 'padre', 0),
      block('otra-raíz', null, 1),
    ];
    assert.deepEqual(
      foldsWhileRevealing(blocks, ['raíz', 'padre', 'otra-raíz'], 'destino'),
      ['otra-raíz'],
    );
  });

  it('tolera una identidad ausente sin alterar el plegado', () => {
    assert.deepEqual(foldsWhileRevealing([block('a', null, 0)], ['a'], 'ausente'), ['a']);
  });
});

describe('buscar la página a la que se mueve un bloque', () => {
  const page = (id: string, title: string) => ({ id, title, visibility: 'private' as const, blockCount: 0, linkCount: 0 });

  it('omite la página de origen y busca sin depender de acentos', () => {
    const pages = [page('a', 'Actual'), page('b', 'Diseño gráfico'), page('c', 'Biología')];
    assert.deepEqual(matchingMovePages('diseno', pages, 'a').map((one) => one.id), ['b']);
  });

  it('pone primero el título exacto y después los que sólo lo contienen', () => {
    const pages = [page('a', 'Actual'), page('b', 'Notas de diseño'), page('c', 'Diseño')];
    assert.deepEqual(matchingMovePages('diseño', pages, 'a').map((one) => one.id), ['c', 'b']);
  });
});

describe('buildNeighbourhoods', () => {
  const nodo = (id: string, children: ReturnType<typeof nodo>[] = []) => ({
    block: { stableId: id, parent: null, position: 0, content: id },
    children,
  });

  it('encadena el orden de lectura, no el de hermanos', () => {
    // a, su hijo a1, y luego b. Lo que está «encima» de b es a1, no a.
    const tree = [nodo('a', [nodo('a1')]), nodo('b')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('b')?.previousVisible?.block, 'a1');
    assert.equal(near.get('a1')?.previousVisible?.block, 'a');
    assert.equal(near.get('a')?.previousVisible, null);
    assert.equal(near.get('a')?.nextVisible, 'a1');
  });

  it('el hermano anterior se salta a los hijos del medio', () => {
    const tree = [nodo('a', [nodo('a1')]), nodo('b')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('b')?.previousSibling, 'a', 'a1 no es hermano de b');
    assert.equal(near.get('a1')?.previousSibling, null);
  });

  it('sitúa a cada bloque entre sus hermanos', () => {
    const tree = [nodo('a'), nodo('b'), nodo('c')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('a')?.index, 0);
    assert.equal(near.get('c')?.index, 2);
  });

  it('recuerda al abuelo y dónde está el padre, para desindentar', () => {
    const tree = [nodo('a'), nodo('b', [nodo('b1', [nodo('b1x')])])];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('b1x')?.parent, 'b1');
    assert.equal(near.get('b1x')?.grandparent, 'b');
    assert.equal(near.get('b1')?.parentIndex, 1, 'b es el segundo de su nivel');
  });

  it('sabe quién tiene hijos', () => {
    const tree = [nodo('a', [nodo('a1')]), nodo('b')];
    const near = buildNeighbourhoods(tree as never);

    assert.equal(near.get('a')?.hasChildren, true);
    assert.equal(near.get('b')?.hasChildren, false);
    assert.equal(near.get('b')?.previousVisible?.hasChildren, false);
  });
});
