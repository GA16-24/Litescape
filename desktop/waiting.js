// The instance list on the waiting page. window.litescape comes from preload.cjs.
const list = document.getElementById('list');
const summary = document.getElementById('summary');
const error = document.getElementById('error');

const NAMES = { 'fabric-api': 'Fabric API', malilib: 'MaLiLib', litematica: 'Litematica' };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function note(text, warn) {
  return el('p', { className: warn ? 'note warn' : 'note' }, text);
}

function row(i) {
  const meta = [i.launcher, i.mc && `Minecraft ${i.mc}`].filter(Boolean).join(' · ');
  const info = el('div', {}, el('div', { className: 'name' }, i.name), el('div', { className: 'meta' }, meta));
  const actions = [];
  if (i.blocker) {
    info.append(note(i.blocker, true));
  } else {
    if (i.installed) info.append(note(`Litescape ${i.installed} installed`));
    const missing = i.missing.map((d) => NAMES[d]).join(', ');
    if (missing)
      info.append(
        note(`Missing ${missing}. Install downloads ${i.missing.length > 1 ? 'them' : 'it'} from Modrinth.`, true),
      );
    if (i.mod && (i.installed !== i.mod.version || missing)) {
      const label = !i.installed
        ? 'Install'
        : i.installed !== i.mod.version
          ? `Install ${i.mod.version}`
          : 'Add missing mods';
      actions.push(el('button', { className: 'primary', type: 'button', onclick: () => act('install', i.dir) }, label));
    }
  }
  if (i.installed) actions.push(el('button', { type: 'button', onclick: () => act('uninstall', i.dir) }, 'Remove'));
  return el('li', {}, info, ...actions);
}

function render({ mod, instances }) {
  const ready = instances.filter((i) => !i.blocker).length;
  summary.textContent = !mod
    ? 'This build of the app has no mod to install.'
    : instances.length === 0
      ? "No Minecraft instances found. Create one, or if you use another launcher, add the instance's folder."
      : `Litescape ${mod.version} works with ${ready} of the ${instances.length} instances found.`;
  list.replaceChildren(...instances.map((i) => row(i)));
}

async function act(action, arg) {
  error.textContent = '';
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  const before = summary.textContent;
  if (action !== 'instances') summary.textContent = 'Working… Downloads can take a minute.';
  try {
    render(await window.litescape[action](arg));
  } catch (e) {
    summary.textContent = before;
    const message = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    // Windows locks a loaded jar, so a file error usually means the game is still running.
    error.textContent = /^E[A-Z]+:/.test(message)
      ? `${message}. If Minecraft is running in that instance, close it and try again.`
      : `${message}.`;
  } finally {
    for (const b of document.querySelectorAll('button')) b.disabled = false;
  }
}

document.getElementById('create').onclick = () => act('createInstance');
document.getElementById('add').onclick = () => act('addFolder');
window.addEventListener('focus', () => act('instances'));
act('instances');
