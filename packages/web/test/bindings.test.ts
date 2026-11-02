import assert from 'node:assert/strict';
import test from 'node:test';

import { is, isTextComposing } from '../src/bindings.ts';

test('recognises the active composition reported by the browser', () => {
  assert.equal(isTextComposing({ isComposing: true, key: 'a', keyCode: 65 }), true);
});

test('recognises macOS dead keys before the composed character exists', () => {
  assert.equal(isTextComposing({ isComposing: false, key: 'Dead', keyCode: 0 }), true);
});

test('recognises Safari legacy IME key events', () => {
  assert.equal(isTextComposing({ isComposing: false, key: 'Unidentified', keyCode: 229 }), true);
});

test('ordinary typing is not composition', () => {
  assert.equal(isTextComposing({ isComposing: false, key: 'e', keyCode: 69 }), false);
});

test('Cmd/Ctrl-F belongs to finding inside the current page', () => {
  const event = (key: string, metaKey: boolean, ctrlKey: boolean): KeyboardEvent => ({
    key, metaKey, ctrlKey, altKey: false, shiftKey: false,
    isComposing: false, keyCode: key.charCodeAt(0),
  }) as KeyboardEvent;
  assert.equal(is('find-page', event('f', true, false)), true);
  assert.equal(is('find-page', event('F', false, true)), true);
  assert.equal(is('find-page', event('f', false, false)), false);
});
