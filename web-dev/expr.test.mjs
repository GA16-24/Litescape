// node web-dev/expr.test.mjs — checks the custom-uniform expression language against real pack lines.
import assert from 'node:assert';
import { compile, customUniforms, evaluate } from '../src/client/resources/web/expr.js';

const s = { sunAngle: 0.3, cameraPosition: [1, 120, 3], biome: 1, frameCounter: 13, worldTime: 1000 };
const ev = (src) => compile(src)(s, 0.016);
assert.equal(ev('frac(sunAngle - 0.033333333)').toFixed(4), '0.2667');
assert.equal(ev('if(cameraPosition.y >= 113.0, 1, 0)'), 1);
assert.equal(ev('if(1 < 0, 5, 0 > 1, 6, 7)'), 7);
assert.equal(ev('smooth(1, if(in(biome, BIOME_GROVE, BIOME_DESERT), 1, 0), 10, 10)'), 0);
assert.equal(ev('frameCounter % 8'), 5);
assert.equal(ev('clamp(1.0 - (abs(abs(sunAngle - 0.5) - 0.25) - 0.23) * 100.0, 0.0, 1.0)'), 1);
assert.equal(ev('-cameraPosition.y * 2'), -240);
assert.equal(ev('!(worldTime > 500) || 1 == 1 && 2 != 3'), 1);
assert.deepEqual(ev('vec3(1, 2, 3) * 2'), [2, 4, 6]);
assert.equal(ev('1 > 0 ? 3 : 4'), 3);
// Matrix elements are column.row (Bliss, Photon).
s.m = Float32Array.from({ length: 16 }, (_, k) => k);
assert.equal(ev('m.1.2'), 6);
assert.equal(ev('m.3.0 * 2.'), 24);

// smooth() eases toward a new target instead of jumping.
const sm = compile('smooth(x, 1, 1)');
const sc = { x: 0 };
sm(sc, 0.016);
sc.x = 1;
const mid = sm(sc, 0.5);
assert.ok(mid > 0.3 && mid < 0.5, String(mid));

// BSL's time-of-day chain: variables feed later uniforms; a broken line is reported, not fatal.
const props = {
  'variable.float.tAmin': 'frac(sunAngle - 0.033333333)',
  'variable.float.tAlin': 'if(tAmin < 0.433333333, tAmin * 1.15384615385, tAmin * 0.882352941176 + 0.117647058824)',
  'uniform.float.timeBrightness': 'max(sin(tAlin * 6.28318530718), 0.0)',
  'uniform.int.fm': 'frameCounter % 2',
  'uniform.float.bad': 'foo(',
};
const cu = customUniforms(props);
assert.equal(cu.errors.length, 1);
evaluate(cu.list, s, 0.016);
assert.ok(s.timeBrightness > 0.9 && s.fm === 1);
console.log('expr ok');
