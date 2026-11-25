// The instance list on the waiting page. window.litescape comes from preload.cjs.
const list = document.getElementById('list');
const summary = document.getElementById('summary');
const error = document.getElementById('error');

const LINKS = {
  'fabric-api': 'https://modrinth.com/mod/fabric-api',
  litematica: 'https://modrinth.com/mod/litematica',
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function note(text, link, warn) {
  const p = el('p', { className: warn ? 'note warn' : 'note' }, text);
  if (link) p.append(' ', el('a', { href: link, target: '_blank' }, 'Get it on Modrinth'));
  return p;
}

function row(i, mod) {
  const meta = [i.launcher, i.mc && `Minecraft ${i.mc}`].filter(Boolean).join(' · ');
  const info = el('div', {}, el('div', { className: 'name' }, i.name), el('div', { className: 'meta' }, meta));
  const actions = [];
  if (i.blocker) {
    info.append(note(i.blocker, i.blocker === 'Needs Fabric API' && LINKS['fabric-api'], true));
  } else {
    if (i.installed) info.append(note(`Litescape ${i.installed} installed`));
    if (!i.litematica)
      info.append(note("Litematica isn't in this instance, so the viewer stays off.", LINKS.litematica, true));
    if (mod && i.installed !== mod.version) {
      actions.push(
        el(
          'button',
          { className: 'primary', type: 'button', onclick: () => act('install', i.dir) },
          i.installed ? `Install ${mod.version}` : 'Install',
        ),
      );
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
      ? "No Minecraft instances found. If you use another launcher, add the instance's folder."
      : `Litescape ${mod.version} works with ${ready} of the ${instances.length} instances found.`;
  list.replaceChildren(...instances.map((i) => row(i, mod)));
}

async function act(action, arg) {
  error.textContent = '';
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  try {
    render(await window.litescape[action](arg));
  } catch (e) {
    // Windows locks a loaded jar, so the usual cause is the game still running.
    error.textContent = `${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}. If Minecraft is running in that instance, close it and try again.`;
  } finally {
    for (const b of document.querySelectorAll('button')) b.disabled = false;
  }
}

document.getElementById('add').onclick = () => act('addFolder');
window.addEventListener('focus', () => act('instances'));
act('instances');
