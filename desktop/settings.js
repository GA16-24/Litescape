// The settings window. window.litescape comes from preload.cjs.
const list = document.getElementById('list');
const error = document.getElementById('error');
const FOLDER =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>';

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function row(dir) {
  // ".minecraft" says nothing, so name the instance after the folder above it
  const parts = dir.split(/[\\/]/).filter(Boolean);
  const name = /^\.?minecraft$/i.test(parts.at(-1)) && parts.length > 1 ? parts.at(-2) : parts.at(-1);
  const remove = el('button', {
    type: 'button',
    className: 'danger',
    textContent: 'Remove',
    onclick: () => act(() => window.litescape.removeFolder(dir)),
  });
  remove.setAttribute('aria-label', `Remove ${dir}`);
  const li = el('li', { innerHTML: FOLDER }, el('div', {}, name, el('p', { textContent: dir })), remove);
  return li;
}

function render(folders) {
  list.replaceChildren(
    ...(folders.length ? folders.map(row) : [el('li', { className: 'empty', textContent: 'No folders added yet.' })]),
  );
}

async function act(fn) {
  error.textContent = '';
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  try {
    await fn();
    render(await window.litescape.folders());
  } catch (e) {
    error.textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally {
    for (const b of document.querySelectorAll('button')) b.disabled = false;
  }
}

document.getElementById('add').onclick = () => act(() => window.litescape.addFolder());
act(() => {});
