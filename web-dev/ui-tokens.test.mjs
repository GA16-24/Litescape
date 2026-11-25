// Keeps style.css on the design system (T3 Code's): colors come from the tokens at the top,
// and font sizes and corner radii come from a short scale. Off-scale values like 11.5px text
// or a 7px radius are how a UI drifts into looking "almost right".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const FONT_SIZES = [11, 12, 13, 14, 22, 30];
const RADII = [2, 4, 6, 8, 12, 16]; // 2px only for thin bars and swatches

const css = readFileSync(new URL('../src/client/resources/web/style.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
  // the theme blocks define the tokens, so raw colors are expected there
  .replace(/:root[^{]*\{[^}]*\}/g, (b) => b.replace(/[^\n]/g, ' '));
const lines = css.split('\n');

function offenders(re, ok) {
  const out = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(re)) if (!ok(m)) out.push(`style.css:${i + 1}: ${line.trim()}`);
  });
  return out;
}

test('colors come from tokens, apart from plain white and black', () => {
  const neutral = /^(#fff|#ffffff|#000|#000000|rgba?\((0, 0, 0|255, 255, 255)(, [\d.]+)?\))$/i;
  assert.deepEqual(
    offenders(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi, (m) => neutral.test(m[0])),
    [],
    'use a var(--token) from the top of style.css',
  );
});

test('font sizes are on the scale', () => {
  const re = /font-size:\s*([\d.]+)px|font:\s*(?:\d{3}\s+)?([\d.]+)px/g;
  assert.deepEqual(
    offenders(re, (m) => FONT_SIZES.includes(+(m[1] ?? m[2]))),
    [],
    `font sizes: ${FONT_SIZES.join(', ')}px`,
  );
});

test('corner radii are on the scale', () => {
  const re = /border-radius:([^;}]+)/g;
  const ok = (m) =>
    m[1]
      .trim()
      .split(/\s+/)
      .every((v) => v === '0' || v === '50%' || v === 'inherit' || RADII.includes(Number.parseFloat(v)));
  assert.deepEqual(offenders(re, ok), [], `radii: ${RADII.join(', ')}px or 50%`);
});
