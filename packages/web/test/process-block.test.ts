import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  looksLikeProcess,
  processPresentation,
  readProcessBlock,
  writeHttpProcessBlock,
  writeProcessBlock,
} from '../src/process-block.ts';

describe('/proceso', () => {
  it('conserva definición, versión y entrada referida en su fuente portable', () => {
    const source = writeProcessBlock('block:entrada');
    assert.deepEqual(readProcessBlock(source), {
      definition: 'vera/estructura-textual', version: 1, input: 'block:entrada',
    });
    assert.equal(looksLikeProcess(source), true);
  });

  it('no confunde un fence incompleto con un proceso ejecutable', () => {
    assert.equal(readProcessBlock('```proceso\ndefinición: vera/estructura-textual\n```'), null);
    assert.equal(looksLikeProcess('texto corriente'), false);
  });

  it('puede invocar una definición generativa sin guardar su programa en la página', () => {
    assert.deepEqual(readProcessBlock(writeProcessBlock('block:frase', 'pictos/frase-visual')), {
      definition: 'pictos/frase-visual', version: 1, input: 'block:frase',
    });
  });

  it('nombra cada transformación PICTOS como un proceso independiente', () => {
    assert.deepEqual(processPresentation('pictos/comprender'), {
      family: 'PICTOS', name: 'Comprender', inputKind: 'Texto',
      outputKind: 'JSON semántico', executor: 'participant:local-model',
    });
    assert.equal(processPresentation('pictos/componer').outputKind, 'Árbol visual JSON');
    assert.equal(processPresentation('pictos/producir').outputKind, 'SVG autocontenido');
  });

  it('guarda el proceso HTTP completo dentro de la fuente editable', () => {
    const source = writeHttpProcessBlock('block:nlu', {
      definition: 'pictos.net/componer', version: 1,
      presentation: {
        family: 'PICTOS.net', name: 'Componer', inputKind: 'NLU nativa JSON',
        outputKind: 'Composición nativa JSON', executor: 'pictos.net',
      },
      request: {
        kind: 'json-http', connection: 'pictos-next', path: '/api/v1/componer', method: 'POST',
        body: { nlu: '$entrada.json', config: { domainContext: 'hogar' } },
      },
      response: {
        content: '$.output', executor: '$.executor', requestId: '$.request_id',
        processVersion: '$.process.version', schemaId: '$.schema.id',
        schemaVersion: '$.schema.version', model: '$.model.actual',
      },
    });
    const parsed = readProcessBlock(source);
    assert.equal(parsed?.presentation?.name, 'Componer');
    assert.equal(parsed?.request?.path, '/api/v1/componer');
    assert.deepEqual(parsed?.request?.body, {
      nlu: '$entrada.json', config: { domainContext: 'hogar' },
    });
    assert.equal(parsed?.response?.requestId, '$.request_id');
  });
});
