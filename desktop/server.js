// The test server window. window.litescape comes from preload.cjs.
const $ = (id) => document.getElementById(id);
const api = window.litescape;
const LABELS = {
  stopped: 'Stopped',
  installing: 'Downloading the server…',
  starting: 'Starting…',
  running: 'Running at localhost',
  stopping: 'Stopping…',
};
let state = 'stopped';
let eula = false;
const lines = [];
let queued = false;
let load = null;

function render() {
  $('status').textContent = LABELS[state];
  $('status').dataset.state = state;
  const stopped = state === 'stopped';
  $('toggle').textContent = stopped || state === 'installing' ? 'Start' : 'Stop';
  $('toggle').classList.toggle('primary', stopped);
  $('toggle').disabled = state === 'installing' || state === 'stopping' || (stopped && !eula && !$('agree').checked);
  $('eula').hidden = eula;
  for (const b of document.querySelectorAll('[data-cmd], #form button, #cmd')) b.disabled = state !== 'running';
}

/** The server's load, which the mod reports every second: how much of its 50 ms per tick it uses, and its memory. */
function showLoad() {
  $('load').hidden = !load || state !== 'running';
  if (!load) return;
  const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 });
  $('mspt').textContent = `${fmt(load.mspt)} of 50 ms`;
  $('mspt-bar').style.width = `${Math.min(100, load.mspt * 2)}%`;
  $('mspt-bar').classList.toggle('warn', load.mspt > 40);
  // While a farm test fast-forwards, ticks run back to back, so the rate is far above 20.
  $('tps').textContent = load.sprinting ? `${fmt(load.tps)}, fast-forwarding` : fmt(Math.min(20, load.tps));
  $('mem').textContent = `${fmt(load.heapMb)} of ${fmt(load.maxMb)} MB`;
  $('mem-bar').style.width = `${Math.min(100, (100 * load.heapMb) / load.maxMb)}%`;
}

function showLog() {
  queued = false;
  const log = $('log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  log.textContent = lines.join('\n');
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function addLine(line) {
  lines.push(line);
  if (lines.length > 1000) lines.shift();
  if (!queued) queued = requestAnimationFrame(showLog);
}

async function act(fn) {
  $('error').textContent = '';
  try {
    await fn();
  } catch (e) {
    $('error').textContent = `${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}.`;
  }
}

api.onServer((msg) => {
  if (msg.state) {
    state = msg.state;
    render();
  }
  if (msg.line !== undefined) addLine(msg.line);
  if (msg.load) load = msg.load;
  if (msg.load || msg.state) showLoad();
});

$('agree').onchange = render;
$('toggle').onclick = () =>
  act(async () => {
    if (state !== 'stopped') return api.stopServer();
    await api.startServer($('agree').checked);
    eula = true;
    render();
  });
$('folder').onclick = () => act(() => api.serverFolder());
for (const b of document.querySelectorAll('[data-cmd]')) b.onclick = () => act(() => api.serverCommand(b.dataset.cmd));
$('form').onsubmit = (e) => {
  e.preventDefault();
  const cmd = $('cmd').value;
  $('cmd').value = '';
  act(() => api.serverCommand(cmd));
};

act(async () => {
  const s = await api.server();
  state = s.state;
  eula = s.eula;
  for (const l of s.log) addLine(l);
  render();
  load = s.load;
  showLoad();
});
