// A Fabric server on this computer with Litescape and Fabric API, for testing builds and farms.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { get, install, installDeps, jars, mcBase } from './instances.js';

const JAVA = process.platform === 'win32' ? 'java.exe' : 'java';
/** The system property that turns on the mod's farm test (Farm.java), which overwrites the world where a test goes. */
const FARM_SERVER = 'litweb.farmServer';

/** Folders where launchers keep the Java they download for Minecraft, from defaultRoots(). */
export function javaDirs(roots, env = process.env) {
  return [
    env.JAVA_HOME,
    ...roots.vanilla.map((r) => path.join(r, 'runtime')),
    // The Microsoft Store launcher keeps its runtimes here instead
    env.LOCALAPPDATA &&
      path.join(
        env.LOCALAPPDATA,
        'Packages',
        'Microsoft.4297127D64EC6_8wekyb3d8bbwe',
        'LocalCache',
        'Local',
        'runtime',
      ),
    ...roots.prism.map((r) => path.join(r, 'java')),
    ...roots.modrinth.map((r) => path.join(r, 'meta', 'java_versions')),
    ...roots.curseforge.map((r) => path.join(r, '..', 'Install', 'runtime')),
  ].filter(Boolean);
}

function javaVersion(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 10000 }, (err, stdout, stderr) => {
      const m = /version "(?:1\.)?(\d+)/.exec(`${stderr}${stdout}`);
      resolve(err || !m ? null : Number(m[1]));
    });
  });
}

/** The newest Java at least `need` among the given folders and the PATH, as { bin, major }, or null. */
export async function findJava(dirs, need) {
  const bins = new Set(['java']);
  for (const dir of dirs) {
    let files = [];
    try {
      files = fs.readdirSync(dir, { recursive: true });
    } catch {}
    for (const f of files)
      if (path.basename(f) === JAVA && path.basename(path.dirname(f)) === 'bin') bins.add(path.join(dir, f));
  }
  let best = null;
  for (const bin of bins) {
    const major = await javaVersion(bin);
    if (major >= need && major > (best?.major ?? 0)) best = { bin, major };
  }
  return best;
}

/** Puts the Fabric server launcher, Fabric API and the bundled mod in `dir`. The launcher fetches Minecraft itself. */
export async function setupServer(dir, mod) {
  const mc = mcBase(mod.mc);
  const jar = path.join(dir, `fabric-server-${mc}.jar`);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(jar)) {
    // A new Minecraft version: the old launcher and Fabric API would load the wrong game.
    for (const n of fs.readdirSync(dir)) if (/^fabric-server-.*\.jar$/.test(n)) fs.rmSync(path.join(dir, n));
    for (const j of jars(dir)) if (j.ids.includes('fabric-api')) fs.rmSync(j.file);
    const stable = (list) => (list.find((v) => v.stable) ?? list[0])?.version;
    const loader = stable(
      (await (await get(`https://meta.fabricmc.net/v2/versions/loader/${mc}`)).json()).map((l) => l.loader),
    );
    const installer = stable(await (await get('https://meta.fabricmc.net/v2/versions/installer')).json());
    if (!loader) throw new Error(`Fabric doesn't support Minecraft ${mc} yet`);
    if (![loader, installer].every((v) => /^[\w.+-]+$/.test(v))) throw new Error('Fabric meta sent an odd version');
    const url = `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/${installer}/server/jar`;
    fs.writeFileSync(`${jar}.part`, Buffer.from(await (await get(url)).arrayBuffer()));
    fs.renameSync(`${jar}.part`, jar);
  }
  await installDeps(dir, mc, ['fabric-api']); // Litematica and MaLiLib are client-only
  install(dir, mod);
  const props = path.join(dir, 'server.properties');
  // A new world is empty, so a farm test counts only what the farm itself makes. Spawn protection off, since nobody is op.
  // 'wx' writes only a new server's file, so the user's edits stay.
  try {
    fs.writeFileSync(
      props,
      'motd=Litescape test server\nspawn-protection=0\ngenerate-structures=false\nlevel-type=minecraft\\:flat\n' +
        'generator-settings={"layers"\\:[{"block"\\:"minecraft\\:air","height"\\:1}],"biome"\\:"minecraft\\:plains"}\n',
      { flag: 'wx' },
    );
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  // Kept even if edited: only this computer can join, and an empty server keeps ticking so farm tests run.
  setProps(props, { 'server-ip': '127.0.0.1', 'pause-when-empty-seconds': '0' });
  return jar;
}

function setProps(file, values) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
  }
  fs.writeFileSync(file, text);
}

export function eulaAccepted(dir) {
  try {
    return /^eula=true$/m.test(fs.readFileSync(path.join(dir, 'eula.txt'), 'utf8'));
  } catch {
    return false;
  }
}

export function acceptEula(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'eula.txt'), `# Accepted in Litescape on ${new Date().toISOString()}\neula=true\n`);
}

/**
 * One server process. `onChange` fires with { state } on each state change, { line } for each log line, and { farm } or
 * { load } for the farm test's progress and the server's load, which the mod reports as LITWEB-FARM and LITWEB-LOAD lines.
 */
export class LocalServer {
  state = 'stopped'; // stopped, installing, starting, running, stopping
  log = [];
  farm = null;
  load = null;
  #proc = null;
  #onChange;

  get running() {
    return this.#proc !== null;
  }

  constructor(onChange) {
    this.#onChange = onChange;
  }

  #set(state) {
    this.state = state;
    this.#onChange({ state });
  }

  #line(line) {
    const report = /\bLITWEB-(FARM|LOAD) (\{.*\})$/.exec(line);
    if (report) {
      const key = report[1].toLowerCase();
      this[key] = JSON.parse(report[2]);
      this.#onChange({ [key]: this[key] });
      return;
    }
    this.log.push(line);
    if (this.log.length > 1000) this.log.shift();
    this.#onChange({ line });
    if (this.state === 'starting' && /\bDone \([\d.,]+s\)!/.test(line)) this.#set('running');
  }

  async start(dir, mod, java) {
    if (this.state !== 'stopped') return;
    this.#set('installing');
    let jar;
    try {
      jar = await setupServer(dir, mod);
    } catch (e) {
      this.#set('stopped');
      throw e;
    }
    this.#set('starting');
    const args = ['-Xmx2G', `-D${FARM_SERVER}=true`, '-jar', path.basename(jar), 'nogui'];
    const proc = spawn(java, args, { cwd: dir });
    this.#proc = proc;
    for (const stream of [proc.stdout, proc.stderr]) {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        const lines = (rest + chunk).split(/\r?\n/);
        rest = lines.pop();
        for (const l of lines) this.#line(l);
      });
    }
    proc.on('error', (e) => this.#line(`Couldn't start Java: ${e.message}`));
    proc.on('close', (code) => {
      this.#line(`Server stopped (exit code ${code}).`);
      this.#proc = null;
      this.#set('stopped');
    });
  }

  /** Resolves once the server is up, or rejects if it stops first. */
  whenRunning() {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.state === 'running') return resolve();
        if (this.state === 'stopped')
          return reject(new Error('The test server stopped. Its log is in the Test Server window'));
        setTimeout(check, 250);
      };
      check();
    });
  }

  send(command) {
    if (!this.#proc) return;
    const cmd = String(command)
      .replace(/[\r\n]/g, ' ')
      .replace(/^\//, '')
      .trim();
    if (!cmd) return;
    this.#line(`> ${cmd}`);
    if (/^stop\b/.test(cmd)) this.#set('stopping');
    this.#proc.stdin.write(`${cmd}\n`);
  }

  /** Saves the world and stops, killing the process if it hangs. Resolves once it has exited. */
  stop(timeout = 60000) {
    const proc = this.#proc;
    if (!proc) return Promise.resolve();
    const exited = new Promise((resolve) => proc.once('close', resolve));
    if (this.state !== 'stopping') this.send('stop');
    const timer = setTimeout(() => proc.kill(), timeout);
    return exited.finally(() => clearTimeout(timer));
  }
}
