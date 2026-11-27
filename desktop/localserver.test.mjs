// Run with: node --test desktop/localserver.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { acceptEula, eulaAccepted, findJava, LocalServer, setupServer } from './localserver.js';

// The fake Java is a shell script
const skip = process.platform === 'win32';

/** A `java` that reports `major` and, when run, acts like a server that stops on "stop". */
function fakeJava(dir, major) {
  const bin = path.join(dir, 'bin', 'java');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(
    bin,
    `#!/bin/sh
if [ "$1" = -version ]; then echo 'openjdk version "${major}.0.1" 2025-10-21' >&2; exit 0; fi
echo "args $*"
echo '[Server thread/INFO]: Done (1.234s)! For help, type "help"'
while read line; do
  echo "got $line"
  [ "$line" = "litweb-farm run" ] && echo '[Server thread/INFO]: LITWEB-FARM {"id":"f1","state":"running","ticks":40}'
  [ "$line" = stop ] && exit 0
done
`,
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

function mockDownloads(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    const json = (body) => new Response(JSON.stringify(body));
    if (url.endsWith('/server/jar')) return new Response('launcher');
    if (url.includes('/versions/loader/'))
      return json([
        { loader: { version: '0.21.0-beta', stable: false } },
        { loader: { version: '0.20.1', stable: true } },
      ]);
    if (url.endsWith('/versions/installer')) return json([{ version: '1.1.2', stable: true }]);
    if (url.startsWith('https://api.modrinth.com/')) {
      const sha512 = crypto.createHash('sha512').update('fapi').digest('hex');
      const file = {
        primary: true,
        url: 'https://cdn.modrinth.com/fapi.jar',
        filename: 'fabric-api.jar',
        hashes: { sha512 },
      };
      return json([{ files: [file] }]);
    }
    if (url === 'https://cdn.modrinth.com/fapi.jar') return new Response('fapi');
    return new Response('', { status: 404 });
  });
  return calls;
}

test('findJava picks the newest Java that is new enough', { skip }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'litescape-java-'));
  fakeJava(path.join(tmp, 'runtime', 'java-runtime-gamma', 'jre'), 21);
  const want = fakeJava(path.join(tmp, 'runtime', 'java-runtime-epsilon', 'jre'), 25);
  assert.deepEqual(await findJava([path.join(tmp, 'runtime'), path.join(tmp, 'missing')], 25), {
    bin: want,
    major: 25,
  });
  assert.equal((await findJava([path.join(tmp, 'runtime', 'java-runtime-gamma')], 99))?.bin, undefined);
});

test('sets up the server, runs commands and stops', { skip }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'litescape-server-'));
  const dir = path.join(tmp, 'server');
  const modJar = path.join(tmp, 'litescape-0.3.0.jar');
  fs.writeFileSync(modJar, 'mod');
  const mod = { file: modJar, version: '0.3.0', mc: '~26.3' };
  const calls = mockDownloads(t);
  // An old version's launcher goes when Minecraft changes
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fabric-server-26.2.jar'), 'old');

  assert.equal(eulaAccepted(dir), false);
  acceptEula(dir);
  assert.equal(eulaAccepted(dir), true);
  const jar = await setupServer(dir, mod);
  assert.equal(path.basename(jar), 'fabric-server-26.3.jar');
  assert.ok(calls.includes('https://meta.fabricmc.net/v2/versions/loader/26.3/0.20.1/1.1.2/server/jar'));
  assert.ok(!fs.existsSync(path.join(dir, 'fabric-server-26.2.jar')));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')).sort(), ['fabric-api.jar', 'litescape-0.3.0.jar']);
  assert.ok(!calls.some((u) => /malilib|litematica/.test(u)), 'client-only mods stay off the server');
  const props = fs.readFileSync(path.join(dir, 'server.properties'), 'utf8');
  assert.match(props, /^server-ip=127\.0\.0\.1$/m);
  assert.match(props, /^level-type=minecraft\\:flat$/m, 'an empty world, so tests count only the farm');
  assert.match(props, /^pause-when-empty-seconds=0$/m, 'keeps ticking with nobody online');
  // The launcher isn't fetched again; the player's own settings stay, apart from the two the app needs
  fs.writeFileSync(path.join(dir, 'server.properties'), 'motd=mine\nserver-ip=0.0.0.0\n');
  calls.length = 0;
  await setupServer(dir, mod);
  assert.ok(!calls.some((u) => u.endsWith('/server/jar')));
  assert.equal(
    fs.readFileSync(path.join(dir, 'server.properties'), 'utf8'),
    'motd=mine\nserver-ip=127.0.0.1\npause-when-empty-seconds=0\n',
  );

  const states = [];
  const farms = [];
  const server = new LocalServer((m) => (m.state && states.push(m.state)) || (m.farm && farms.push(m.farm)));
  const running = new Promise((resolve) => {
    const tick = setInterval(() => server.state === 'running' && resolve(clearInterval(tick)), 10);
  });
  await server.start(dir, mod, fakeJava(tmp, 25));
  await running;
  await server.whenRunning();
  assert.ok(server.log.includes('args -Xmx2G -Dlitweb.farmServer=true -jar fabric-server-26.3.jar nogui'));
  server.send('litweb-farm run');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(farms, [{ id: 'f1', state: 'running', ticks: 40 }]);
  assert.ok(!server.log.some((l) => l.includes('LITWEB-FARM')), 'reports stay out of the log');
  server.send('/time set day\nstop');
  await server.stop();
  assert.ok(server.log.includes('got time set day stop'), 'a command stays on one line');
  assert.deepEqual(states, ['installing', 'starting', 'running', 'stopping', 'stopped']);
  assert.equal(server.running, false);
  await assert.rejects(server.whenRunning(), /stopped/);
});
