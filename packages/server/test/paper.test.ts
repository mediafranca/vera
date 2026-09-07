import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bookletHtml, diagramsIn, paperHtml } from '../src/paper.ts';

const bloque = (stableId: string, parent: string | null, position: number, content: string) => ({
  stableId,
  parent,
  position,
  content,
});

/*
 * El papel es el documento sin el taller alrededor.
 *
 * Lo que estas pruebas fijan es qué se queda fuera —las propiedades, las
 * referencias, los fondos, la sangría del esquema— porque es lo que distingue un
 * PDF que se guarda de una foto de la pantalla.
 */
describe('paperHtml', () => {
  it('lleva el título de la página y el texto de sus bloques', () => {
    const html = paperHtml({
      title: 'VERA — Manual',
      blocks: [bloque('block:1', null, 0, 'Antes de nada'), bloque('block:2', null, 1, 'Se escribe en bloques.')],
    });
    assert.match(html, /<h1 class="paper-title">VERA — Manual<\/h1>/);
    assert.match(html, /Se escribe en bloques\./);
  });

  it('los bloques van en orden de lectura, cada hijo tras su padre', () => {
    const html = paperHtml({
      title: 'Orden',
      blocks: [
        bloque('block:hijo', 'block:padre', 0, 'el hijo'),
        bloque('block:segundo', null, 1, 'el segundo'),
        bloque('block:padre', null, 0, 'el padre'),
      ],
    });
    const dónde = (text: string): number => html.indexOf(text);
    assert.ok(dónde('el padre') < dónde('el hijo'));
    assert.ok(dónde('el hijo') < dónde('el segundo'));
  });

  it('un bloque cuyo padre no está en la página no se pierde', () => {
    // No debería pasar, y por eso mismo hay que decidir qué hacer si pasa: un
    // documento al que le falta un párrafo sin avisar es peor que uno con el
    // párrafo fuera de sitio.
    const html = paperHtml({
      title: 'Huérfano',
      blocks: [bloque('block:1', null, 0, 'con padre'), bloque('block:2', 'block:fuera', 0, 'sin padre')],
    });
    assert.match(html, /sin padre/);
  });

  it('sin sangría: el papel va en texto seguido', () => {
    const html = paperHtml({
      title: 'Seguido',
      blocks: [bloque('block:1', null, 0, 'raíz'), bloque('block:2', 'block:1', 0, 'hondo')],
    });
    assert.ok(!html.includes('margin-left'));
  });

  it('con sangría, si se pide para comparar', () => {
    const html = paperHtml({
      title: 'Sangrado',
      blocks: [bloque('block:1', null, 0, 'raíz'), bloque('block:2', 'block:1', 0, 'hondo')],
      indent: true,
    });
    assert.match(html, /margin-left:1\.2rem/);
  });

  it('un bloque vacío no ocupa sitio en el papel', () => {
    const html = paperHtml({
      title: 'Vacíos',
      blocks: [bloque('block:1', null, 0, 'algo'), bloque('block:2', null, 1, '   ')],
    });
    assert.equal(html.match(/<div class="b"/g)?.length, 1);
  });

  it('carta, y sin fondo', () => {
    const html = paperHtml({ title: 'Papel', blocks: [] });
    assert.match(html, /size: letter/);
    assert.match(html, /background: none/);
  });

  it('lo incrustado no corre en el papel: queda dónde estaba', () => {
    const html = paperHtml({
      title: 'Incrustado',
      blocks: [bloque('block:1', null, 0, '<iframe src="https://ejemplo.cl/x?y=1#z"></iframe>')],
      embedHosts: ['ejemplo.cl'],
    });
    // La dirección va dicha corta —origen y ruta— porque una herramienta que
    // recibe su documento en el fragmento traería media hoja de base64.
    assert.match(html, /data-source="https:\/\/ejemplo\.cl\/x"/);
    assert.match(html, /incrustado desde ' attr\(data-source\)/);
  });

  it('las imágenes del corpus resuelven a su objeto', () => {
    const html = paperHtml({
      title: 'Con foto',
      blocks: [bloque('block:1', null, 0, '![una foto](../assets/foto.png)')],
      assets: [{ path: '../assets/foto.png', url: '/media/abc123', mediaType: 'image/png' }],
    });
    assert.match(html, /src="\/media\/abc123"/);
    assert.match(html, /\.b img \{[\s\S]*?height: 820px;[\s\S]*?border: 0;[\s\S]*?object-fit: contain;/);
  });

  it('imprime HTML ejecutable sin marco y usando la caja completa de la hoja', () => {
    const html = paperHtml({
      title: 'HTML',
      blocks: [bloque('block:html', null, 0, '```html-live\n<h1>Una lámina</h1>\n```')],
    });
    assert.match(html, /class="executable executable-html-live"/);
    assert.match(html, /data-executable-frame/);
    assert.match(html, /\.b \.executable iframe \{[\s\S]*?width: 100%;[\s\S]*?height: 820px;[\s\S]*?border: 0;/);
    assert.match(html, /\.b \.executable :is\(summary, \.executable-size-toggle\) \{ display: none; \}/);
  });

  it('el título se escapa: una página puede llamarse como quiera', () => {
    const html = paperHtml({ title: '<script>alert(1)</script>', blocks: [] });
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });
});

describe('bookletHtml', () => {
  it('reúne las páginas en el orden dado y empieza cada una en hoja nueva', () => {
    const html = bookletHtml({
      title: 'Un recorrido',
      pages: [
        { title: 'Primera', blocks: [bloque('block:1', null, 0, 'uno')] },
        { title: 'Segunda', blocks: [bloque('block:2', null, 0, 'dos')] },
      ],
    });
    assert.ok(html.indexOf('Primera') < html.indexOf('Segunda'));
    assert.equal(html.match(/class="paper-chapter"/g)?.length, 2);
    assert.match(html, /\.paper-chapter \+ \.paper-chapter \{ break-before: page; \}/);
  });
});

/*
 * Las citas de bloque.
 *
 * @invariant AQuotedBlockTravelsAsItsWords. En pantalla una cita es un enlace que
 * se pulsa para ir a leer la frase; en papel no hay adónde ir, así que o viaja la
 * frase o no viaja nada.
 */
describe('un bloque citado', () => {
  const citado = {
    page: 'Amereida',
    excerpt: 'no se llega a América, se llega a un mar que no tiene nombre todavía',
  };

  it('va con su texto entero y no con su identificador', () => {
    const html = paperHtml({
      title: 'Con cita',
      blocks: [bloque('block:1', null, 0, 'Como se dijo: ((block:lejano))')],
      resolveBlock: (id) => (id === 'block:lejano' ? citado : null),
    });
    assert.match(html, /no tiene nombre todav[íi]a/);
    assert.ok(!html.includes('block:lejano'), 'el identificador no se imprime');
  });

  it('y no como enlace: en un PDF no hay adónde ir', () => {
    const html = paperHtml({
      title: 'Con cita',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
      resolveBlock: () => citado,
    });
    assert.ok(!/<a class="block-ref"/.test(html), 'sigue siendo un enlace');
    assert.match(html, /<span class="quoted">/);
  });

  it('dice de qué página salió: un texto ajeno sin procedencia se lee como propio', () => {
    const html = paperHtml({
      title: 'Con cita',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
      resolveBlock: () => citado,
    });
    assert.match(html, /<span class="quoted-from">Amereida<\/span>/);
  });

  it('va entera y no recortada, aunque sea larga', () => {
    // En pantalla el extracto basta porque es la etiqueta de algo que se abre; en
    // papel es todo lo que el lector va a tener nunca de esa frase.
    const larga = 'palabra '.repeat(80).trim();
    const html = paperHtml({
      title: 'Con cita larga',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
      resolveBlock: () => ({ page: 'Otra', excerpt: larga }),
    });
    assert.ok(html.includes(larga), 'la cita llegó recortada');
  });

  it('una cita cuyo bloque ya no existe se dice, no se inventa', () => {
    const html = paperHtml({
      title: 'Con cita rota',
      blocks: [bloque('block:1', null, 0, '((block:fantasma))')],
      resolveBlock: () => null,
    });
    assert.match(html, /ya no est[áa] en el corpus/);
    assert.ok(!html.includes('block:fantasma'), 'el identificador no se imprime');
  });

  it('sin resolvedor no se finge: no hay cita que imprimir', () => {
    // Es el estado anterior a esto, y se deja fijado para que no vuelva por
    // descuido: sin quien resuelva, lo que salía era el identificador.
    const html = paperHtml({
      title: 'Sin resolvedor',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
    });
    assert.match(html, /ya no est[áa] en el corpus/);
  });

  it('el texto citado se escapa: un bloque puede decir lo que quiera', () => {
    const html = paperHtml({
      title: 'Con cita hostil',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
      resolveBlock: () => ({ page: 'Otra', excerpt: '<script>alert(1)</script>' }),
    });
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });
});

/*
 * Los diagramas.
 *
 * @invariant ADiagramIsDrawnOnPaper. Imprimir la fuente es el peor de los
 * resultados: quien mira el papel no ve el diagrama y tampoco ve el texto, sino
 * una declaración en un lenguaje que no es el suyo ocupando el sitio de la
 * figura que el argumento necesitaba ahí.
 *
 * Aquí se prueba el pegado y no el dibujo: dibujar es arrancar un navegador, y
 * lo que puede romperse por descuido es que la fuente que se manda a dibujar y
 * la que después se busca para sustituir dejen de ser la misma.
 */
describe('un diagrama en el papel', () => {
  const fuente = 'flowchart LR\n  a[Uno] --> b[Dos]';
  const conDiagrama = (content: string) => [bloque('block:1', null, 0, content)];
  const cercado = (source: string) => '```mermaid\n' + source + '\n```';

  it('se encuentra en el papel dibujado, y tal como se escribió', () => {
    const html = paperHtml({ title: 'Con figura', blocks: conDiagrama(cercado(fuente)) });
    assert.deepEqual(diagramsIn(html), [fuente]);
  });

  it('con los caracteres que el HTML escapa, devueltos a lo que eran', () => {
    // Si esto se rompe, el mapa que vuelve del navegador tiene claves que no
    // casan con nada y la página dibuja la mitad de sus figuras.
    const hostil = 'flowchart LR\n  a["Uno & <dos>"] --> b';
    const html = paperHtml({ title: 'T', blocks: conDiagrama(cercado(hostil)) });
    assert.deepEqual(diagramsIn(html), [hostil]);
  });

  it('el mismo diagrama dos veces se dibuja una sola vez', () => {
    const html = paperHtml({
      title: 'T',
      blocks: [bloque('block:1', null, 0, cercado(fuente)), bloque('block:2', null, 1, cercado(fuente))],
    });
    assert.deepEqual(diagramsIn(html), [fuente]);
  });

  it('y se pega en los dos sitios donde estaba', () => {
    const html = paperHtml({
      title: 'T',
      blocks: [bloque('block:1', null, 0, cercado(fuente)), bloque('block:2', null, 1, cercado(fuente))],
      diagrams: new Map([[fuente, { svg: '<svg id="figura"></svg>' }]]),
    });
    assert.equal(html.match(/<svg id="figura">/g)?.length, 2);
  });

  it('dibujado, la fuente ya no se imprime', () => {
    const html = paperHtml({
      title: 'T',
      blocks: conDiagrama(cercado(fuente)),
      diagrams: new Map([[fuente, { svg: '<svg id="figura"></svg>' }]]),
    });
    assert.match(html, /<div class="diagram"><svg id="figura">/);
    assert.ok(!html.includes('language-mermaid'), 'la fuente sigue impresa');
    assert.ok(!html.includes('flowchart LR'), 'la fuente sigue impresa');
  });

  it('uno que no compila deja su fuente a la vista con el porqué encima', () => {
    // Es lo único con lo que se arregla. Un hueco callado sería peor.
    const html = paperHtml({
      title: 'T',
      blocks: conDiagrama(cercado(fuente)),
      diagrams: new Map([[fuente, { error: 'no hay tal tipo de diagrama' }]]),
    });
    assert.match(html, /no se pudo dibujar: no hay tal tipo de diagrama/);
    assert.match(html, /language-mermaid/);
  });

  it('el porqué se escapa: viene de una biblioteca y lleva el texto de quien escribe', () => {
    const html = paperHtml({
      title: 'T',
      blocks: conDiagrama(cercado(fuente)),
      diagrams: new Map([[fuente, { error: '<script>alert(1)</script>' }]]),
    });
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });

  it('sin nadie que los dibuje, el papel sale igual con sus fuentes', () => {
    // Es el estado anterior a esto. Se deja fijado: componer un papel no depende
    // de que haya un Chrome, sólo dibujar sus figuras depende.
    const html = paperHtml({ title: 'T', blocks: conDiagrama(cercado(fuente)) });
    assert.match(html, /language-mermaid/);
    assert.match(html, /flowchart LR/);
  });

  it('una página sin diagramas no tiene nada que dibujar', () => {
    // Lo que hace que componerla no arranque ningún navegador.
    const html = paperHtml({ title: 'T', blocks: conDiagrama('Un párrafo y `código en línea`.') });
    assert.deepEqual(diagramsIn(html), []);
  });

  it('un bloque de código que no es mermaid se queda como está', () => {
    const html = paperHtml({
      title: 'T',
      blocks: conDiagrama('```js\nconst a = 1;\n```'),
    });
    assert.deepEqual(diagramsIn(html), []);
    assert.match(html, /const a = 1;/);
  });
});

/*
 * Que la figura quepa en la hoja.
 *
 * @invariant ADiagramFitsOnOnePage. En pantalla sólo aprieta el ancho, porque
 * hacia abajo se sigue leyendo. En papel hacia abajo se acaba la hoja, y esa
 * segunda restricción suele mandar sobre la primera.
 */
describe('un diagrama que no cabe en la página', () => {
  const cercado = '```mermaid\nflowchart LR\n  a --> b\n```';
  const fuente = 'flowchart LR\n  a --> b';
  const conSvg = (svg: string) =>
    paperHtml({
      title: 'T',
      blocks: [bloque('block:1', null, 0, cercado)],
      diagrams: new Map([[fuente, { svg }]]),
    });
  const medidas = (html: string) => {
    const w = /<svg[^>]*\swidth="(\d+)"/.exec(html);
    const h = /<svg[^>]*\sheight="(\d+)"/.exec(html);
    return w === null || h === null ? null : { w: Number(w[1]), h: Number(h[1]) };
  };

  it('uno muy alto se encoge hasta caber en la hoja', () => {
    // 400 de ancho y 3.000 de alto: cabe de sobra a lo ancho y no de alto.
    const html = conSvg('<svg viewBox="0 0 400 3000" width="400" height="3000"></svg>');
    const m = medidas(html);
    assert.ok(m !== null, 'no quedó con medidas');
    assert.ok(m.h <= 820, `sigue midiendo ${m.h} de alto`);
  });

  it('y guarda la proporción: encogerlo sólo de alto cambiaría los ángulos', () => {
    const html = conSvg('<svg viewBox="0 0 400 3000" width="400" height="3000"></svg>');
    const m = medidas(html);
    assert.ok(m !== null);
    assert.ok(Math.abs(m.w / m.h - 400 / 3000) < 0.01, `proporción ${(m.w / m.h).toFixed(3)}`);
  });

  it('uno muy ancho se encoge por el ancho, como antes', () => {
    const html = conSvg('<svg viewBox="0 0 2000 300" width="2000" height="300"></svg>');
    const m = medidas(html);
    assert.ok(m !== null);
    assert.ok(m.w <= 649, `sigue midiendo ${m.w} de ancho`);
    assert.ok(Math.abs(m.w / m.h - 2000 / 300) < 0.05);
  });

  it('manda la más chica de las dos, cuando las dos aprietan', () => {
    // 2.000 × 2.000: por ancho el factor sería 0,32; por alto, 0,41. Gana el ancho.
    const html = conSvg('<svg viewBox="0 0 2000 2000" width="2000" height="2000"></svg>');
    const m = medidas(html);
    assert.ok(m !== null);
    assert.ok(m.w <= 649 && m.h <= 820, `${m.w}x${m.h} no cabe`);
  });

  it('uno que ya cabe no se agranda para llenar la caja', () => {
    const html = conSvg('<svg viewBox="0 0 200 150" width="200" height="150"></svg>');
    assert.deepEqual(medidas(html), { w: 200, h: 150 });
  });

  it('se le quita el max-width que Mermaid le escribe encima', () => {
    // Es el que en pantalla lo encoge a la columna. Aquí desharía la cuenta:
    // encogería el ancho sin tocar el alto, que es el hueco que esto vino a quitar.
    const html = conSvg(
      '<svg viewBox="0 0 2000 300" width="2000" height="300" style="max-width: 2000px;"></svg>',
    );
    assert.ok(!html.includes('max-width: 2000px'));
  });

  it('sin viewBox no se inventa una medida', () => {
    // La proporción es lo único de lo que se puede deducir cuánto encoger.
    const html = conSvg('<svg id="sinCaja"></svg>');
    assert.match(html, /<svg id="sinCaja">/);
  });
});

describe('un dibujo a mano en el papel', () => {
  it('uno muy vertical se encoge proporcionalmente hasta caber en una hoja', () => {
    const html = paperHtml({
      title: 'Dibujo largo',
      blocks: [
        bloque(
          'block:1',
          null,
          0,
          '```dibujo\n10,10,50 400,3000\n```',
        ),
      ],
    });
    const figure = /<figure class="drawn">(<svg[^>]*>)/.exec(html)?.[1] ?? '';
    const box = /viewBox="[^"]* ([\d.]+) ([\d.]+)"/.exec(figure);
    const size = /width="(\d+)" height="(\d+)"/.exec(figure);
    assert.ok(box !== null && size !== null, 'el dibujo no llegó como figura medida');
    const originalWidth = Number(box[1]);
    const originalHeight = Number(box[2]);
    const width = Number(size[1]);
    const height = Number(size[2]);
    assert.ok(height <= 820, `sigue midiendo ${height} de alto`);
    assert.ok(Math.abs(width / height - originalWidth / originalHeight) < 0.01);
  });

  it('su figura se declara indivisible', () => {
    const html = paperHtml({ title: 'Dibujo', blocks: [] });
    assert.match(html, /\.b \.drawn \{[\s\S]*?break-inside: avoid/);
  });
});

describe('una tabla larga en el papel', () => {
  it('puede partirse y repite la cabecera en la página siguiente', () => {
    const html = paperHtml({
      title: 'Tabla',
      blocks: [bloque('block:1', null, 0, '| Nombre | Valor |\n| --- | --- |\n| uno | 1 |')],
    });
    assert.match(html, /<table><thead><tr><th>Nombre<\/th><th>Valor<\/th><\/tr><\/thead>/);
    assert.match(html, /\.b thead \{ display: table-header-group; \}/);
    const tableRule = /\.b table \{([^}]*)\}/.exec(html)?.[1] ?? '';
    assert.ok(!tableRule.includes('break-inside'), 'la tabla completa sigue siendo indivisible');
  });
});
