// Pruebas del lector de documentos. Ver specs/document-import.allium.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { parseDocument, parseDocx, parseMarkdownDocument } from '../src/document.ts';

describe('parseMarkdownDocument', () => {
  it('toma el primer encabezado de primer nivel como título y no como bloque', () => {
    const parsed = parseMarkdownDocument('# Amereida\n\nUn párrafo.\n');
    assert.equal(parsed.title, 'Amereida');
    assert.deepEqual(parsed.pieces, [{ depth: 0, content: 'Un párrafo.' }]);
  });

  it('anida por nivel de encabezado', () => {
    const parsed = parseMarkdownDocument(
      '# T\n\n## Uno\n\ntexto de uno\n\n### Uno uno\n\ntexto hondo\n\n## Dos\n\ntexto de dos\n',
    );
    assert.deepEqual(parsed.pieces, [
      { depth: 0, content: '## Uno' },
      { depth: 1, content: 'texto de uno' },
      { depth: 1, content: '### Uno uno' },
      { depth: 2, content: 'texto hondo' },
      { depth: 0, content: '## Dos' },
      { depth: 1, content: 'texto de dos' },
    ]);
  });

  it('un salto de nivel no inventa un escalón vacío', () => {
    // @invariant DepthComesFromDeclaredMarks: de `#` a `###` hay un hijo, no dos.
    // Contar la profundidad como `nivel - 1` dejaría el árbol torcido desde ahí.
    const parsed = parseMarkdownDocument('# T\n\n# Uno\n\n### Hondo\n');
    assert.deepEqual(parsed.pieces, [
      { depth: 0, content: '# Uno' },
      { depth: 1, content: '### Hondo' },
    ]);
  });

  it('anida las viñetas bajo el encabezado que las contiene', () => {
    const parsed = parseMarkdownDocument('# T\n\n## Lista\n\n- uno\n  - uno hondo\n- dos\n');
    assert.deepEqual(parsed.pieces, [
      { depth: 0, content: '## Lista' },
      { depth: 1, content: 'uno' },
      { depth: 2, content: 'uno hondo' },
      { depth: 1, content: 'dos' },
    ]);
  });

  it('el cercado de código llega entero, con sus líneas en blanco', () => {
    // Partirlo por párrafos lo rompería en trozos que ya no compilan.
    const parsed = parseMarkdownDocument('# T\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n');
    assert.equal(parsed.pieces.length, 1);
    assert.equal(parsed.pieces[0]?.content, '```js\nconst a = 1;\n\nconst b = 2;\n```');
  });

  it('junta las líneas de un párrafo y las separa en la línea en blanco', () => {
    const parsed = parseMarkdownDocument('uno\nsigue\n\ndos\n');
    assert.deepEqual(parsed.pieces, [
      { depth: 0, content: 'uno\nsigue' },
      { depth: 0, content: 'dos' },
    ]);
  });

  it('un documento sin encabezados entra plano, que es lo que era', () => {
    const parsed = parseMarkdownDocument('uno\n\ndos\n\ntres\n');
    assert.equal(parsed.title, null);
    assert.deepEqual(
      parsed.pieces.map((p) => p.depth),
      [0, 0, 0],
    );
  });

  it('conserva el orden de lectura', () => {
    // @invariant OrderIsPreserved
    const parsed = parseMarkdownDocument('# T\n\nprimero\n\n## H\n\nsegundo\n');
    assert.deepEqual(
      parsed.pieces.map((p) => p.content),
      ['primero', '## H', 'segundo'],
    );
  });
});

/** Un .docx mínimo pero real: un zip con `word/document.xml` dentro. */
function docx(bodyXml: string): Buffer {
  const name = Buffer.from('word/document.xml', 'utf8');
  const xml = Buffer.from(
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${bodyXml}</w:body></w:document>`,
    'utf8',
  );
  const packed = deflateRawSync(xml);
  const crc = 0; // No se comprueba al leer: lo que hace falta es el tamaño.

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(xml.length, 22);
  local.writeUInt16LE(name.length, 26);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(xml.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(0, 42);

  const directoryAt = local.length + name.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(entry.length + name.length, 12);
  end.writeUInt32LE(directoryAt, 16);

  return Buffer.concat([local, name, packed, entry, name, end]);
}

/** Un PDF mínimo, con texto seleccionable y metadatos de título. */
function pdf(text: string, title: string): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    `<< /Title (${title.replace(/([\\()])/g, '\\$1')}) >>`,
  ];
  const parts = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  let at = parts[0]!.byteLength;
  objects.forEach((object, index) => {
    offsets.push(at);
    const encoded = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'ascii');
    parts.push(encoded);
    at += encoded.byteLength;
  });
  const xref = at;
  const rows = offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  parts.push(Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    'ascii',
  ));
  return Buffer.concat(parts);
}

const p = (style: string | null, text: string, ilvl: number | null = null): string =>
  `<w:p>${style === null ? '' : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`}` +
  `${ilvl === null ? '' : `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/></w:numPr></w:pPr>`}` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('parseDocx', () => {
  it('abre el zip y lee el título y los párrafos', () => {
    const parsed = parseDocx(docx(p('Heading1', 'La tesis') + p(null, 'Primer párrafo.')));
    assert.notEqual(parsed, null);
    assert.equal(parsed?.title, 'La tesis');
    assert.deepEqual(parsed?.pieces, [{ depth: 0, content: 'Primer párrafo.' }]);
  });

  it('reconoce los estilos de encabezado en español', () => {
    // Word escribe el identificador del estilo en el idioma de su instalación.
    const parsed = parseDocx(docx(p('Ttulo1', 'Título') + p('Ttulo2', 'Sección')));
    assert.equal(parsed?.title, 'Título');
    assert.deepEqual(parsed?.pieces, [{ depth: 0, content: '## Sección' }]);
  });

  it('anida las listas por su nivel declarado', () => {
    const parsed = parseDocx(
      docx(p('Heading1', 'T') + p('Heading2', 'Lista') + p(null, 'uno', 0) + p(null, 'hondo', 1)),
    );
    assert.deepEqual(parsed?.pieces, [
      { depth: 0, content: '## Lista' },
      { depth: 1, content: 'uno' },
      { depth: 2, content: 'hondo' },
    ]);
  });

  it('cuenta lo que no supo traer en vez de callarlo', () => {
    // @invariant NothingIsDroppedSilently
    const parsed = parseDocx(docx(p('Heading1', 'T') + '<w:tbl><w:tr></w:tr></w:tbl>' + p(null, 'x')));
    assert.equal(parsed?.losses.length, 1);
    assert.match(parsed?.losses[0] ?? '', /tabla/);
  });

  it('devuelve null si no es un docx legible', () => {
    assert.equal(parseDocx(Buffer.from('esto no es un zip')), null);
  });
});

describe('parseDocument', () => {
  it('elige el lector por la extensión', async () => {
    const md = await parseDocument(Buffer.from('# Hola\n\nqué tal\n'), 'notas.md', 'text/markdown');
    assert.equal('error' in md ? null : md.format, 'markdown');
  });

  it('reconoce un docx aunque el tipo declarado no lo diga', async () => {
    const out = await parseDocument(docx(p('Heading1', 'T') + p(null, 'x')), 'sin-tipo', '');
    assert.equal('error' in out ? null : out.format, 'docx');
  });

  it('se niega entero ante un PDF ilegible', async () => {
    // @invariant NoPageSurvivesARefusal: negarse es no crear nada, y para eso
    // hay que negarse antes de escribir, no a mitad.
    const out = await parseDocument(Buffer.from('%PDF-1.4'), 'tesis.pdf', 'application/pdf');
    assert.ok('error' in out);
  });

  it('extrae el texto y el título de un PDF real', async () => {
    const out = await parseDocument(pdf('Texto seleccionable', 'Acta de prueba'), 'acta.pdf', 'application/pdf');
    assert.ok(!('error' in out), 'error' in out ? out.error : '');
    if (!('error' in out)) {
      assert.equal(out.format, 'pdf');
      assert.equal(out.title, 'Acta de prueba');
      assert.match(out.pieces.map((piece) => piece.content).join(' '), /Texto seleccionable/);
    }
  });

  it('lee texto RTF y declara las imágenes que no pudo traer', async () => {
    const out = await parseDocument(
      Buffer.from('{\\rtf1\\ansi Primer párrafo\\par Segundo \\u225?\\par {\\pict 00ff}}', 'latin1'),
      'nota.rtf',
      'application/rtf',
    );
    assert.ok(!('error' in out));
    if (!('error' in out)) {
      assert.equal(out.format, 'rtf');
      assert.match(out.pieces.map((piece) => piece.content).join(' '), /Primer párrafo/);
      assert.match(out.pieces.map((piece) => piece.content).join(' '), /á/);
      assert.match(out.losses.join(' '), /imagen/);
    }
  });

  it('un archivo sin texto no llega a ser una página', async () => {
    // @invariant AnEmptyDocumentIsNotAPage
    const out = await parseDocument(Buffer.from('\n\n   \n'), 'vacio.md', 'text/markdown');
    assert.ok('error' in out);
  });
});
