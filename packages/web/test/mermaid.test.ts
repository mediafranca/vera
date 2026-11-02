import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mermaidTheme } from '../src/mermaid.ts';
import { readFileSync } from 'node:fs';

const mermaidSource = readFileSync(new URL('../src/mermaid.ts', import.meta.url), 'utf8');
const outlinerSource = readFileSync(new URL('../src/outliner.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('mermaidTheme', () => {
  it('proyecta la paleta efectiva de Vera sin conservar otra paleta escondida', () => {
    const palette = {
      bg: '#101010', bgRaised: '#202020', text: '#f0f0f0',
      textDim: '#c0c0c0', accent: '#ff8800', rule: '#808080',
    };
    const { themeVariables: colors } = mermaidTheme(true, palette);
    assert.equal(colors.background, palette.bg);
    assert.equal(colors.primaryTextColor, palette.text);
    assert.equal(colors.secondaryColor, palette.bgRaised);
    assert.equal(colors.lineColor, palette.rule);
    assert.equal(colors.tertiaryBorderColor, palette.accent);
    assert.equal(colors.loopTextColor, palette.textDim);
    assert.doesNotMatch(mermaidSource, /#f4f1eb|#171513|#9fc7ff|#245b9e/);
  });

  for (const dark of [false, true]) {
    it(`declara colores legibles para todos los textos en modo ${dark ? 'oscuro' : 'claro'}`, () => {
      const { theme, themeVariables: colors } = mermaidTheme(dark);

      assert.equal(theme, 'base');
      assert.equal(colors.primaryTextColor, colors.textColor);
      assert.equal(colors.secondaryTextColor, colors.textColor);
      assert.equal(colors.tertiaryTextColor, colors.textColor);
      assert.equal(colors.labelTextColor, colors.textColor);
      assert.equal(colors.actorTextColor, colors.textColor);
      assert.equal(colors.signalTextColor, colors.textColor);
      assert.equal(colors.noteTextColor, colors.textColor);
      assert.notEqual(colors.textColor, colors.primaryColor);
      assert.notEqual(colors.textColor, colors.secondaryColor);
      assert.notEqual(colors.textColor, colors.tertiaryColor);
    });
  }
});

describe('hidratación progresiva de Mermaid', () => {
  it('prioriza el viewport, marca trabajo local y conserva el scroll', () => {
    assert.match(mermaidSource, /new IntersectionObserver/);
    assert.match(mermaidSource, /rootMargin: '700px 0px'/);
    assert.match(mermaidSource, /classList\.add\('rich-pending'\)/);
    assert.match(mermaidSource, /scroller\.scrollTop \+=/);
    assert.match(outlinerSource, /renderMermaidProgressively\(list\)/);
    assert.doesNotMatch(outlinerSource, /Componiendo diagramas/);
    assert.match(styles, /\.block:is\(\.rich-pending, \.rich-native-pending\) > \.body/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
    assert.match(outlinerSource, /iframe\[loading="lazy"\], img\[loading="lazy"\]/);
    assert.match(outlinerSource, /markNativeRichPending\(row, text\)/);
  });
});
