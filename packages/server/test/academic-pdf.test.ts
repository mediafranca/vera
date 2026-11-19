import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { teiToMarkdown } from '../src/academic-pdf.ts';

describe('TEI académico', () => {
  it('conserva título, secciones, párrafos y bibliografía sin mobiliario de página', () => {
    const converted = teiToMarkdown(`<?xml version="1.0"?>
      <TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>Diseñar memorias</title></titleStmt></fileDesc></teiHeader>
      <text><front><abstract><p>Resumen limpio.</p></abstract></front><body><div><head>Método</head><p>Primer párrafo.</p></div></body>
      <back><listBibl><biblStruct><analytic><title>Referencia uno</title></analytic></biblStruct></listBibl></back></text></TEI>`);
    assert.notEqual(converted, null);
    assert.equal(converted?.title, 'Diseñar memorias');
    assert.match(converted?.markdown ?? '', /## Resumen/);
    assert.match(converted?.markdown ?? '', /## Método/);
    assert.match(converted?.markdown ?? '', /## Referencias/);
  });
});
