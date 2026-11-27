import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { absoluteLinks } from './modrinth.mjs';

test('relative links point at GitHub, images at raw, anchors and absolute URLs stay', () => {
  const md = [
    '<a href="LICENSE"><img src="https://img.shields.io/x"></a>',
    '<source srcset="docs/images/viewer-dark.png"><img src="./docs/images/viewer-light.png">',
    'See [CONTRIBUTING.md](CONTRIBUTING.md), [settings](#server-settings) and [Modrinth](https://modrinth.com/mod/litescape).',
  ].join('\n');
  assert.equal(
    absoluteLinks(md),
    [
      '<a href="https://github.com/GA16-24/Litescape/blob/main/LICENSE"><img src="https://img.shields.io/x"></a>',
      '<source srcset="https://raw.githubusercontent.com/GA16-24/Litescape/main/docs/images/viewer-dark.png"><img src="https://raw.githubusercontent.com/GA16-24/Litescape/main/docs/images/viewer-light.png">',
      'See [CONTRIBUTING.md](https://github.com/GA16-24/Litescape/blob/main/CONTRIBUTING.md), [settings](#server-settings) and [Modrinth](https://modrinth.com/mod/litescape).',
    ].join('\n'),
  );
});

test('the README has no relative link left once converted', () => {
  const out = absoluteLinks(readFileSync(new URL('../README.md', import.meta.url), 'utf8'));
  assert.doesNotMatch(out, /(\]\(|(?:href|src|srcset)=")(?!https?:|#|mailto:)/);
});
