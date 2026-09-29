import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  composePictos, pictosPrompt, pictosSvg, readPictosPlan, validatePictosPlan,
} from '../src/pictos-process.ts';

describe('proceso generativo PICTOS', () => {
  const plan = {
    title: 'Hacer la cama',
    speechAct: 'directive' as const,
    elements: [
      { role: 'agent' as const, label: 'persona', symbol: 'person' as const },
      { role: 'action' as const, label: 'hacer', symbol: 'hand' as const },
      { role: 'patient' as const, label: 'cama', symbol: 'bed' as const },
    ],
    composition: 'La persona actúa sobre la cama.',
    description: 'Una persona hace una cama.',
  };

  it('lee sólo planes acotados al vocabulario visual gobernado', () => {
    assert.deepEqual(readPictosPlan(`respuesta\n${JSON.stringify(plan)}`), plan);
    assert.equal(readPictosPlan(JSON.stringify({ ...plan, elements: [
      { role: 'agent', label: 'persona', symbol: '<script>' },
      { role: 'patient', label: 'cama', symbol: 'bed' },
    ] })), null);
  });

  it('compone el SVG en Vera y conserva roles y accesibilidad', () => {
    const svg = pictosSvg(plan);
    assert.match(svg, /^<svg[^>]+role="img"/);
    assert.match(svg, /<title id="title">Hacer la cama<\/title>/);
    assert.match(svg, /data-role="agent"/);
    assert.match(svg, /data-role="patient"/);
    assert.match(svg, /svg\{color:#181715\}/);
    assert.match(svg, /prefers-color-scheme:dark/);
    assert.match(svg, /svg\{color:#f3efe6\}/);
    assert.doesNotMatch(svg, /<script|onload=/);
  });

  it('recompone un ajuste humano mediante el mismo contrato seguro', () => {
    const adjusted = { ...plan, title: 'Tender la cama', elements: plan.elements.map((element) => ({ ...element })) };
    assert.deepEqual(validatePictosPlan(adjusted), adjusted);
    assert.match(composePictos(adjusted).content, /Tender la cama/);
    assert.equal(validatePictosPlan({ ...adjusted, elements: [{ role: 'action', symbol: 'javascript', label: 'hacer' }] }), null);
  });

  it('pide una sola lectura y enumera los símbolos permitidos', () => {
    const prompt = pictosPrompt('Haz la cama');
    assert.match(prompt, /elige una lectura visual clara, no expliques alternativas/);
    assert.match(prompt, /person, hand, bed/);
  });
});
