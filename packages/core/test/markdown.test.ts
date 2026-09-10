// Pruebas del renderizador Markdown. No tocan el DOM: entra texto, sale HTML.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { headingAnchor, inlineMarkdown, linkedResourceIn, renderMarkdown, uniqueAnchors } from '../src/markdown.ts';

describe('inlineMarkdown', () => {
  it('escapa el HTML antes de cualquier otra cosa', () => {
    assert.equal(
      inlineMarkdown('<script>alert(1)</script>'),
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('convierte un enlace wiki en algo navegable', () => {
    assert.equal(
      inlineMarkdown('ver [[Travesía]]'),
      'ver <a class="wiki" data-page="Travesía" href="#">Travesía</a>',
    );
  });

  it('separa el destino de las palabras visibles de un enlace wiki', () => {
    assert.equal(
      inlineMarkdown('participan como [[VERA: Puerta MCP|agentes identificables]]'),
      'participan como <a class="wiki" data-page="VERA: Puerta MCP" href="#">agentes identificables</a>',
    );
  });

  it('enlaza las etiquetas a su página, con la almohadilla dentro', () => {
    // Una etiqueta es el nombre de una página: `#diseño` y `[[diseño]]` nombran
    // lo mismo, así que van al mismo sitio y por el mismo camino. La almohadilla
    // se queda dentro del enlace porque es lo que distingue a la vista una
    // clasificación de una mención.
    assert.equal(
      inlineMarkdown('sobre #diseño'),
      'sobre <a class="wiki tag" data-page="diseño" href="#">#diseño</a>',
    );
  });

  it('enlaza también la etiqueta con espacios', () => {
    // `#[[…]]` se resuelve antes que `[[…]]` a secas: si no, el corchete se
    // llevaría el título y la almohadilla quedaría suelta delante del enlace.
    assert.equal(
      inlineMarkdown('sobre #[[diseño gráfico]]'),
      'sobre <a class="wiki tag" data-page="diseño gráfico" href="#">#diseño gráfico</a>',
    );
  });

  it('no confunde una almohadilla pegada a una palabra', () => {
    assert.equal(inlineMarkdown('C#3'), 'C#3');
  });

  it('respeta negrita, cursiva y código', () => {
    assert.equal(inlineMarkdown('**a** *b* `c`'), '<strong>a</strong> <em>b</em> <code>c</code>');
  });

  it('no toma la negrita por cursiva', () => {
    assert.equal(inlineMarkdown('**fuerte**'), '<strong>fuerte</strong>');
  });

  it('conserva los saltos de línea del bloque', () => {
    assert.equal(inlineMarkdown('una\notra'), 'una<br>otra');
  });

  it('deja pasar un enlace externo', () => {
    const rendered = inlineMarkdown('[sitio](https://herbertspencer.net)');
    assert.ok(rendered.includes('href="https://herbertspencer.net"'));
    assert.ok(rendered.includes('rel="noreferrer"'));
  });

  it('vuelve clicable una URL cruda sin exigir Markdown', () => {
    const html = inlineMarkdown('ver https://ejemplo.cl/uno ahora');
    assert.match(html, /<a href="https:\/\/ejemplo\.cl\/uno"/);
    assert.match(html, />https:\/\/ejemplo\.cl\/uno<\/a>/);
  });

  it('deja fuera del enlace la puntuación de la frase', () => {
    assert.match(inlineMarkdown('ver https://ejemplo.cl/uno.'), /uno<\/a>\.<\/a>|uno<\/a>\./);
  });

  it('reconoce tachado y resaltado', () => {
    assert.equal(inlineMarkdown('~~ido~~ y ==esto=='), '<del>ido</del> y <mark>esto</mark>');
  });

  it('presenta subrayado, superíndice y subíndice sin guardar HTML', () => {
    assert.equal(
      inlineMarkdown('++debajo++ ^arriba^ ~abajo~'),
      '<u>debajo</u> <sup>arriba</sup> <sub>abajo</sub>',
    );
  });

  describe('imágenes', () => {
    it('emite una imagen remota', () => {
      assert.equal(
        inlineMarkdown('![gato](https://x.cl/g.png)'),
        '<img src="https://x.cl/g.png" alt="gato" loading="lazy">',
      );
    });

    it('acepta la ruta relativa que trae el corpus', () => {
      const html = inlineMarkdown('![](../assets/2024-06-06.jpeg)');
      assert.match(html, /<img src="\.\.\/assets\/2024-06-06\.jpeg" alt=""/);
    });

    it('no confunde una imagen con un enlace', () => {
      const html = inlineMarkdown('![alt](https://x.cl/a.png)');
      assert.ok(!html.includes('<a '), 'la imagen no debe producir un enlace');
    });
  });

  describe('seguridad', () => {
    it('no emite un href con javascript:', () => {
      const html = inlineMarkdown('[click](javascript:alert(1))');
      assert.ok(!html.includes('<a '), `no debe haber enlace: ${html}`);
      assert.ok(!html.toLowerCase().includes('javascript:alert(1)</a>'));
    });

    it('no emite un src con javascript:', () => {
      const html = inlineMarkdown('![x](javascript:alert(1))');
      assert.ok(!html.includes('<img'), `no debe haber imagen: ${html}`);
    });

    it('escapa las comillas de un atributo', () => {
      const html = inlineMarkdown('![" onerror="alert(1)](https://x.cl/a.png)');
      assert.ok(!html.includes('onerror="alert(1)"'), `atributo inyectado: ${html}`);
    });

    // Estos tres los encontró el corpus, no la imaginación. Una regla que corre
    // después de emitir un elemento reescribía lo que había dentro de sus
    // atributos, y ahí `class="tag"` cerraba el atributo y abría otros.
    describe('ninguna marca se cuela dentro de un atributo ya emitido', () => {
      it('una etiqueta dentro del texto alternativo no rompe el alt', () => {
        const html = inlineMarkdown('![a #tag](https://x.cl/i.png)');
        assert.equal(html, '<img src="https://x.cl/i.png" alt="a #tag" loading="lazy">');
      });

      it('una cursiva dentro del texto alternativo queda como texto', () => {
        const html = inlineMarkdown('![en *Begriffsschrift*](../assets/a.png)');
        assert.match(html, /alt="en \*Begriffsschrift\*"/);
        assert.ok(!html.includes('<em>'), `marcado dentro del alt: ${html}`);
      });

      it('una comilla en un enlace wiki no abre atributos nuevos', () => {
        const html = inlineMarkdown('[[titulo" onmouseover="alert(1)]]');
        // Lo que importa no es que el texto `onmouseover` no aparezca —aparece,
        // escapado, dentro del valor— sino que la etiqueta no gane atributos.
        const open = /^<a ([^>]*)>/.exec(html)?.[1] ?? '';
        const names = [...open.matchAll(/([a-z-]+)="/g)].map((match) => match[1]);
        assert.deepEqual(names, ['class', 'data-page', 'href'], `atributos: ${open}`);
        assert.match(html, /data-page="titulo&quot;/);
      });

      it('una almohadilla en una URL no se vuelve etiqueta', () => {
        assert.match(
          inlineMarkdown('[x](https://x.cl/a#seccion)'),
          /href="https:\/\/x\.cl\/a#seccion"/,
        );
      });
    });

    it('no escapa dos veces el ampersand de una URL', () => {
      const html = inlineMarkdown('[x](https://x.cl/a?u=1&v=2)');
      assert.match(html, /href="https:\/\/x\.cl\/a\?u=1&amp;v=2"/);
      assert.ok(!html.includes('&amp;amp;'), `doble escapado: ${html}`);
    });

    it('restituye una imagen anidada dentro de un enlace', () => {
      const html = inlineMarkdown('[![alt](https://x.cl/i.png)](https://x.cl)');
      assert.match(html, /^<a href="https:\/\/x\.cl"[^>]*><img src="https:\/\/x\.cl\/i\.png"/);
      assert.ok(!html.includes('\u0000'), `quedó una marca interna sin restituir: ${html}`);
    });

    it('descarta una marca interna que venga en la fuente', () => {
      assert.ok(!inlineMarkdown('a\u00000\u0000b').includes('\u0000'));
    });
  });

  describe('resolución de medios', () => {
    // El bloque conserva su `../assets/foo.png`; lo que cambia es a dónde
    // apunta la presentación. La fuente no se toca nunca.
    const resolver = {
      resolveAsset: (path: string) =>
        path === '../assets/foto.png'
          ? { url: '/media/' + 'a'.repeat(64), mediaType: 'image/png' }
          : path === '../assets/informe.pdf'
            ? { url: '/media/' + 'b'.repeat(64), mediaType: 'application/pdf' }
            : null,
    };

    it('una imagen del corpus apunta al objeto guardado', () => {
      const html = inlineMarkdown('![retrato](../assets/foto.png)', resolver);
      assert.match(html, new RegExp(`<img src="/media/${'a'.repeat(64)}" alt="retrato"`));
    });

    it('resuelve una ruta con espacios escrita por el cargador', () => {
      const html = inlineMarkdown('![captura](../assets/Captura de pantalla.png)', {
        resolveAsset: (path) =>
          path === '../assets/Captura de pantalla.png'
            ? { url: '/media/abc', mediaType: 'image/png' }
            : null,
      });
      assert.match(html, /<img src="\/media\/abc" alt="captura"/);
    });

    it('lo que no es imagen se ofrece como archivo, no se finge presentado', () => {
      const html = inlineMarkdown('[el informe](../assets/informe.pdf)', resolver);
      assert.match(html, /class="media-file"/);
      assert.match(html, /data-media-type="application\/pdf"/);
      assert.ok(!html.includes('<img'), `un PDF no es una imagen: ${html}`);
    });

    it('una ruta que Vera no tiene se emite tal cual y degrada sola', () => {
      const html = inlineMarkdown('![x](../assets/ausente.png)', resolver);
      assert.match(html, /<img src="\.\.\/assets\/ausente\.png"/);
    });

    it('sin resolvedor se comporta igual que antes', () => {
      assert.equal(
        inlineMarkdown('![x](../assets/foto.png)'),
        '<img src="../assets/foto.png" alt="x" loading="lazy">',
      );
    });

    it('un enlace externo no pasa por el resolvedor', () => {
      const html = inlineMarkdown('[fuera](https://x.cl/a.png)', resolver);
      assert.match(html, /href="https:\/\/x\.cl\/a\.png"/);
      assert.ok(!html.includes('media-file'));
    });

    it('la URL resuelta se escapa como atributo', () => {
      const html = inlineMarkdown('![x](../assets/foto.png)', {
        resolveAsset: () => ({ url: '/media/a" onerror="alert(1)', mediaType: 'image/png' }),
      });
      const open = /^<img ([^>]*)>/.exec(html)?.[1] ?? '';
      const names = [...open.matchAll(/([a-z-]+)="/g)].map((match) => match[1]);
      assert.deepEqual(names, ['src', 'alt', 'loading'], `atributos: ${open}`);
    });

    it('renderMarkdown propaga el resolvedor a un bloque entero', () => {
      const html = renderMarkdown('# Título\n\n![f](../assets/foto.png)', resolver);
      assert.match(html, /<h2>Título<\/h2>/);
      assert.match(html, new RegExp(`src="/media/${'a'.repeat(64)}"`));
    });

    it('lo propaga también dentro de una lista y de una tabla', () => {
      assert.match(
        renderMarkdown('- ![f](../assets/foto.png)', resolver),
        new RegExp(`<ul><li><img src="/media/${'a'.repeat(64)}"`),
      );
      assert.match(
        renderMarkdown('| a |\n| --- |\n| ![f](../assets/foto.png) |', resolver),
        new RegExp(`<td><img src="/media/${'a'.repeat(64)}"`),
      );
    });
  });

  describe('notas al pie', () => {
    it('convierte la referencia en un salto al destino', () => {
      assert.equal(
        inlineMarkdown('afirmación[^3]'),
        'afirmación<sup class="fnref"><a class="fnref-link" data-footnote="3" href="#fn-3">3</a></sup>',
      );
    });

    it('acepta varias referencias seguidas, como en el corpus', () => {
      const html = inlineMarkdown('artefactos.[^3], [^5]');
      assert.match(html, /href="#fn-3"/);
      assert.match(html, /href="#fn-5"/);
    });

    it('deja la identidad única para cuando se componga la página completa', () => {
      assert.ok(!inlineMarkdown('x[^1]').includes('id='));
    });
  });
});

describe('renderMarkdown', () => {
  describe('encabezados', () => {
    it('baja un nivel, porque el título de la página ya es el h1', () => {
      assert.equal(renderMarkdown('# Sección'), '<h2>Sección</h2>');
      assert.equal(renderMarkdown('## Sub'), '<h3>Sub</h3>');
    });

    it('no pasa de h6', () => {
      assert.equal(renderMarkdown('###### hondo'), '<h6>hondo</h6>');
    });

    it('no toma por encabezado una almohadilla sin espacio', () => {
      assert.equal(
        renderMarkdown('#etiqueta'),
        '<p><a class="wiki tag" data-page="etiqueta" href="#">#etiqueta</a></p>',
      );
    });

    it('renderiza las marcas de línea dentro del encabezado', () => {
      assert.equal(renderMarkdown('# ver [[Otra]]'),
        '<h2>ver <a class="wiki" data-page="Otra" href="#">Otra</a></h2>');
    });
  });

  describe('listas', () => {
    it('agrupa viñetas en una sola lista', () => {
      assert.equal(renderMarkdown('- uno\n- dos'), '<ul><li>uno</li><li>dos</li></ul>');
    });

    it('reconoce la lista numerada', () => {
      assert.equal(renderMarkdown('1. uno\n2. dos'), '<ol><li>uno</li><li>dos</li></ol>');
    });

    it('mantiene una sola numeración aunque haya aire entre los ítems', () => {
      assert.equal(
        renderMarkdown('1. uno\n\n1. dos\n\n1. tres'),
        '<ol><li>uno</li><li>dos</li><li>tres</li></ol>',
      );
    });

    it('respeta el ordinal con que comienza una lista', () => {
      assert.equal(renderMarkdown('3. tres\n4. cuatro'), '<ol start="3"><li>tres</li><li>cuatro</li></ol>');
    });

    it('anida por sangría', () => {
      assert.equal(
        renderMarkdown('- uno\n  - hijo\n- dos'),
        '<ul><li>uno<ul><li>hijo</li></ul></li><li>dos</li></ul>',
      );
    });

    it('cierra la ordenada con su propia etiqueta', () => {
      const html = renderMarkdown('- uno\n  1. hijo\n- dos');
      assert.ok(html.includes('</ol>'), `debe cerrar con </ol>: ${html}`);
      assert.equal((html.match(/<ol>/g) ?? []).length, (html.match(/<\/ol>/g) ?? []).length);
      assert.equal((html.match(/<ul>/g) ?? []).length, (html.match(/<\/ul>/g) ?? []).length);
    });
  });

  describe('código', () => {
    it('no renderiza marcas dentro de un bloque cercado', () => {
      assert.equal(
        renderMarkdown('```\n**no** [[tampoco]]\n```'),
        '<pre><code>**no** [[tampoco]]</code></pre>',
      );
    });

    it('conserva el lenguaje declarado', () => {
      assert.equal(
        renderMarkdown('```ts\nconst a = 1;\n```'),
        '<pre><code class="language-ts">const a = 1;</code></pre>',
      );
    });

    it('escapa el HTML del ejemplo', () => {
      assert.equal(
        renderMarkdown('```\n<img src=x onerror=alert(1)>\n```'),
        '<pre><code>&lt;img src=x onerror=alert(1)&gt;</code></pre>',
      );
    });

    it('cierra un cercado sin cerrar al terminar el bloque', () => {
      assert.equal(renderMarkdown('```\nabierto'), '<pre><code>abierto</code></pre>');
    });

    // Contrato con mermaid.ts: busca exactamente esta clase para sustituir el
    // cercado por el diagrama. Si la clase cambia, los 34 diagramas del corpus
    // se quedan como código sin que falle nada más.
    it('marca el cercado mermaid con la clase que busca el dibujante', () => {
      const html = renderMarkdown('```mermaid\ngraph TD\nA-->B\n```');
      assert.match(html, /<code class="language-mermaid">/);
      assert.match(html, /graph TD\nA--&gt;B/);
    });

    it('el diagrama no deja de ser texto en la fuente', () => {
      // Lo que se guarda sigue siendo el cercado; dibujarlo es cosa del DOM.
      const source = '```mermaid\ngraph TD\nA-->B\n```';
      assert.ok(renderMarkdown(source).includes('graph TD'));
    });

    it('presenta MediaWiki básico sin ejecutar su marcado y conserva la fuente', () => {
      const source = [
        '== Título ==',
        "'''fuerte''' e ''itálica'' con [[Página|enlace interno]]",
        '* uno',
        '* dos',
        '{| class="wikitable"',
        '! A !! B',
        '|-',
        '| 1 || 2',
        '|}',
        '<script>alert(1)</script>',
      ].join('\n');
      const html = renderMarkdown(`\`\`\`mediawiki\n${source}\n\`\`\``);
      assert.match(html, /class="mediawiki-figure"/);
      assert.match(html, /<h3>Título<\/h3>/);
      assert.match(html, /<strong>fuerte<\/strong> e <em>itálica<\/em>/);
      assert.match(html, /<span class="mediawiki-link" title="Página">enlace interno<\/span>/);
      assert.match(html, /<ul><li>uno<\/li><li>dos<\/li><\/ul>/);
      assert.match(html, /<table><tr><th>A<\/th><th>B<\/th><\/tr><tr><td>1<\/td><td>2<\/td><\/tr><\/table>/);
      assert.ok(!html.includes('<script>alert'));
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.match(html, /fuente MediaWiki/);
    });

    it('lee tablas MediaWiki con atributos, leyenda, enlaces y celdas multilínea', () => {
      const source = [
        '{| class="wikitable sortable" style="width:100%"',
        '|+ style="text-align:left" | Inventario',
        '|-',
        '! scope="col" | Objeto !! scope="col" | Cantidad',
        '|-',
        '| rowspan="2" style="color:red" | [[Lápiz|Lápices]]',
        'azules',
        '| 12',
        '|-',
        '| colspan="2" | Total || 12',
        '|}',
      ].join('\n');
      const html = renderMarkdown(`\`\`\`mediawiki\n${source}\n\`\`\``);
      assert.match(html, /<caption>Inventario<\/caption>/);
      assert.match(html, /<th scope="col">Objeto<\/th><th scope="col">Cantidad<\/th>/);
      assert.match(html, /<td rowspan="2"><span class="mediawiki-link" title="Lápiz">Lápices<\/span> azules<\/td>/);
      assert.match(html, /<td colspan="2">Total<\/td><td>12<\/td>/);
      const rendered = /<div class="mediawiki-body">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
      assert.ok(!rendered.includes('color:red'));
      assert.ok(!rendered.includes('width:100%'));
    });

    it('sólo ejecuta HTML creado con la valla explícita', () => {
      const live = renderMarkdown('```html-live\n<button onclick="x()">sí</button>\n```');
      assert.match(live, /<iframe [^>]*sandbox="allow-scripts"/);
      assert.match(live, /srcdoc=/);
      assert.ok(!live.includes('allow-same-origin'));
      assert.match(live, /fuente HTML/);

      assert.ok(!renderMarkdown('<button>histórico</button>').includes('<iframe'));
      assert.ok(!renderMarkdown('```html\n<button>ejemplo</button>\n```').includes('<iframe'));
    });

    it('ejecuta p5.js contra el runtime local dentro del sandbox', () => {
      const html = renderMarkdown('```p5js\ncreateCanvas(40, 40)\n```');
      assert.match(html, /sandbox="allow-scripts"/);
      assert.match(html, /data-executable-frame/);
      assert.match(html, /src="\/p5-frame\.html#/);
      assert.ok(!html.includes('allow-same-origin'));
      assert.match(html, /createCanvas\(40, 40\)/);
    });

    it('presenta SVG explícito en un recinto aislado y conserva su fuente', () => {
      const source = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
      const html = renderMarkdown(`\`\`\`svg\n${source}\n\`\`\``);
      assert.match(html, /class="executable executable-svg"/);
      assert.match(html, /data-executable-frame/);
      assert.match(html, /sandbox="allow-scripts"/);
      assert.ok(!html.includes('allow-same-origin'));
      assert.match(html, /script-src 'sha256-/);
      assert.ok(!html.includes("script-src 'unsafe-inline'"));
      assert.match(html, /fuente ilustración SVG/);
      assert.match(html, /&lt;svg viewBox=/);
    });

    it('el SVG pegado fuera de su bloque explícito permanece inerte', () => {
      const html = renderMarkdown('<svg><script>alert(1)</script></svg>');
      assert.ok(!html.includes('<iframe'));
      assert.match(html, /&lt;svg&gt;/);
    });
  });

  describe('tablas', () => {
    it('exige la fila separadora', () => {
      const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
      assert.match(html, /<table>/);
      assert.match(html, /<th>a<\/th><th>b<\/th>/);
      assert.match(html, /<td>1<\/td><td>2<\/td>/);
    });

    it('no toma por tabla un texto con barras', () => {
      const html = renderMarkdown('a | b | c');
      assert.ok(!html.includes('<table>'), `no es una tabla: ${html}`);
    });

    it('envuelve la tabla para que desborde sola', () => {
      assert.match(renderMarkdown('| a |\n| --- |\n| 1 |'), /<div class="table-scroll">/);
    });
  });

  describe('citas y líneas', () => {
    it('agrupa líneas consecutivas en una cita', () => {
      assert.equal(renderMarkdown('> una\n> otra'), '<blockquote>una<br>otra</blockquote>');
    });

    it('reconoce la línea horizontal', () => {
      assert.equal(renderMarkdown('---'), '<hr>');
    });
  });

  describe('notas al pie', () => {
    it('la definición lleva el id al que salta la referencia', () => {
      const html = renderMarkdown('[^3]: Gaver y Bowers, 2012.');
      assert.match(html, /id="fn-3"/);
      assert.match(html, /Gaver y Bowers, 2012\./);
    });

    it('la definición ofrece volver a la referencia', () => {
      const html = renderMarkdown('[^3]: Gaver y Bowers, 2012.');
      assert.match(html, /class="footnote-back"/);
      assert.match(html, /href="#fnref-3"/);
      assert.match(html, /aria-label="volver a la referencia 3"/);
    });

    it('referencia y definición se encuentran en la misma página', () => {
      const ref = inlineMarkdown('afirmación[^3]');
      const def = renderMarkdown('[^3]: la fuente');
      const target = /href="#([^"]+)"/.exec(ref)?.[1];
      assert.ok(target !== undefined);
      assert.ok(def.includes(`id="${target}"`), `${ref} no encuentra a ${def}`);
    });
  });

  describe('párrafos', () => {
    it('separa por línea en blanco', () => {
      assert.equal(renderMarkdown('uno\n\ndos'), '<p>uno</p><p>dos</p>');
    });

    it('conserva el salto suave dentro del párrafo', () => {
      assert.equal(renderMarkdown('uno\ndos'), '<p>uno<br>dos</p>');
    });

    it('devuelve vacío para una fuente vacía', () => {
      assert.equal(renderMarkdown(''), '');
    });

    it('presenta un poema completo como prosa poética con Markdown seguro', () => {
      assert.equal(
        renderMarkdown('<poem>\nY se detuvo en la **sustancia**\ncuando el aire despertó\n</poem>'),
        '<div class="poem">Y se detuvo en la <strong>sustancia</strong><br>cuando el aire despertó</div>',
      );
    });

    it('conserva blancos, sangrías y renglones como un pre', () => {
      assert.equal(
        renderMarkdown('<poem>\n  primero\n\n    segundo\n</poem>'),
        '<div class="poem">  primero<br><br>    segundo</div>',
      );
    });

    it('no acepta atributos ni un poem incrustado como HTML activo', () => {
      const attributed = renderMarkdown('<poem onclick="alert(1)">texto</poem>');
      assert.ok(!attributed.includes('<poem'));
      assert.match(attributed, /&lt;poem/);

      const embedded = renderMarkdown('antes <poem>texto</poem> después');
      assert.ok(!embedded.includes('<poem'));
      assert.match(embedded, /&lt;poem&gt;/);
    });
  });

  describe('la fuente manda', () => {
    it('el HTML crudo del corpus se ve, no se ejecuta', () => {
      const html = renderMarkdown('<div onclick="alert(1)">hola</div>');
      assert.ok(!html.includes('<div'), `marcado activo: ${html}`);
      assert.match(html, /&lt;div/);
    });

    it('un iframe dentro de una frase queda como texto', () => {
      // Lo que cambió es la excepción y no la regla: un bloque que es, entero,
      // una incrustación se presenta como tal —ver «incrustaciones» más abajo—.
      // Dentro de una frase sigue siendo texto, que es lo que protege a los 108
      // bloques de HTML crudo que el corpus trae.
      const html = renderMarkdown('esto: <iframe src="https://x.cl"></iframe> y más');
      assert.ok(!html.includes('<iframe'));
      assert.match(html, /&lt;iframe/);
    });
  });
});

/*
 * Un bloque que es, entero, una incrustación.
 *
 * Ver specs/executable-content-sandbox.allium. La regla de la casa sigue siendo
 * que el marcado escrito dentro de un bloque se presenta como texto; la
 * excepción es una y es estrecha, y estas pruebas son su frontera.
 */
describe('incrustaciones', () => {
  const embed = '<iframe src="https://eadpucv.github.io/pix/#!/x" width="100%" height="574"></iframe>';

  /*
   * Quién puede entrar lo dice el corpus, no el bloque.
   *
   * Estas pruebas hablan de un corpus que ya registró a estos dos servidores;
   * sin registro no entra nadie, y de eso hablan las últimas de aquí abajo.
   */
  const allowed = { embedHosts: ['eadpucv.github.io', 'ejemplo.cl'] };

  it('una URL de YouTube pegada sola usa el reproductor sin cookies', () => {
    const html = renderMarkdown('https://youtu.be/dQw4w9WgXcQ');
    assert.match(html, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
    assert.match(html, /sandbox=/);
    assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/);
    assert.match(html, /Traer transcripción/);
    assert.match(html, /data-youtube-source="https:\/\/youtu\.be\/dQw4w9WgXcQ"/);
  });

  it('reconoce watch, shorts y no incrusta una URL mezclada con prosa', () => {
    assert.match(renderMarkdown('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), /youtube-nocookie/);
    assert.match(renderMarkdown('https://youtube.com/shorts/dQw4w9WgXcQ'), /youtube-nocookie/);
    assert.ok(!renderMarkdown('mira https://youtu.be/dQw4w9WgXcQ').includes('<iframe'));
  });

  it('un bloque que es una incrustación entera se presenta como tal', () => {
    const html = renderMarkdown(embed, allowed);
    assert.match(html, /<figure class="embed"/);
    assert.match(html, /src="https:\/\/eadpucv\.github\.io\/pix\/#!\/x"/);
  });

  it('una valla iframe incrusta dentro de un bloque mixto sin activar el resto del HTML', () => {
    const html = renderMarkdown([
      '### Herramienta',
      '```iframe',
      embed,
      '```',
      'Una explicación con <button>HTML inerte</button>.',
    ].join('\n'), allowed);
    assert.match(html, /<h4>Herramienta<\/h4>/);
    assert.match(html, /<figure class="embed"/);
    assert.match(html, /incrustado desde eadpucv\.github\.io/);
    assert.ok(!html.includes('<button>HTML inerte</button>'));
    assert.match(html, /&lt;button&gt;HTML inerte&lt;\/button&gt;/);
  });

  it('una valla iframe conserva como código una procedencia no autorizada', () => {
    const source = ['```iframe', embed, '```'].join('\n');
    const html = renderMarkdown(source, { embedHosts: ['otro.cl'] });
    assert.ok(!html.includes('<figure class="embed"'));
    assert.match(html, /class="language-iframe"/);
    assert.match(html, /&lt;iframe/);
  });

  it('corre encerrada: es quien es y no alcanza nada de Vera', () => {
    /*
     * @invariant NothingReachesBack. Corre con su propio origen —lo necesita
     * para guardar lo suyo y hablar con su servidor, o una herramienta no
     * arranca— y el navegador no le deja cruzar al de Vera. Lo que no lleva:
     * navegar la ventana de arriba, pantalla completa ni descargas.
     */
    const html = renderMarkdown(embed, allowed);
    assert.match(html, /sandbox="allow-scripts allow-forms allow-popups allow-same-origin"/);
    assert.ok(!html.includes('allow-top-navigation'));
    assert.ok(!html.includes('allow-downloads'));
  });

  it('y no dice desde qué página se la mira', () => {
    assert.match(renderMarkdown(embed, allowed), /referrerpolicy="no-referrer"/);
  });

  it('no se pide hasta que se llega a ella', () => {
    assert.match(renderMarkdown(embed, allowed), /loading="lazy"/);
  });

  it('dice de dónde viene', () => {
    // @invariant AnEmbedIsNotAnonymous.
    assert.match(renderMarkdown(embed, allowed), /incrustado desde eadpucv\.github\.io/);
  });

  it('respeta el alto que se le puso, y si no tiene le da uno', () => {
    assert.match(renderMarkdown(embed, allowed), /height="574"/);
    assert.match(
      renderMarkdown('<iframe src="https://ejemplo.cl/x"></iframe>', allowed),
      /height="460"/,
    );
  });

  it('sin cifrar no se incrusta: se lee como el texto que es', () => {
    const html = renderMarkdown('<iframe src="http://ejemplo.cl/x"></iframe>', allowed);
    assert.ok(!html.includes('<iframe'));
    assert.match(html, /&lt;iframe/);
  });

  it('dentro de una frase sigue siendo texto', () => {
    // @invariant AWholeBlockOrNothing: si bastara con que apareciera en
    // cualquier parte, pegar una nota copiada de la web convertiría media
    // bitácora en marcado ajeno.
    const html = renderMarkdown(`mira esto: ${embed} y sigue la frase`, allowed);
    assert.ok(!html.includes('<figure class="embed"'));
    assert.match(html, /&lt;iframe/);
  });

  it('dos incrustaciones en un bloque tampoco: es una o ninguna', () => {
    const html = renderMarkdown(`${embed}\n${embed}`, allowed);
    assert.ok(!html.includes('<figure class="embed"'));
  });

  it('lo que no es una incrustación sigue leyéndose como texto', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;script&gt;/);
  });

  it('una dirección no se escapa de su atributo', () => {
    // La dirección viaja entre comillas: si una comilla suya pasara sin escapar,
    // lo que sigue dejaría de ser una dirección y pasaría a ser marcado.
    const html = renderMarkdown('<iframe src="https://ejemplo.cl/?a=b" onload="alert(1)"></iframe>', allowed);
    assert.ok(!html.includes('onload'), `atributo ajeno: ${html}`);
    const src = /src="([^"]*)"/.exec(html)?.[1] ?? '';
    assert.equal(src, 'https://ejemplo.cl/?a=b');
  });

  it('de un servidor que el corpus no registró, no entra', () => {
    // Que algo corra dentro de una página propia no lo decide quien pegó la
    // dirección: una dirección se copia y se pega sin mirar.
    const html = renderMarkdown(embed, { embedHosts: ['otro.cl'] });
    assert.ok(!html.includes('<figure class="embed"'));
    assert.match(html, /&lt;iframe/);
  });

  it('sin lista, ninguno: el corpus que no dijo nada no dijo que sí', () => {
    const html = renderMarkdown(embed);
    assert.ok(!html.includes('<figure class="embed"'));
  });

  it('registrar un servidor registra a los suyos', () => {
    // `github.io` deja entrar a `eadpucv.github.io`; quien quiera sólo uno
    // registra el nombre entero.
    const html = renderMarkdown(embed, { embedHosts: ['github.io'] });
    assert.match(html, /<figure class="embed"/);
  });

  it('y no a quien sólo termina pareciéndose', () => {
    // `noeadpucv.github.io` no es de `eadpucv.github.io`, aunque lo lleve dentro.
    const html = renderMarkdown(
      '<iframe src="https://malo-eadpucv.github.io/x"></iframe>',
      { embedHosts: ['eadpucv.github.io'] },
    );
    assert.ok(!html.includes('<figure class="embed"'));
  });
});

describe('recursos enlazados', () => {
  it('presenta un PDF solitario sin pedirlo hasta pulsar Mostrar', () => {
    const html = linkedResourceIn('https://ejemplo.cl/documento.pdf');
    assert.match(html ?? '', /data-resource-kind="pdf"/);
    assert.match(html ?? '', /linked-resource-show/);
    assert.ok(!(html ?? '').includes('<iframe'));
  });

  it('usa como título el rótulo Markdown producido al procesar', () => {
    const html = renderMarkdown('[Informe anual](https://ejemplo.cl/informe)');
    assert.match(html, />Informe anual<\/a>/);
    assert.match(html, /enlace · ejemplo\.cl/);
  });

  it('reconoce TikTok e Instagram como adaptadores sin ejecutar sus scripts', () => {
    assert.match(renderMarkdown('https://www.tiktok.com/@vera/video/123'), /data-resource-kind="tiktok"/);
    assert.match(renderMarkdown('https://www.instagram.com/p/abc/'), /data-resource-kind="instagram"/);
    assert.ok(!renderMarkdown('https://www.instagram.com/p/abc/').includes('<script'));
  });

  it('mantiene una URL mezclada con prosa como enlace ordinario', () => {
    const html = renderMarkdown('mira https://ejemplo.cl/archivo.pdf después');
    assert.ok(!html.includes('linked-resource'));
    assert.match(html, /<a href="https:\/\/ejemplo\.cl\/archivo\.pdf"/);
  });
});

/*
 * Las anclas: cómo se llama un encabezado para que un índice pueda nombrarlo.
 *
 * Ver specs/workspace-interface.allium, @invariant AnchorsReachTheirHeading. Las
 * reglas son las de GitHub y no por deferencia: los documentos que traen índices
 * con anclas se escribieron para ese lector, así que cualquier otra convención
 * rompería justamente los enlaces que ya venían escritos.
 */
describe('el nombre de un encabezado', () => {
  it('son sus palabras en minúsculas, unidas por guiones', () => {
    assert.equal(headingAnchor('El camino de una escritura'), 'el-camino-de-una-escritura');
  });

  it('conserva los acentos y la eñe, que son letras', () => {
    assert.equal(headingAnchor('Registro canónico'), 'registro-canónico');
    assert.equal(headingAnchor('El año que viene'), 'el-año-que-viene');
  });

  it('se lleva la puntuación y conserva el número', () => {
    assert.equal(headingAnchor('3. Casos de uso, por actor'), '3-casos-de-uso-por-actor');
    assert.equal(
      headingAnchor('6. Procedencia: quién, por dónde y con qué prueba'),
      '6-procedencia-quién-por-dónde-y-con-qué-prueba',
    );
  });

  it('y el guion se queda, porque ya era un guion', () => {
    assert.equal(headingAnchor('Local-first'), 'local-first');
  });

  it('dos encabezados iguales no llevan al mismo sitio', () => {
    // El segundo «Notas» de un documento no puede llevar al primero.
    assert.deepEqual(uniqueAnchors(['Notas', 'Otra cosa', 'Notas', 'Notas']), [
      'notas',
      'otra-cosa',
      'notas-1',
      'notas-2',
    ]);
  });
});

describe('un enlace a un ancla', () => {
  it('no viaja como dirección, porque no lo es', () => {
    /*
     * En Vera el fragmento de la dirección ya significa un bloque, así que
     * emitirlo tal cual no sólo no llevaba a ninguna parte: el enrutador lo leía
     * como una llegada, volvía a pedir la página y dejaba un paso en el rastro.
     * Un índice de treinta entradas dejaba treinta veces la misma página.
     */
    assert.equal(
      inlineMarkdown('[El camino](#13-el-camino-de-una-escritura)'),
      '<a class="anchor" data-anchor="13-el-camino-de-una-escritura" href="#">El camino</a>',
    );
  });

  it('y un enlace de fuera sigue siendo un enlace de fuera', () => {
    assert.match(inlineMarkdown('[ver](https://example.org)'), /href="https:\/\/example.org"/);
  });
});
