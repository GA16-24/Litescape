// Every locale translates every string the page shows, and keeps each string's {placeholders} and HTML tags.
// Run `node web-dev/i18n.test.mjs --keys` to print the English keys, e.g. to start a new locale.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const WEB = new URL('../src/client/resources/web/', import.meta.url);
const read = (f) => readFileSync(new URL(f, WEB), 'utf8');

/** String literals in the first argument of each t(…) call, skipping those compared against (=== 'light'). */
export function sourceKeys(src) {
  const keys = new Set();
  for (const m of src.matchAll(/(?<![\w$.])t\(/g)) {
    let depth = 0;
    for (let i = m.index + 2; i < src.length; i++) {
      const c = src[i];
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (src[j] !== c) j += src[j] === '\\' ? 2 : 1;
        const compared = /[=!]==\s*$/.test(src.slice(0, i)) || /^\s*[=!]==/.test(src.slice(j + 1));
        if (!compared) keys.add(src.slice(i + 1, j).replace(/\\(.)/g, '$1'));
        i = j;
      } else if (c === '`')
        break; // none are keys; their ${} would confuse the scan
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (!depth--) break;
      } else if (c === ',' && !depth) break;
    }
  }
  return keys;
}

/** Text and labels in index.html, which i18n.js translates on load. */
function htmlKeys(html) {
  const keys = new Set();
  const body = html.slice(html.indexOf('<body'));
  for (const [, s] of body.matchAll(/>([^<>]+)</g)) if (/[a-z]{2}/.test(s)) keys.add(s.trim());
  for (const [, s] of body.matchAll(/\s(?:placeholder|aria-label|data-tip|title)="([^"]+)"/g)) keys.add(s);
  return keys;
}

// Fixed messages the mod's web server and the server mod send back; api() translates them.
const SERVER = [
  'No area selection',
  'The selection has no complete boxes yet',
  'That placement no longer exists',
  'Modrinth has no Iris build of this pack',
  "This zip has no shaders folder, so it isn't a shader pack",
  'Shader pack is too large',
  'Download is too large',
  'No surroundings were captured for this schematic',
  'Selection has no complete boxes',
  'Schematic is too large to share',
  "This server no longer lets you capture surroundings, so they can't follow the move. Remove them in the Surroundings panel first.",
  "This server doesn't let you capture surroundings",
  'That schematic is no longer shared',
  'The server does not run Litescape',
  'Unknown shader pack',
  'Disconnected',
  'This schematic was shared without its Litematica placement. Ask its owner to update the copy.',
  'The placement is locked in Litematica. Unlock it to move it.',
  "Couldn't save the schematic",
  "Couldn't read the shared placement",
];

const KEYS = new Set([...sourceKeys(read('app.js')), ...htmlKeys(read('index.html')), ...SERVER]);
for (const k of ['Litescape', 'Enter', 'Esc']) KEYS.delete(k); // names, and keys on the keyboard

const shape = (s) =>
  JSON.stringify([
    [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
    [...s.matchAll(/<\/?(\w+)/g)].map((m) => m[0]).sort(),
  ]);

if (process.argv.includes('--keys')) console.log(JSON.stringify([...KEYS], null, 2));

test('finds the strings to translate', () => {
  assert.ok(KEYS.size > 200, `only ${KEYS.size} keys`);
  for (const k of ['Build progress', 'Language: {name}', 'Search servers…', 'Sunrise', 'Show problems only'])
    assert.ok(KEYS.has(k), k);
  for (const k of ['light', 'server', '']) assert.ok(!KEYS.has(k), `"${k}" is not UI text`);
});

const i18n = read('i18n.js');
for (const file of readdirSync(new URL('locales/', WEB))) {
  test(`${file} translates every string, keeping placeholders and tags`, async () => {
    const code = file.replace(/\.js$/, '');
    assert.ok(i18n.includes(`'${code}'`) || i18n.includes(`${code}:`), `${code} is missing from LANGS in i18n.js`);
    const dict = (await import(new URL(`locales/${file}`, WEB))).default;
    const missing = [...KEYS].filter((k) => !(k in dict));
    assert.deepEqual(missing, [], 'untranslated');
    const unused = Object.keys(dict).filter((k) => !KEYS.has(k));
    assert.deepEqual(unused, [], 'no longer in the page');
    const rules = new Intl.PluralRules(code);
    for (const [k, v] of Object.entries(dict)) {
      const forms = typeof v === 'string' ? { other: v } : v;
      assert.ok(forms.other, `${k}: needs an "other" form`);
      for (const [cat, s] of Object.entries(forms)) {
        assert.ok(rules.resolvedOptions().pluralCategories.includes(cat), `${k}: ${code} has no "${cat}" form`);
        // "one" can drop {n} ("un bloc"), so only require the placeholders the key itself names
        const want = cat === 'other' || !k.includes('{n}') ? shape(k) : shape(k.replace('{n}', ''));
        const got = cat === 'other' ? shape(s) : shape(s.replace('{n}', ''));
        assert.equal(got, want, `${k} → ${s}`);
      }
    }
  });
}
