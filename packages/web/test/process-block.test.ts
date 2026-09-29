import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { looksLikeProcess, readProcessBlock, writeProcessBlock } from '../src/process-block.ts';

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
});
