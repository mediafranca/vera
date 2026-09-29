import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  looksLikeProcess,
  processPresentation,
  readProcessBlock,
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

  it('distingue las definiciones remotas de PICTOS del experimento local', () => {
    assert.deepEqual(processPresentation('pictos.net/comprender'), {
      family: 'PICTOS.net', name: 'Comprender', inputKind: 'Texto',
      outputKind: 'NLU nativa JSON', executor: 'pictos.net',
    });
    assert.equal(processPresentation('pictos.net/componer').outputKind, 'Composición nativa JSON');
  });
});
