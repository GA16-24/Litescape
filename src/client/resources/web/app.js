import { Iris } from './iris.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import * as THREE from './vendor/three.module.min.js';

const $ = (id) => document.getElementById(id);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
const fmt = new Intl.NumberFormat();
const STATUS = {
  1: { key: 'ok', label: 'Placed correctly', color: 'var(--ok)' },
  2: { key: 'missing', label: 'Still missing', color: 'var(--missing)' },
  3: { key: 'wrong', label: 'Wrong block', color: 'var(--wrong)' },
  4: { key: 'state', label: 'Wrong orientation or state', color: 'var(--state)' },
  5: { key: 'unknown', label: 'Not loaded on the server', color: 'var(--unknown)' },
};

const ICON = {
  selection:
    '<svg class="i" viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M9 9h6v6H9z"/></svg>',
  placement:
    '<svg class="i" viewBox="0 0 24 24"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/></svg>',
  shared:
    '<svg class="i" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14a5.5 5.5 0 0 1 2.5 5"/></svg>',
  share:
    '<svg class="i" viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  alert: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/></svg>',
  plug: '<svg class="i" viewBox="0 0 24 24"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/></svg>',
  globe:
    '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.7 2.5 14.3 0 17M12 3.5c-2.5 2.7-2.5 14.3 0 17"/></svg>',
  user: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  server:
    '<svg class="i" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/></svg>',
  copy: '<svg class="i" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  cmd: '<svg class="i" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  stop: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  retry: '<svg class="i" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  folder:
    '<svg class="i" viewBox="0 0 24 24"><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  download: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/></svg>',
  sparkle:
    '<svg class="i" viewBox="0 0 24 24"><path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7-5.6-1.9L10.1 9z"/></svg>',
  back: '<svg class="i" viewBox="0 0 24 24"><path d="m14.5 6-6 6 6 6"/></svg>',
  chevron: '<svg class="i" viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6"/></svg>',
  sun: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  moon: '<svg class="i" viewBox="0 0 24 24"><path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/></svg>',
};

// ---------------------------------------------------------------- app state

const S = {
  api: null, // last /api/state
  connected: null,
  desc: null, // {type, id}: what the user picked
  data: null, // loaded view
  loadingKey: null,
  sig: null, // signature of the loaded view's source (boxes / updated)
  status: null,
  counts: null,
  statusAt: 0,
  statusSig: '',
  vis: null,
  layerMode: 'all',
  layerY: 0,
  filter: 'all',
  ghosts: true,
  iso: -1,
  hl: -1,
  matQuery: '',
  pct: new Map(), // view key -> last known build %
  busy: new Set(), // share/unshare in flight
};

// ---------------------------------------------------------------- three.js

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;
const root = new THREE.Group();
scene.add(root);
const hlUniform = { value: -1 };
const meshes = [];
let gridHelper = null,
  boxLines = null,
  atlasTex = null;
const cursor = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
);
cursor.visible = false;
cursor.renderOrder = 10;
scene.add(cursor);

function withHighlight(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHl = hlUniform;
    sh.vertexShader =
      'attribute float pid;\nvarying float vPid;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPid = pid;');
    sh.fragmentShader =
      'uniform float uHl;\nvarying float vPid;\n' +
      sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\nif (uHl >= 0.0 && abs(vPid - uHl) > 0.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.06), 0.78);',
      );
  };
  return mat;
}

const materials = [
  withHighlight(new THREE.MeshBasicMaterial({ vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })),
  withHighlight(
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  ),
  withHighlight(
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      color: 0xa8bbff,
      side: THREE.DoubleSide,
    }),
  ),
];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function applyTheme() {
  scene.background = new THREE.Color(cssVar('--scene'));
  const light = scene.background.getHSL({}).l > 0.5;
  cursor.material.color.set(light ? 0x111111 : 0xffffff);
  if (gridHelper) setGridColors();
  needsRender = true;
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

let needsRender = true;
function resize() {
  const r = $('stage').getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  needsRender = true;
}
new ResizeObserver(resize).observe($('stage'));
controls.addEventListener('change', () => {
  needsRender = true;
});
function frame(now) {
  requestAnimationFrame(frame);
  controls.update();
  const shaded = shaderOn();
  if ($('gl-iris').hidden === shaded) syncShaderView(); // e.g. the loading overlay just went away
  if (shaded) {
    renderIris(now);
    return;
  }
  if (!needsRender) return;
  needsRender = false;
  renderer.render(scene, camera);
  const az = controls.getAzimuthalAngle();
  $('compass').firstElementChild.style.transform = `translateX(-50%) rotate(${az}rad)`;
}

// ---------------------------------------------------------------- data loading

const texCache = new Map(); // id -> Promise<HTMLImageElement|null>
function loadImage(id) {
  if (!texCache.has(id)) {
    const [ns, path] = id.split(':');
    texCache.set(
      id,
      new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = `tex/${ns}/${path}`;
      }),
    );
  }
  return texCache.get(id);
}

async function buildAtlas(tex) {
  const imgs = await Promise.all(tex.map((t) => loadImage(t.id)));
  const cell = Math.max(16, ...tex.map((t) => Math.max(t.w, t.h)));
  const cols = Math.max(1, Math.ceil(Math.sqrt(tex.length)));
  const rows = Math.max(1, Math.ceil(tex.length / cols));
  const c = document.createElement('canvas');
  c.width = cols * cell;
  c.height = rows * cell;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const rects = new Float32Array(tex.length * 4);
  tex.forEach((t, i) => {
    const x = (i % cols) * cell,
      y = Math.floor(i / cols) * cell;
    const img = imgs[i];
    if (img)
      g.drawImage(img, 0, 0, t.w, t.h, x, y, t.w, t.h); // first frame of animated strips
    else {
      g.fillStyle = '#f0f';
      g.fillRect(x, y, t.w, t.h);
      g.fillStyle = '#000';
      g.fillRect(x, y, t.w / 2, t.h / 2);
      g.fillRect(x + t.w / 2, y + t.h / 2, t.w / 2, t.h / 2);
    }
    rects.set([x / c.width, y / c.height, (x + t.w) / c.width, (y + t.h) / c.height], i * 4);
  });
  return { canvas: c, rects };
}

function b64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const pretty = (n) =>
  n
    .slice(n.indexOf(':') + 1)
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
const dims = (s) => `${s[0]}×${s[1]}×${s[2]}`;
const boxSize = (boxes) => {
  const u = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const b of boxes)
    for (let i = 0; i < 3; i++) {
      u[i] = Math.min(u[i], b[i], b[i + 3]);
      u[i + 3] = Math.max(u[i + 3], b[i], b[i + 3]);
    }
  return [u[3] - u[0] + 1, u[4] - u[1] + 1, u[5] - u[2] + 1];
};
const keyOf = (d) => (d ? `${d.type}:${d.id || ''}` : '');
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `${r.status} ${r.statusText}`);
  return body;
}

const worker = new Worker('mesher.js');
let meshSeq = 0;
worker.onmessage = (e) => {
  if (e.data.seq !== meshSeq) return; // a newer request is on its way
  S.vis = e.data.vis;
  meshes.forEach((m) => {
    root.remove(m);
    m.geometry.dispose();
  });
  meshes.length = 0;
  SH.meshReady = e.data.iris;
  if (e.data.iris) iris.setMesh(e.data.groups);
  else
    e.data.groups.forEach((g, i) => {
      if (!g.idx.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(g.col, 3, true));
      geo.setAttribute('pid', new THREE.BufferAttribute(g.pid, 1));
      geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
      const m = new THREE.Mesh(geo, materials[i]);
      m.renderOrder = i;
      root.add(m);
      meshes.push(m);
    });
  needsRender = true;
  syncShaderView();
  if (S.pendingFit) {
    S.pendingFit = false;
    fit();
  }
  hideOverlayIfLoaded();
};

let meshQueued = false;
function remesh() {
  if (meshQueued || !S.data) return;
  meshQueued = true;
  requestAnimationFrame(() => {
    meshQueued = false;
    const _d = S.data;
    const [y0, y1] = layerRange();
    worker.postMessage({
      type: 'mesh',
      seq: ++meshSeq,
      opts: {
        y0,
        y1,
        filter: S.status ? S.filter : 'all',
        ghosts: S.ghosts,
        iso: S.iso,
        status: S.status,
        iris: shaderWanted(),
        separateAo: !!iris?.separateAo,
      },
    });
    setGridY(y0);
  });
}

function layerRange() {
  const top = S.data.size[1] - 1;
  if (S.layerMode === 'all') return [0, top];
  if (S.layerMode === 'single') return [S.layerY, S.layerY];
  return [0, S.layerY];
}

async function open(desc, { force = false } = {}) {
  if (!desc) return;
  const key = keyOf(desc);
  const changedView = key !== keyOf(S.desc);
  S.desc = desc;
  const hash = `#/${desc.type}${desc.id ? `/${desc.id}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  if (!force && !changedView && S.data) return;
  if (changedView) {
    S.status = null;
    S.counts = null;
    S.statusSig = '';
    S.iso = -1;
    S.filter = 'all';
    S.layerMode = 'all';
    S.data = null;
    S.vis = null; // never show the previous view's blocks under the new name
    hlUniform.value = -1;
    clearScene();
    renderInspector();
  }
  S.sig = viewSig(desc);
  renderNav();
  renderTop();
  S.loadingKey = `${key}:${Date.now()}`;
  const token = S.loadingKey;
  const big = S.data && !changedView;
  showOverlay(loadingHtml(desc), big);
  try {
    const data = await api(`api/view?type=${desc.type}&id=${encodeURIComponent(desc.id || '')}`);
    if (S.loadingKey !== token) return;
    setLoadingText('Loading textures…');
    const atlas = await buildAtlas(data.tex);
    if (S.loadingKey !== token) return;
    setLoadingText('Building mesh…');
    prepare(data, atlas, changedView || !S.data || String(S.data.size) !== String(data.size));
    if (desc.type !== 'selection') pollStatus(true);
  } catch (err) {
    if (S.loadingKey !== token) return;
    showError(desc, err.message);
  }
}

function prepare(data, atlas, refit) {
  data.blocks16 = new Uint16Array(b64(data.blocks).buffer);
  const mids = new Map();
  data.mats = []; // material groups by block id
  data.palette.forEach((e, i) => {
    if (!e || e.air) return;
    if (!mids.has(e.n)) {
      mids.set(e.n, data.mats.length);
      data.mats.push({ n: e.n, name: pretty(e.n), pal: [], icon: null });
    }
    e.mid = mids.get(e.n);
    data.mats[e.mid].pal.push(i);
  });
  data.atlas = atlas;
  S.data = data;
  if (S.layerY > data.size[1] - 1 || refit) S.layerY = data.size[1] - 1;

  if (atlasTex) atlasTex.dispose();
  atlasTex = new THREE.CanvasTexture(atlas.canvas);
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.minFilter = THREE.NearestFilter;
  atlasTex.generateMipmaps = false;
  atlasTex.flipY = false;
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  materials.forEach((m) => {
    m.map = atlasTex;
    m.needsUpdate = true;
  });
  iris?.setAtlas(atlas.canvas);

  const pal = data.palette.map(
    (e) =>
      e && {
        air: e.air,
        opaque: !!e.opaque,
        selfCull: !!e.selfCull,
        mid: e.mid ?? -1,
        f: e.f || null,
        light: e.light || 0,
        q: new Float32Array((e.q || []).flat()),
      },
  );
  worker.postMessage({
    type: 'load',
    sx: data.size[0],
    sy: data.size[1],
    sz: data.size[2],
    blocks: data.blocks16,
    pal,
    rects: atlas.rects,
  });
  sendEnt();
  buildHelpers(data);
  countMaterials();
  if (refit) S.pendingFit = true;
  remesh();
  renderAll();
}

function viewSig(desc) {
  const a = S.api;
  if (!a || !desc) return null;
  if (desc.type === 'selection') return a.selection ? a.selection.name + JSON.stringify(a.selection.boxes) : null;
  if (desc.type === 'placement') {
    const p = (a.placements || []).find((x) => x.id === desc.id);
    return p ? JSON.stringify(p.boxes) : null;
  }
  const s = (a.shared || []).find((x) => x.id === desc.id);
  return s ? String(s.updated) : null;
}

function buildHelpers(data) {
  if (gridHelper) {
    scene.remove(gridHelper);
    gridHelper.geometry.dispose();
  }
  if (boxLines) {
    root.remove(boxLines);
    boxLines.geometry.dispose();
  }
  const [sx, , sz] = data.size;
  const n = Math.ceil(Math.max(sx, sz) / 2) * 2 + 16;
  gridHelper = new THREE.GridHelper(n, n);
  gridHelper.position.set(sx / 2, 0, sz / 2);
  setGridColors();
  scene.add(gridHelper);

  const boxes = currentBoxes();
  if (boxes.length) {
    const pts = [];
    const [ox, oy, oz] = data.origin;
    for (const b of boxes) {
      const x0 = Math.min(b[0], b[3]) - ox,
        y0 = Math.min(b[1], b[4]) - oy,
        z0 = Math.min(b[2], b[5]) - oz;
      const x1 = Math.max(b[0], b[3]) - ox + 1,
        y1 = Math.max(b[1], b[4]) - oy + 1,
        z1 = Math.max(b[2], b[5]) - oz + 1;
      const c = [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
      ];
      for (const [a, b2] of [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ])
        pts.push(...c[a], ...c[b2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    boxLines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar('--accent')), transparent: true, opacity: 0.55 }),
    );
    root.add(boxLines);
  } else boxLines = null;
}

function setGridColors() {
  const light = scene.background && scene.background.getHSL({}).l > 0.5;
  const c = new THREE.Color(light ? 0x000000 : 0xffffff);
  gridHelper.material.vertexColors = false;
  gridHelper.material.color = c;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = light ? 0.09 : 0.06;
  gridHelper.material.needsUpdate = true;
}
function setGridY(y0) {
  if (gridHelper) {
    gridHelper.position.y = y0 - 0.001;
    needsRender = true;
  }
}

function currentBoxes() {
  const d = S.desc,
    a = S.api;
  if (!d || !a) return [];
  if (d.type === 'selection') return a.selection?.boxes || [];
  if (d.type === 'placement') return (a.placements || []).find((p) => p.id === d.id)?.boxes || [];
  const s = (a.shared || []).find((x) => x.id === d.id);
  return s
    ? [
        [
          s.origin[0],
          s.origin[1],
          s.origin[2],
          s.origin[0] + s.size[0] - 1,
          s.origin[1] + s.size[1] - 1,
          s.origin[2] + s.size[2] - 1,
        ],
      ]
    : [];
}

/** Frames the blocks that are currently shown (all of them, a filter's few, or one layer). */
function fit() {
  if (!S.data) return;
  const [sx, sy, sz] = S.data.size;
  const lo = [sx, sy, sz],
    hi = [-1, -1, -1];
  if (S.vis) {
    for (let i = 0; i < S.vis.length; i++) {
      if (!S.vis[i]) continue;
      const p = [i % sx, (i / (sx * sz)) | 0, ((i / sx) | 0) % sz];
      for (let k = 0; k < 3; k++) {
        if (p[k] < lo[k]) lo[k] = p[k];
        if (p[k] > hi[k]) hi[k] = p[k];
      }
    }
  }
  if (hi[0] < 0) {
    const [y0, y1] = layerRange();
    lo.splice(0, 3, 0, y0, 0);
    hi.splice(0, 3, sx - 1, y1, sz - 1);
  }
  const center = new THREE.Vector3((lo[0] + hi[0] + 1) / 2, (lo[1] + hi[1] + 1) / 2, (lo[2] + hi[2] + 1) / 2);
  const radius = Math.max(2.5, Math.hypot(hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1) / 2);
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const fov = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect)); // portrait screens are width-bound
  const dist = (radius / Math.sin(fov / 2)) * 0.95;
  const dir = new THREE.Vector3(1, 0.75, 1.25).normalize();
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(0.05, dist / 500);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.update();
  needsRender = true;
}

// ---------------------------------------------------------------- status (build progress)

let statusTimer = 0;
async function pollStatus(now) {
  clearTimeout(statusTimer);
  const d = S.desc;
  if (!d || d.type === 'selection' || !S.data) return;
  if (!now && document.hidden) {
    statusTimer = setTimeout(pollStatus, 2000);
    return;
  }
  const key = keyOf(d);
  try {
    const r = await api(`api/status?type=${d.type}&id=${encodeURIComponent(d.id)}`);
    if (keyOf(S.desc) !== key || !S.data) return;
    {
      const changed = r.status !== S.statusSig;
      S.statusSig = r.status;
      S.counts = r.counts;
      S.statusAt = Date.now();
      S.statusErr = null;
      if (changed) {
        S.status = b64(r.status);
        countMaterials();
        remesh();
      }
      const total = r.counts.slice(1).reduce((a, b) => a + b, 0);
      S.pct.set(key, total ? r.counts[1] / total : 0);
      renderInspector();
      renderNav();
      renderTop();
    }
  } catch (err) {
    if (err.message !== 'rate-limited') {
      S.statusErr = err.message;
      renderInspector();
    }
  }
  statusTimer = setTimeout(pollStatus, 2000);
}

function countMaterials() {
  const d = S.data;
  if (!d) return;
  for (const m of d.mats) {
    m.total = 0;
    m.ok = 0;
  }
  const blocks = d.blocks16,
    st = S.status;
  for (let i = 0; i < blocks.length; i++) {
    const e = d.palette[blocks[i]];
    if (!e || e.air) continue;
    const m = d.mats[e.mid];
    m.total++;
    if (st && st[i] === 1) m.ok++;
  }
  d.unknown = 0;
  d.nonAir = 0;
  for (let i = 0; i < blocks.length; i++) {
    const e = d.palette[blocks[i]];
    if (e === null) d.unknown++;
    else if (!e.air) d.nonAir++;
  }
}

function matIcon(m) {
  if (m.icon) return m.icon;
  const d = S.data;
  const e = d.palette[m.pal[0]];
  let q = null;
  for (let off = 0; off < (e.q || []).length; off++)
    if (e.q[off][4] === 1) {
      q = e.q[off];
      break;
    }
  q = q || e.q?.[0];
  const t = q ? q[0] : e.f ? e.f.t : -1;
  const tint = q ? q[2] : e.f ? e.f.c : -1;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (t >= 0) {
    const r = d.atlas.rects,
      W = d.atlas.canvas.width,
      H = d.atlas.canvas.height;
    const sx = r[t * 4] * W,
      sy = r[t * 4 + 1] * H,
      sw = (r[t * 4 + 2] - r[t * 4]) * W,
      sh = (r[t * 4 + 3] - r[t * 4 + 1]) * H;
    g.drawImage(d.atlas.canvas, sx, sy, sw, sh, 0, 0, 16, 16);
    if (tint >= 0) {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `#${tint.toString(16).padStart(6, '0')}`;
      g.fillRect(0, 0, 16, 16);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(d.atlas.canvas, sx, sy, sw, sh, 0, 0, 16, 16);
    }
  }
  m.icon = c.toDataURL();
  return m.icon;
}

// ---------------------------------------------------------------- state polling

async function pollState() {
  try {
    const a = await api('api/state');
    const wasConnected = S.connected;
    S.api = a;
    S.connected = true;
    if (!wasConnected && S.data) remesh();
    onState();
  } catch {
    S.connected = false;
    if (!S.data) showOffline();
    renderAll();
  }
  setTimeout(pollState, 1000);
}

let reloadTimer = 0;
function onState() {
  renderConn();
  renderNav();
  renderFoot();
  const a = S.api;
  if (!a.inWorld) {
    S.data = null;
    S.loadingKey = null;
    clearScene();
    renderAll();
    showOverlay(emptyHtml('world'));
    return;
  }
  if (!S.desc) {
    const fromHash = parseHash();
    const first =
      fromHash && exists(fromHash)
        ? fromHash
        : a.selection
          ? { type: 'selection' }
          : a.placements?.[0]
            ? { type: 'placement', id: a.placements[0].id }
            : a.shared?.[0]
              ? { type: 'shared', id: a.shared[0].id }
              : null;
    if (first) open(first);
    else {
      showOverlay(emptyHtml('selection'));
      renderAll();
    }
    return;
  }
  if (!exists(S.desc)) {
    if (S.desc.type === 'selection') showOverlay(emptyHtml('selection'));
    else showOverlay(emptyHtml('gone'));
    S.data = null;
    S.loadingKey = null;
    clearScene();
    renderAll();
    return;
  }
  if (!S.data && !S.loadingKey) {
    open(S.desc, { force: true });
    return;
  }
  const sig = viewSig(S.desc);
  if (sig !== S.sig) {
    // The selection or placement changed in game (or a failed load may now work): reload once it settles.
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => open(S.desc, { force: true }), 450);
    S.sig = sig;
  }
  renderTop();
}

function exists(d) {
  const a = S.api;
  if (!a?.inWorld) return false;
  if (d.type === 'selection') return !!a.selection;
  if (d.type === 'placement') return !!(a.placements || []).find((p) => p.id === d.id);
  if (d.type === 'shared') return !!(a.shared || []).find((p) => p.id === d.id);
  return false;
}

function parseHash() {
  const [, type, id] = location.hash.split('/');
  return ['selection', 'placement', 'shared'].includes(type) ? { type, id: id || undefined } : null;
}

function clearScene() {
  meshes.forEach((m) => {
    root.remove(m);
    m.geometry.dispose();
  });
  meshes.length = 0;
  cursor.visible = false;
  needsRender = true;
}

// ---------------------------------------------------------------- overlays

function showOverlay(html, translucent = false) {
  const o = $('overlay');
  o.innerHTML = html;
  o.hidden = false;
  o.classList.toggle('translucent', translucent);
  $('layers').hidden = true;
  for (const b of o.querySelectorAll('[data-go]'))
    b.addEventListener('click', () => open(JSON.parse(b.dataset.go), { force: true }));
  for (const b of o.querySelectorAll('[data-palette]')) b.addEventListener('click', () => openPalette(''));
}
function hideOverlayIfLoaded() {
  if (!S.data) return;
  S.loadingKey = null;
  $('overlay').hidden = true;
  $('layers').hidden = false;
  renderLayers();
}
function setLoadingText(t) {
  const el = $('overlay').querySelector('.loading-text');
  if (el) el.textContent = t;
}
function loadingHtml(desc) {
  const what =
    desc.type === 'selection' && S.api?.serverMod && S.api?.regionRead !== 'no'
      ? 'Reading blocks from the server…'
      : desc.type === 'shared'
        ? 'Downloading the shared schematic…'
        : desc.type === 'placement'
          ? 'Reading your placement…'
          : 'Reading loaded chunks…';
  return `<div class="loading"><div class="spinner"></div><div class="loading-text">${what}</div></div>`;
}
function showOffline() {
  showOverlay(`<div class="empty">
    <div class="empty-icon">${ICON.plug}</div>
    <h2>Can't reach Minecraft</h2>
    <p>This page is served by the Litematica Web Viewer mod. Start Minecraft with the mod installed and this page reconnects on its own.</p>
    <div class="progress-line"><i></i></div></div>`);
}
function showError(desc, msg) {
  const nice =
    {
      'no-permission':
        'The server only lets operators read areas. Ask an operator, or change region-read in config/litweb-server.properties.',
    }[msg] || msg;
  showOverlay(`<div class="empty">
    <div class="empty-icon" style="color:var(--danger)">${ICON.alert}</div>
    <h2>Couldn't load this view</h2>
    <p>${esc(nice)}</p>
    <div class="btn-row"><button class="btn" data-go='${esc(JSON.stringify(desc))}'>${ICON.retry}Try again</button></div></div>`);
}
function emptyHtml(kind) {
  if (kind === 'world')
    return `<div class="empty">
    <div class="empty-icon">${ICON.globe}</div>
    <h2>Join a world</h2>
    <p>Open a singleplayer world or join a server. Your selection and placements show up here as soon as you're in.</p></div>`;
  if (kind === 'gone')
    return `<div class="empty">
    <div class="empty-icon">${ICON.placement}</div>
    <h2>This view is gone</h2>
    <p>The placement was removed or is no longer shared. Pick another one from the sidebar.</p>
    <div class="btn-row"><button class="btn" data-palette>Browse views <kbd class="kbd">${MOD} K</kbd></button></div></div>`;
  return `<div class="empty">
    <div class="empty-icon">${ICON.selection}</div>
    <h2>Select an area in Minecraft</h2>
    <ol>
      <li><span>Hold Litematica's tool item (a stick by default) and switch to <b>Area Selection</b> mode with <span class="kbd">Ctrl</span> + scroll.</span></li>
      <li><span>Left-click one corner, right-click the opposite corner.</span></li>
      <li><span>The area appears here in 3D and updates while you adjust it.</span></li>
    </ol></div>`;
}

// ---------------------------------------------------------------- rendering UI

function renderAll() {
  renderConn();
  renderNav();
  renderTop();
  renderInspector();
  renderFoot();
  renderLayers();
}

function renderConn() {
  const el = $('conn');
  el.classList.toggle('ok', S.connected === true);
  el.classList.toggle('bad', S.connected === false);
  el.querySelector('.conn-text').textContent = S.connected === false ? 'Offline' : S.connected ? 'Live' : 'Connecting…';
  el.title = S.connected
    ? 'Connected to Minecraft'
    : S.connected === false
      ? 'Minecraft is not reachable. Retrying.'
      : '';
}

function rowHtml({ desc, icon, title, sub, meta = '', action = '', pct }) {
  const cur = keyOf(desc) === keyOf(S.desc);
  const bar = pct == null ? '' : `<span class="mini-bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></span>`;
  return `<div class="row" role="button" tabindex="0" data-desc='${esc(JSON.stringify(desc))}' aria-current="${cur}">
    <span class="row-icon">${icon}</span>
    <span class="row-main"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}${bar}</span>
    ${meta ? `<span class="row-meta">${meta}</span>` : ''}${action}</div>`;
}

let lastNav = null;
function renderNav() {
  const a = S.api;
  const nav = $('nav');
  if (!a?.inWorld) {
    nav.innerHTML = '';
    lastNav = null;
    return;
  }
  let h = '<div class="nav-section"><div class="nav-head">Selection</div>';
  h += a.selection
    ? rowHtml({
        desc: { type: 'selection' },
        icon: ICON.selection,
        title: a.selection.name,
        sub: `${dims(boxSize(a.selection.boxes))}${a.selection.boxes.length > 1 ? ` · ${a.selection.boxes.length} boxes` : ''}`,
      })
    : '<div class="nav-empty">Nothing selected. Use Litematica\'s area selection in game.</div>';
  h += '</div><div class="nav-section"><div class="nav-head">Your placements</div>';
  if (!a.placements?.length)
    h += '<div class="nav-empty">No schematics placed. Load one in Litematica to track its build here.</div>';
  for (const p of a.placements || []) {
    const shared = !!p.sharedId;
    const busy = S.busy.has(p.id);
    const tip = !a.serverMod
      ? 'The server needs Litematica Web Viewer to share'
      : shared
        ? 'Shared with players on this server'
        : 'Share so other players can follow the build';
    const action = `<button class="row-action ${shared ? 'on' : ''}" data-share="${esc(p.id)}" aria-disabled="${!a.serverMod || busy}" data-tip="${esc(tip)}">${shared ? `${ICON.check}Shared` : ICON.share + (busy ? 'Sharing…' : 'Share')}</button>`;
    h += rowHtml({
      desc: { type: 'placement', id: p.id },
      icon: ICON.placement,
      title: p.name,
      sub: dims(boxSize(p.boxes)) + (p.enabled ? '' : ' · hidden in game'),
      action,
      pct: S.pct.get(`placement:${p.id}`),
    });
  }
  h += '</div><div class="nav-section"><div class="nav-head">Shared on this server</div>';
  if (!a.serverMod)
    h +=
      '<div class="nav-empty">Install Litematica Web Viewer on the server to see what other players are building.</div>';
  else if (!a.shared?.length)
    h += '<div class="nav-empty">Nothing shared yet. Share one of your placements so others can follow it.</div>';
  for (const s of a.shared || []) {
    h += rowHtml({
      desc: { type: 'shared', id: s.id },
      icon: ICON.shared,
      title: s.name,
      sub: `${s.mine ? 'You' : esc(s.ownerName)} · ${dims(s.size)}${s.dim !== a.dim ? ` · ${esc(s.dim.replace('minecraft:', '').replace('the_', ''))}` : ''}`,
      pct: S.pct.get(`shared:${s.id}`),
    });
  }
  h += '</div>';
  if (h !== lastNav) {
    // re-rendering every poll would drop keyboard focus
    const focused = document.activeElement?.closest?.('#nav [data-desc]')?.dataset.desc;
    nav.innerHTML = lastNav = h;
    if (focused) [...nav.querySelectorAll('[data-desc]')].find((r) => r.dataset.desc === focused)?.focus();
  }
}

function renderFoot() {
  const a = S.api;
  if (!a?.inWorld) {
    $('foot').innerHTML = S.connected ? '<div class="foot-line">Not in a world</div>' : '';
    return;
  }
  const server = a.singleplayer
    ? 'Singleplayer'
    : a.serverMod
      ? 'Server has the viewer'
      : 'Vanilla server: loaded chunks only';
  $('foot').innerHTML =
    `<div class="foot-line">${ICON.user}<b>${esc(a.player)}</b><span>· ${esc(a.dim.replace('minecraft:', ''))}</span></div>
    <div class="foot-line">${ICON.server}<span>${server}</span></div>`;
}

function renderTop() {
  const d = S.desc,
    a = S.api,
    data = S.data;
  let crumbs = '';
  if (d && a) {
    const group = { selection: 'Selection', placement: 'Your placements', shared: 'Shared' }[d.type];
    const name =
      d.type === 'selection'
        ? a.selection?.name
        : d.type === 'placement'
          ? a.placements?.find((p) => p.id === d.id)?.name
          : a.shared?.find((s) => s.id === d.id)?.name;
    crumbs = `<span class="muted">${group}</span>${name ? `<span class="sep">/</span><strong>${esc(name)}</strong>` : ''}`;
  }
  $('crumbs').innerHTML = crumbs;
  let chips = '';
  if (data && d) {
    chips += `<span class="chip num">${dims(data.size)}</span>`;
    if (data.unknown) {
      const pct = Math.max(1, Math.floor(100 * (1 - data.unknown / data.blocks16.length)));
      const why =
        data.source === 'server'
          ? 'Only chunks loaded on the server can be read.'
          : a?.serverMod
            ? 'Your client only knows nearby chunks, and server reads need operator permission.'
            : 'Your client only knows nearby chunks. Install the mod on the server for wider reads.';
      chips += `<span class="chip warn" data-tip="${why}">${pct}% loaded</span>`;
    } else if (data.source !== 'placement' && data.source !== 'shared') {
      chips += `<span class="chip" data-tip="${data.source === 'server' ? 'Read from the server' : 'Read from chunks your client has loaded'}">${data.source === 'server' ? 'From server' : 'Loaded chunks'}</span>`;
    }
    if (S.counts && S.connected)
      chips += `<span class="chip live" data-tip="Build progress updates every 2 seconds">Live</span>`;
    if (S.connected === false) chips += `<span class="chip warn">Offline</span>`;
  }
  if (data && SH.settings.enabled && SH.settings.pack) {
    const name = packName(SH.settings.pack);
    chips +=
      SH.status === 'compiling'
        ? `<button type="button" class="chip accent" data-open-shaders data-tip="Open shader settings"><span class="spinner xs"></span>${esc(name)}</button>`
        : SH.status === 'error'
          ? `<button type="button" class="chip warn" data-open-shaders data-tip="${esc(SH.error || '')}">${esc(name)} failed</button>`
          : `<button type="button" class="chip accent" data-open-shaders data-tip="Open shader settings">${ICON.sparkle}${esc(name)}</button>`;
  }
  $('chips').innerHTML = chips;
  const has = !!data;
  for (const id of ['act-refresh', 'act-fit', 'act-shot', 'act-shaders']) $(id).disabled = !has;
  $('act-shaders').setAttribute('aria-pressed', String(!!SH.settings.enabled));
}

function renderInspector() {
  const el = $('inspector');
  const d = S.desc,
    data = S.data,
    a = S.api;
  $('app').classList.toggle('idle', !data); // no view: give the space back to the canvas
  $('toggle-inspector').hidden = !data;
  if (!data || !d || !a) {
    el.innerHTML = '';
    return;
  }
  const scrollTop = el.scrollTop;
  let h = `<div class="tabs" role="tablist" aria-label="Panel">${[
    ['details', 'Details'],
    ['shaders', 'Shaders'],
  ]
    .map(
      ([k, l]) =>
        `<button type="button" role="tab" id="tab-${k}" aria-selected="${SH.tab === k}" aria-controls="inspector" tabindex="${SH.tab === k ? 0 : -1}" data-tab="${k}">${l}${k === 'shaders' && SH.settings.enabled ? '<span class="tab-dot" aria-label="on"></span>' : ''}</button>`,
    )
    .join('')}</div>`;
  if (SH.tab === 'shaders') {
    el.innerHTML = h + renderShaders();
    el.scrollTop = scrollTop;
    const f = $('sh-search');
    if (f && SH.searchFocus && document.activeElement !== f) {
      f.focus();
      f.setSelectionRange(f.value.length, f.value.length);
    }
    return;
  }

  if (S.counts) {
    const c = S.counts;
    const total = c[1] + c[2] + c[3] + c[4] + c[5];
    const pct = total ? (100 * c[1]) / total : 0;
    const ago = Math.max(0, Math.round((Date.now() - S.statusAt) / 1000));
    h += `<section class="panel"><div class="panel-head"><h3>Build progress</h3><span class="row-meta num">${fmt.format(c[1])} / ${fmt.format(total)}</span></div>
      <div class="big-pct"><strong class="num">${pct >= 99.95 && pct < 100 ? '99.9' : pct.toFixed(pct === 100 || pct === 0 ? 0 : 1)}%</strong><span>${pct === 100 ? 'Complete' : 'placed'}</span></div>
      <div class="stack">${[1, 3, 4, 5, 2].map((k) => (c[k] ? `<i style="width:${(100 * c[k]) / total}%;background:${STATUS[k].color}"></i>` : '')).join('')}</div>
      <div class="legend">${[1, 2, 3, 4, 5]
        .filter((k) => c[k] || k <= 2)
        .map(
          (k) =>
            `<button type="button" data-legend="${k}"><span class="sw" style="background:${STATUS[k].color}"></span><span class="lbl">${STATUS[k].label}</span><span class="num">${fmt.format(c[k])}</span></button>`,
        )
        .join('')}</div>
      <div class="seg filter-seg" role="radiogroup" aria-label="Show blocks">${[
        ['all', 'All', '1'],
        ['remaining', 'Remaining', '2'],
        ['problems', 'Problems', '3'],
      ]
        .map(
          ([k, l, key]) =>
            `<button type="button" role="radio" aria-checked="${S.filter === k}" data-filter="${k}" data-tip="Show ${l.toLowerCase()} blocks" data-key="${key}">${l}</button>`,
        )
        .join('')}</div>
      <label class="updated"><input type="checkbox" id="ghosts" ${S.ghosts ? 'checked' : ''}> Show missing blocks as ghosts <kbd class="kbd">G</kbd></label>
      <div class="updated" id="updated-at">${S.statusErr ? `<span style="color:var(--danger)">${esc(S.statusErr)}</span>` : `Updated ${ago < 2 ? 'just now' : `${ago}s ago`}`}</div>
    </section>`;
  } else if (d.type !== 'selection') {
    h += `<section class="panel"><div class="panel-head"><h3>Build progress</h3></div><div class="updated">${S.statusErr ? `<span style="color:var(--danger)">${esc(S.statusErr)}</span>` : 'Checking the world…'}</div></section>`;
  }

  const facts = [
    ['Size', dims(data.size)],
    ['Blocks', fmt.format(data.nonAir)],
    ['Origin', data.origin.join(', ')],
  ];
  if (d.type === 'selection') {
    facts.push(['Source', data.source === 'server' ? 'Server' : 'Your loaded chunks']);
    if (data.unknown) facts.push(['Not loaded', `${fmt.format(data.unknown)} blocks`]);
  }
  const sh = d.type === 'shared' ? a.shared?.find((s) => s.id === d.id) : null;
  const pl = d.type === 'placement' ? a.placements?.find((p) => p.id === d.id) : null;
  const author = sh?.author || pl?.author;
  if (author) facts.push(['Author', author]);
  if (sh) {
    facts.push(['Shared by', sh.mine ? 'You' : sh.ownerName]);
    facts.push(['Dimension', sh.dim.replace('minecraft:', '')]);
    facts.push(['Shared', new Date(sh.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })]);
  }
  h += `<section class="panel"><div class="panel-head"><h3>Overview</h3></div><dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd title="${esc(v)}">${esc(v)}</dd>`).join('')}</dl>`;
  if (pl) {
    const busy = S.busy.has(pl.id);
    h += pl.sharedId
      ? `<div class="btn-row" style="margin:0 0 12px"><button class="btn" data-share-now="${esc(pl.id)}" ${busy ? 'disabled' : ''}>${ICON.share}Update copy</button><button class="btn" data-unshare="${esc(pl.sharedId)}" data-key-of="${esc(pl.id)}">${ICON.stop}Stop sharing</button></div>
         <p class="updated" style="margin:0 0 12px">Shared. Use Update copy after you move or edit the placement.</p>`
      : `<div class="btn-row" style="margin:0 0 6px"><button class="btn primary" data-share-now="${esc(pl.id)}" ${!a.serverMod || busy ? 'disabled' : ''}>${ICON.share}${busy ? 'Sharing…' : 'Share to server'}</button></div>
         <p class="updated" style="margin:0 0 12px">${a.serverMod ? 'Other players can then view it, follow the build from their browser and see who helped.' : 'The server needs Litematica Web Viewer to share schematics.'}</p>`;
  }
  if (sh?.mine)
    h += `<div class="btn-row" style="margin:0 0 12px"><button class="btn" data-unshare="${esc(sh.id)}">${ICON.stop}Stop sharing</button></div>`;
  h += '</section>';
  const shared = sh || (pl?.sharedId && a.shared?.find((s) => s.id === pl.sharedId));
  if (shared) h += contributorsHtml(shared, a.player);

  const q = S.matQuery.toLowerCase();
  const mats = data.mats
    .filter((m) => m.total && (!q || m.name.toLowerCase().includes(q)))
    .sort((x, y) => (S.status ? y.total - y.ok - (x.total - x.ok) : 0) || y.total - x.total);
  h += `<section class="panel"><div class="panel-head"><h3>Materials</h3><button class="link" id="copy-mats" data-tip="Copy as text">${ICON.copy}Copy</button></div>
    <div class="mat-tools"><input class="mat-filter" id="mat-filter" placeholder="Filter ${data.mats.length} materials" value="${esc(S.matQuery)}"></div>
    <div class="mats">${mats
      .slice(0, 300)
      .map((m) => {
        const idx = data.mats.indexOf(m);
        const left = m.total - m.ok;
        const done = S.status && left === 0;
        const sub = S.status ? `${fmt.format(m.ok)} of ${fmt.format(m.total)} placed` : stacks(m.total);
        const count = S.status
          ? done
            ? `<span class="m-done">${ICON.check}</span>`
            : `<b class="num">${fmt.format(left)}</b> left`
          : `<b class="num">${fmt.format(m.total)}</b>`;
        const bar =
          S.status && !done ? `<span class="mini-bar"><i style="width:${(100 * m.ok) / m.total}%"></i></span>` : '';
        return `<button type="button" class="mat${done ? ' done' : ''}" data-mat="${idx}" aria-pressed="${S.iso === idx}"><img alt="" src="${matIcon(m)}"><span class="m-name">${esc(m.name)}${sub ? `<span class="m-sub">${sub}</span>` : ''}</span><span class="m-count">${count}</span>${bar}</button>`;
      })
      .join(
        '',
      )}${mats.length > 300 ? `<div class="mats-more">${mats.length - 300} more. Filter to find them.</div>` : ''}${!mats.length ? '<div class="mats-more">No matching materials</div>' : ''}</div></section>`;

  el.innerHTML = h;
  el.scrollTop = scrollTop;
  const f = $('mat-filter');
  if (f && document.activeElement?.id !== 'mat-filter' && S.matFocus) {
    f.focus();
    f.setSelectionRange(f.value.length, f.value.length);
  }
}

/** Who placed blocks of a shared schematic. The server counts placed blocks that match it, from when it was shared. */
function contributorsHtml(sh, me) {
  const list = Object.entries(sh.contributors || {})
    .map(([uuid, c]) => ({ uuid, ...c }))
    .sort((x, y) => y.placed - x.placed);
  const total = list.reduce((n, c) => n + c.placed, 0);
  let h = `<section class="panel"><div class="panel-head"><h3>Contributors</h3>${total ? `<span class="row-meta num">${fmt.format(total)} placed</span>` : ''}</div>`;
  if (!list.length) {
    return (
      h +
      '<p class="updated" style="margin:0 0 12px">Nobody has placed a block of it yet. Blocks placed by hand count from the moment it was shared.</p></section>'
    );
  }
  h += '<div class="contribs">';
  for (const c of list) {
    const hue = [...c.uuid].reduce((x, ch) => (x * 31 + ch.charCodeAt(0)) % 360, 7);
    const pct = (100 * c.placed) / total;
    // The face is cropped from the player's skin; the initial shows until it loads, or if it can't.
    h += `<div class="contrib"><span class="avatar" style="--h:${hue}" aria-hidden="true">${esc((c.name || '?')[0].toUpperCase())}<i style="--skin:url('api/skin?uuid=${encodeURIComponent(c.uuid)}')"></i></span>
      <span class="c-main"><span class="c-name">${esc(c.name)}${c.name === me ? '<span class="you">you</span>' : ''}</span><span class="c-sub">Active ${ago(c.last)}</span></span>
      <span class="c-count"><b class="num">${fmt.format(c.placed)}</b><span class="c-pct num">${pct < 1 ? '<1' : Math.round(pct)}%</span></span>
      <span class="c-bar"><i style="width:${pct.toFixed(1)}%"></i></span></div>`;
  }
  return (
    h +
    '</div><p class="updated" style="margin:0 0 12px">Counts blocks placed by hand that match the schematic.</p></section>'
  );
}

function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function stacks(n) {
  if (n < 64) return '';
  const s = Math.floor(n / 64),
    r = n % 64;
  return `${s} stack${s > 1 ? 's' : ''}${r ? ` + ${r}` : ''}`;
}

function renderLayers() {
  const data = S.data;
  if (!data) return;
  $('layers').hidden = $('overlay').hidden === false;
  const top = data.size[1] - 1;
  for (const b of $('layer-mode').children) b.setAttribute('aria-checked', String(b.dataset.mode === S.layerMode));
  const sl = $('layer-slider');
  sl.max = String(top);
  sl.value = String(S.layerY);
  const wrap = $('layer-slider-wrap');
  wrap.setAttribute('aria-disabled', String(S.layerMode === 'all'));
  $('layer-value').textContent = `y ${data.origin[1] + S.layerY}`;
  wrap.hidden = top === 0;
}

// ---------------------------------------------------------------- interaction

function setLayer(mode, y) {
  if (!S.data) return;
  const top = S.data.size[1] - 1;
  if (mode) S.layerMode = mode;
  if (y != null) S.layerY = Math.max(0, Math.min(top, y));
  renderLayers();
  remesh();
}

$('layer-mode').addEventListener('click', (e) => {
  const m = e.target.closest('[data-mode]')?.dataset.mode;
  if (m) setLayer(m);
});
$('layer-slider').addEventListener('input', (e) => setLayer(S.layerMode === 'all' ? 'below' : null, +e.target.value));

$('nav').addEventListener('click', (e) => {
  const share = e.target.closest('[data-share]');
  if (share) {
    e.stopPropagation();
    if (share.getAttribute('aria-disabled') === 'true') return;
    const p = S.api.placements.find((x) => x.id === share.dataset.share);
    if (p?.sharedId) open({ type: 'placement', id: p.id });
    else sharePlacement(share.dataset.share);
    return;
  }
  const row = e.target.closest('[data-desc]');
  if (row) {
    open(JSON.parse(row.dataset.desc));
    if (innerWidth <= 900) toggle('sidebar', false);
  }
});
$('nav').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-desc]')) {
    e.preventDefault();
    e.target.click();
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const rows = [...$('nav').querySelectorAll('[data-desc]')];
    const i = rows.indexOf(document.activeElement);
    if (i >= 0) {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
    }
  }
});

$('inspector').addEventListener('click', (e) => {
  const t = e.target;
  const tab = t.closest('[data-tab]')?.dataset.tab;
  if (tab) return setTab(tab);
  if (shaderClick(t)) return;
  const filter = t.closest('[data-filter]')?.dataset.filter;
  if (filter) return setFilter(filter);
  const legend = t.closest('[data-legend]')?.dataset.legend;
  if (legend) return setFilter(legend === '1' ? 'all' : legend === '2' ? 'remaining' : 'problems');
  const mat = t.closest('[data-mat]');
  if (mat) return isolate(+mat.dataset.mat);
  const sn = t.closest('[data-share-now]');
  if (sn) return sharePlacement(sn.dataset.shareNow);
  const us = t.closest('[data-unshare]');
  if (us) return unshare(us.dataset.unshare, us.dataset.keyOf);
  if (t.closest('#copy-mats')) return copyMaterials();
});
$('inspector').addEventListener('change', (e) => {
  if (e.target.id === 'ghosts') {
    S.ghosts = e.target.checked;
    remesh();
  }
  shaderChange(e.target);
});
$('inspector').addEventListener('input', (e) => {
  if (e.target.id === 'mat-filter') {
    S.matQuery = e.target.value;
    S.matFocus = true;
    renderInspector();
  }
  shaderInput(e.target);
});
$('inspector').addEventListener('focusout', (e) => {
  if (e.target.id === 'mat-filter') S.matFocus = false;
  if (e.target.id === 'sh-search') SH.searchFocus = false;
});
$('inspector').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.id === 'sh-search' && e.target.value) {
    e.stopPropagation();
    SH.query = '';
    renderInspector();
  }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.matches('[role="tab"]')) {
    e.preventDefault();
    setTab(SH.tab === 'details' ? 'shaders' : 'details');
    $(`tab-${SH.tab}`)?.focus();
  }
});
$('chips').addEventListener('click', (e) => {
  if (e.target.closest('[data-open-shaders]')) openShaderTab();
});
$('inspector').addEventListener(
  'toggle',
  (e) => {
    if (e.target.matches('details.more')) SH.moreOpen = e.target.open;
  },
  true,
);
$('inspector').addEventListener('mouseover', (e) => {
  const m = e.target.closest('[data-mat]');
  hlUniform.value = m ? +m.dataset.mat : -1;
  needsRender = true;
});
$('inspector').addEventListener('mouseleave', () => {
  hlUniform.value = -1;
  needsRender = true;
});

function setFilter(f) {
  if (!S.status || S.filter === f) return;
  S.filter = f;
  S.pendingFit = true; // a filter can leave a handful of blocks; frame them
  renderInspector();
  remesh();
}
function isolate(idx) {
  S.iso = S.iso === idx ? -1 : idx;
  S.pendingFit = true;
  renderInspector();
  remesh();
  if (S.iso >= 0) toast(`Showing only ${S.data.mats[idx].name}`, 'Press Esc to show everything');
}

async function sharePlacement(id) {
  if (S.busy.has(id)) return;
  const p = S.api.placements.find((x) => x.id === id);
  S.busy.add(id);
  renderNav();
  renderInspector();
  try {
    await api(`api/share?id=${encodeURIComponent(id)}`, { method: 'POST' });
    toast(
      p?.sharedId ? 'Shared copy updated' : `Shared “${p?.name ?? 'placement'}”`,
      'Players on this server can now follow the build.',
    );
  } catch (err) {
    toast("Couldn't share", err.message, { error: true });
  } finally {
    S.busy.delete(id);
    renderNav();
    renderInspector();
  }
}
async function unshare(sharedId, placementId) {
  try {
    await api(`api/unshare?id=${encodeURIComponent(sharedId)}`, { method: 'POST' });
    const pid = placementId || S.api.placements?.find((p) => p.sharedId === sharedId)?.id;
    if (pid && S.desc?.type === 'shared' && S.desc.id === sharedId) open({ type: 'placement', id: pid });
    toast(
      'Stopped sharing',
      'Other players can no longer see it.',
      pid ? { action: 'Undo', run: () => sharePlacement(pid) } : {},
    );
  } catch (err) {
    toast("Couldn't stop sharing", err.message, { error: true });
  }
}

function copyMaterials() {
  const d = S.data;
  const rows = d.mats
    .filter((m) => m.total)
    .sort((a, b) => b.total - a.total)
    .map((m) =>
      S.status ? `${m.name}\t${m.total - m.ok} left\t${m.ok}/${m.total}` : `${m.name}\t${m.total}\t${stacks(m.total)}`,
    );
  navigator.clipboard.writeText(rows.join('\n')).then(
    () => toast('Copied material list', `${rows.length} materials`),
    () => toast("Couldn't copy", 'The browser blocked clipboard access', { error: true }),
  );
}

function screenshot() {
  if (!S.data) return;
  const shaded = shaderOn();
  if (shaded) renderIris(performance.now());
  else renderer.render(scene, camera);
  (shaded ? $('gl-iris') : canvas).toBlob((blob) => {
    const a = document.createElement('a');
    const name = (S.data.name || S.api?.shared?.find((s) => s.id === S.desc.id)?.name || 'view').replace(
      /[^\w-]+/g,
      '_',
    );
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Screenshot saved', `${name}.png`);
  });
}

function toggle(which, force) {
  const app = $('app');
  const cls = which === 'sidebar' ? 'no-sidebar' : 'no-inspector';
  const show = force ?? app.classList.contains(cls);
  app.classList.toggle(cls, !show);
  try {
    localStorage.setItem(`litweb.${which}`, show ? '1' : '0');
  } catch {}
  $(which === 'sidebar' ? 'toggle-sidebar' : 'toggle-inspector').setAttribute('aria-pressed', String(show));
  setTimeout(resize, 200);
}

$('toggle-sidebar').addEventListener('click', () => toggle('sidebar'));
$('toggle-inspector').addEventListener('click', () => toggle('inspector'));
$('act-refresh').addEventListener('click', () => S.desc && open(S.desc, { force: true }));
$('act-fit').addEventListener('click', fit);
$('act-shot').addEventListener('click', screenshot);
$('act-shaders').addEventListener('click', () => setShaderEnabled(!SH.settings.enabled));
$('open-palette').addEventListener('click', () => openPalette(''));

// ---- picking: walk the voxel grid along the mouse ray (fast, no triangle raycast)

const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
let pickQueued = false,
  lastMouse = null,
  downAt = null;
canvas.addEventListener('pointermove', (e) => {
  lastMouse = e;
  if (!pickQueued) {
    pickQueued = true;
    requestAnimationFrame(pick);
  }
});
canvas.addEventListener('pointerleave', () => {
  lastMouse = null;
  hideHover();
});
canvas.addEventListener('pointerdown', (e) => {
  downAt = [e.clientX, e.clientY];
  hideHint();
});
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || e.button !== 0) return;
  const hit = voxelAt(e);
  if (hit) isolate(S.data.palette[S.data.blocks16[hit.i]].mid);
  else if (S.iso >= 0) isolate(S.iso);
});
canvas.addEventListener('wheel', hideHint, { passive: true });

function voxelAt(e) {
  if (!S.data || !S.vis) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const { origin: o, direction: d } = ray.ray;
  const [sx, sy, sz] = S.data.size;
  // Clip the ray to the volume box, then step voxel by voxel.
  let t0 = 0,
    t1 = Infinity;
  const lo = [0, 0, 0],
    hi = [sx, sy, sz],
    O = [o.x, o.y, o.z],
    D = [d.x, d.y, d.z];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(D[k]) < 1e-9) {
      if (O[k] < lo[k] || O[k] > hi[k]) return null;
      continue;
    }
    let a = (lo[k] - O[k]) / D[k],
      b = (hi[k] - O[k]) / D[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  if (t0 > t1) return null;
  const p = [O[0] + D[0] * (t0 + 1e-4), O[1] + D[1] * (t0 + 1e-4), O[2] + D[2] * (t0 + 1e-4)];
  const v = p.map((x, k) => Math.min(hi[k] - 1, Math.max(0, Math.floor(x))));
  const step = D.map((x) => (x > 0 ? 1 : -1));
  const tMax = D.map((x, k) => (Math.abs(x) < 1e-9 ? Infinity : ((x > 0 ? v[k] + 1 : v[k]) - p[k]) / x));
  const tDelta = D.map((x) => (Math.abs(x) < 1e-9 ? Infinity : Math.abs(1 / x)));
  for (let n = 0; n < sx + sy + sz + 3; n++) {
    const i = (v[1] * sz + v[2]) * sx + v[0];
    if (S.vis[i]) return { x: v[0], y: v[1], z: v[2], i };
    const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    v[k] += step[k];
    if (v[k] < 0 || v[k] >= hi[k]) return null;
    tMax[k] += tDelta[k];
  }
  return null;
}

function pick() {
  pickQueued = false;
  if (!lastMouse || lastMouse.buttons) {
    hideHover();
    return;
  }
  const hit = voxelAt(lastMouse);
  if (!hit) {
    hideHover();
    return;
  }
  const d = S.data;
  const e = d.palette[d.blocks16[hit.i]];
  cursor.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  cursor.visible = true;
  S.hover = [hit.x, hit.y, hit.z];
  needsRender = true;
  const st = S.status ? S.status[hit.i] : 0;
  const card = $('hover');
  const props = e.p
    ? e.p
        .split(',')
        .filter((x) => !x.startsWith('waterlogged=false'))
        .join('  ')
    : '';
  card.innerHTML = `<div class="hc-title"><img alt="" src="${matIcon(d.mats[e.mid])}" width="16" height="16" style="image-rendering:pixelated">${esc(pretty(e.n))}</div>
    ${props ? `<div class="hc-sub">${esc(props)}</div>` : ''}
    <div class="hc-pos">${d.origin[0] + hit.x}, ${d.origin[1] + hit.y}, ${d.origin[2] + hit.z}</div>
    ${st ? `<div class="hc-status"><span class="sw" style="width:8px;height:8px;border-radius:2px;background:${STATUS[st].color}"></span>${STATUS[st].label}</div>` : ''}`;
  card.hidden = false;
  const r = $('stage').getBoundingClientRect();
  const x = lastMouse.clientX - r.left,
    y = lastMouse.clientY - r.top;
  const w = card.offsetWidth,
    h = card.offsetHeight;
  card.style.left = `${Math.min(r.width - w - 8, x + 16)}px`;
  card.style.top = `${y + 16 + h > r.height ? y - h - 12 : y + 16}px`;
}
function hideHover() {
  $('hover').hidden = true;
  S.hover = null;
  if (cursor.visible) {
    cursor.visible = false;
    needsRender = true;
  }
}
function hideHint() {
  const h = $('hint');
  if (h.style.opacity !== '0') {
    h.style.opacity = '0';
    try {
      localStorage.setItem('litweb.hint', '0');
    } catch {}
  }
}

// ---------------------------------------------------------------- shaders (Iris packs in WebGL2)

const SH = {
  list: null, // /api/shaders: installed packs, saved settings, featured packs
  settings: { enabled: false, pack: null, time: 2500, rain: 0, scale: 1, options: {} },
  status: 'off', // off | compiling | ready | error
  error: null,
  errors: [],
  live: false,
  meshReady: false,
  schema: [],
  lang: {},
  values: {},
  props: {},
  locked: {},
  sliders: new Set(),
  byName: new Map(),
  screen: [],
  query: '',
  searchFocus: false,
  installing: new Set(),
  featured: null,
  tab: 'details',
};
let iris = null;
try {
  iris = new Iris($('gl-iris'));
  if (!iris.supported) iris = null;
} catch {
  iris = null;
}
if (iris)
  iris.onLost = () => {
    SH.status = 'error';
    SH.error = 'The graphics driver reset the shader view. Reload the page to use shaders again.';
    SH.live = false;
    syncShaderView();
    renderInspector();
  };

const shaderWanted = () => !!iris && SH.settings.enabled && SH.live;
function shaderOn() {
  return shaderWanted() && SH.meshReady && !!S.data && !iris.lost && $('overlay').hidden;
}
const packName = (id) => SH.list?.packs.find((p) => p.id === id)?.name || String(id || '').replace(/\.zip$/i, '');

function renderIris(now) {
  const r = $('stage').getBoundingClientRect();
  if (!r.width || !r.height) return;
  const c = $('gl-iris');
  const scale = Math.min(devicePixelRatio, 1.5) * SH.settings.scale; // heavy packs at full retina resolution are too slow
  const W = Math.max(1, Math.round(r.width * scale)),
    H = Math.max(1, Math.round(r.height * scale));
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  camera.updateMatrixWorld(); // three only does this inside renderer.render, which shader mode skips
  const dt = (now - (renderIris.last || now)) / 1000;
  renderIris.last = now;
  const [sx, sy, sz] = S.data.size;
  iris.render({
    view: camera.matrixWorldInverse.elements,
    fov: THREE.MathUtils.degToRad(camera.fov),
    aspect: W / H,
    cam: camera.position.toArray(),
    target: controls.target.toArray(),
    origin: S.data.origin,
    radius: Math.hypot(sx, sy, sz) / 2,
    worldTime: SH.settings.time,
    rain: SH.settings.rain,
    dt,
    ghosts: !!S.status && S.ghosts,
    hover: S.hover,
    width: W,
    height: H,
  });
  $('compass').firstElementChild.style.transform = `translateX(-50%) rotate(${controls.getAzimuthalAngle()}rad)`;
}

function syncShaderView() {
  const on = shaderOn();
  $('gl-iris').hidden = !on;
  if (!on) needsRender = true;
  const pill = $('shader-pill');
  const showPill = !!S.data && SH.settings.enabled && SH.status === 'compiling';
  pill.hidden = !showPill;
  if (showPill)
    pill.innerHTML = `<span class="spinner xs"></span>Compiling ${esc(packName(SH.settings.pack))} for the browser…`;
  renderTop();
}

async function loadShaderIndex() {
  try {
    SH.list = await api('api/shaders');
    Object.assign(SH.settings, SH.list.settings || {});
    SH.settings.options ||= {};
    if (SH.settings.pack && !SH.list.packs.some((p) => p.id === SH.settings.pack)) {
      SH.settings.pack = null;
      SH.settings.enabled = false;
    }
    if (SH.settings.enabled && SH.settings.pack && iris) compileShaders();
  } catch {
    SH.list = SH.list || { packs: [], featured: [], dir: '' };
  }
  if (SH.tab === 'shaders') loadFeatured();
  renderShaderBits();
}

async function loadFeatured() {
  if (SH.featured) return;
  SH.featured = { loading: true, list: SH.list?.featured || [] };
  try {
    const r = await api('api/shaders/featured');
    SH.featured = { list: r.featured.length ? r.featured : SH.list?.featured || [], offline: r.offline };
  } catch {
    SH.featured = { list: SH.list?.featured || [], offline: true };
  }
  renderShaderBits();
}

function renderShaderBits() {
  syncShaderView();
  if (SH.tab === 'shaders') renderInspector();
  else renderInspectorTabsOnly();
}
function renderInspectorTabsOnly() {
  const dot = document.querySelector('#tab-shaders');
  if (dot) dot.innerHTML = `Shaders${SH.settings.enabled ? '<span class="tab-dot" aria-label="on"></span>' : ''}`;
}

let compileSeq = 0;
async function compileShaders() {
  const id = SH.settings.pack;
  if (!iris || !id) return;
  const seq = ++compileSeq;
  SH.status = 'compiling';
  SH.error = null;
  renderShaderBits();
  try {
    const body = { pack: id };
    if (SH.settings.options[id]) body.options = SH.settings.options[id];
    const res = await api('api/shaders/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (seq !== compileSeq) return;
    if (
      !(await iris.setPack(
        res,
        (path) => loadPackImage(id, path),
        () => seq === compileSeq,
      ))
    )
      return;
    SH.schema = res.options;
    SH.byName = new Map(res.options.map((o) => [o.n, o]));
    SH.values = Object.fromEntries(res.options.map((o) => [o.n, o.v]));
    SH.lang = res.lang || {};
    SH.props = res.props || {};
    SH.locked = res.locked || {};
    SH.sliders = new Set((SH.props.sliders || '').trim().split(/\s+/));
    SH.blocks = res.blocks || {};
    SH.errors = iris.errors;
    SH.status = 'ready';
    SH.live = true;
    sendEnt();
    remesh();
  } catch (err) {
    if (seq !== compileSeq) return;
    SH.status = 'error';
    SH.error = err.message;
    toast(`Couldn't load ${packName(id)}`, err.message, { error: true });
  }
  renderShaderBits();
}

function loadPackImage(pack, path) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = `api/shaders/file?pack=${encodeURIComponent(pack)}&path=${encodeURIComponent(path)}`;
  });
}

/** mc_Entity ids for the view's palette, from the pack's block.properties. */
function sendEnt() {
  if (!S.data || !SH.blocks) return;
  const ent = new Float32Array(S.data.palette.length).fill(-1);
  S.data.palette.forEach((e, i) => {
    const rules = e && !e.air && SH.blocks[e.n];
    if (!rules) return;
    const props = Object.fromEntries(
      (e.p || '')
        .split(',')
        .filter(Boolean)
        .map((kv) => kv.split('=')),
    );
    const hit = rules.find(([, st]) => Object.entries(st).every(([k, vals]) => vals.includes(props[k])));
    if (hit) ent[i] = hit[0];
  });
  worker.postMessage({ type: 'ent', ent });
}

let saveTimer = 0;
function saveShaderSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('api/shaders/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SH.settings),
    }).catch(() => {});
  }, 400);
}

function setShaderEnabled(on) {
  if (!S.data) return;
  if (on && !iris) {
    toast("This browser can't run shader packs", 'It needs WebGL 2 with floating-point render targets.', {
      error: true,
    });
    return;
  }
  SH.settings.enabled = on;
  saveShaderSettings();
  if (on && !SH.settings.pack) {
    openShaderTab();
    toast('Pick a shader pack', 'Choose one you have, or get a popular one.');
  } else if (on && !SH.live && SH.status !== 'compiling') compileShaders();
  remesh();
  renderShaderBits();
}

function openShaderTab() {
  if ($('app').classList.contains('no-inspector')) toggle('inspector', true);
  setTab('shaders');
}

function setTab(t) {
  SH.tab = t;
  try {
    localStorage.setItem('litweb.tab', t);
  } catch {}
  if (t === 'shaders') loadFeatured();
  renderInspector();
}

function selectPack(id) {
  if (!iris) return;
  const changed = id !== SH.settings.pack;
  SH.settings.pack = id;
  SH.settings.enabled = true;
  SH.screen = [];
  SH.query = '';
  saveShaderSettings();
  if (changed || !SH.live) compileShaders();
  remesh();
  renderShaderBits();
}

async function installPack(slug) {
  if (SH.installing.has(slug)) return;
  const f = (SH.featured?.list || SH.list?.featured || []).find((x) => x.slug === slug);
  SH.installing.add(slug);
  renderShaderBits();
  try {
    const r = await api(`api/shaders/install?slug=${encodeURIComponent(slug)}`, { method: 'POST' });
    SH.list = await api('api/shaders');
    toast(`${f?.name || 'Pack'} installed`, 'Saved to your shaderpacks folder, so Iris can use it too.');
    selectPack(r.id);
  } catch (err) {
    toast(`Couldn't get ${f?.name || 'the pack'}`, err.message, {
      error: true,
      action: 'Retry',
      run: () => installPack(slug),
    });
  } finally {
    SH.installing.delete(slug);
    renderShaderBits();
  }
}

let compileTimer = 0;
function setOptions(changes) {
  const id = SH.settings.pack;
  Object.assign(SH.values, changes);
  // Store only what differs from the pack's defaults.
  SH.settings.options[id] = Object.fromEntries(
    SH.schema.filter((o) => SH.values[o.n] !== o.d).map((o) => [o.n, SH.values[o.n]]),
  );
  saveShaderSettings();
  clearTimeout(compileTimer);
  compileTimer = setTimeout(compileShaders, 350);
  renderInspector();
}

function setShaderScene(changes) {
  Object.assign(SH.settings, changes);
  saveShaderSettings();
  if ('scale' in changes) renderIris.last = 0;
  renderInspector();
}

// ---- pack settings: labels, screens and profiles from the pack's own files

const stripFmt = (s) => String(s).replace(/§./g, '').trim();
const L = (key, fallback) => (SH.lang[key] != null && SH.lang[key] !== '' ? stripFmt(SH.lang[key]) : fallback);
const humanize = (n) =>
  n
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
const optLabel = (n) => L(`option.${n}`, humanize(n));
const screenLabel = (n) => L(`screen.${n}`, humanize(n));
function valLabel(n, v) {
  if (v === 'true') return 'On';
  if (v === 'false') return 'Off';
  const named = L(`value.${n}.${v}`, null);
  return named ?? `${L(`prefix.${n}`, '')}${v}${L(`suffix.${n}`, '')}`;
}

function profiles() {
  return Object.keys(SH.props)
    .filter((k) => k.startsWith('profile.'))
    .map((k) => k.slice(8))
    .map((name) => ({ name, label: L(`profile.${name}`, humanize(name)) }));
}
function profileValues(name, depth = 0) {
  const out = {};
  const def = SH.props[`profile.${name}`];
  if (!def || depth > 8) return out;
  for (const t of def.trim().split(/\s+/)) {
    if (!t) continue;
    if (t.startsWith('profile.')) Object.assign(out, profileValues(t.slice(8), depth + 1));
    else if (t.startsWith('!')) out[t.slice(1)] = 'false';
    else if (/[=:]/.test(t)) {
      const i = t.search(/[=:]/);
      out[t.slice(0, i)] = t.slice(i + 1);
    } else out[t] = 'true';
  }
  return out;
}
const sameValue = (n, a, b) =>
  a === b || (SH.byName.get(n)?.t === 'v' && Number(a) === Number(b) && a !== '' && b !== '');
function currentProfile() {
  let best = null,
    size = -1;
  for (const p of profiles()) {
    const vals = Object.entries(profileValues(p.name)).filter(([n]) => SH.byName.has(n) && !(n in SH.locked));
    if (vals.every(([n, v]) => sameValue(n, SH.values[n], v)) && vals.length > size) {
      best = p.name;
      size = vals.length;
    }
  }
  return best;
}
function applyProfile(name) {
  const changes = Object.fromEntries(SH.schema.map((o) => [o.n, o.d]));
  for (const [n, v] of Object.entries(profileValues(name))) {
    const o = SH.byName.get(n);
    if (!o) continue;
    changes[n] = o.t === 'v' ? (o.vals.find((x) => sameValue(n, x, v)) ?? v) : v;
  }
  setOptions(changes);
}

function screenTokens(name) {
  const raw = name ? SH.props[`screen.${name}`] : SH.props.screen;
  return raw == null ? null : raw.trim().split(/\s+/).filter(Boolean);
}
/** Screen entries: sub-screen links and options. `*` means every option no screen lists. */
function screenItems(name) {
  const toks = screenTokens(name);
  if (!toks) return name ? [] : SH.schema.map((o) => ({ opt: o }));
  const out = [];
  for (const t of toks) {
    if (t === '<empty>' || t === '<profile>') continue;
    const m = /^\[(\w+)\]$/.exec(t);
    if (m) {
      if (SH.props[`screen.${m[1]}`] != null) out.push({ screen: m[1] });
      continue;
    }
    if (t === '*') {
      const listed = listedOptions();
      for (const o of SH.schema) if (!listed.has(o.n)) out.push({ opt: o });
      continue;
    }
    const o = SH.byName.get(t);
    if (o) out.push({ opt: o });
  }
  return out;
}
function listedOptions() {
  const s = new Set();
  for (const [k, v] of Object.entries(SH.props))
    if (k === 'screen' || /^screen\.\w+$/.test(k)) for (const t of v.split(/\s+/)) s.add(t);
  return s;
}
/** Where an option lives, for search results: "Lighting › Shadows". */
function optionPath(n) {
  const parents = {};
  for (const [k, v] of Object.entries(SH.props)) {
    const m = /^screen\.(\w+)$/.exec(k);
    if (m)
      for (const t of v.split(/\s+/)) {
        const sub = /^\[(\w+)\]$/.exec(t);
        parents[sub ? `[${sub[1]}` : t] ??= m[1];
      }
  }
  const path = [];
  let cur = parents[n];
  for (let i = 0; cur && i < 6; i++) {
    path.unshift(screenLabel(cur));
    cur = parents[`[${cur}`];
  }
  return path.join(' › ');
}

function optRow(o, showPath) {
  const v = SH.values[o.n] ?? o.d;
  if (o.n in SH.locked) {
    // The pack itself switches this off where it can't work (here: no compute shaders or image storage in WebGL).
    return `<div class="opt locked"><span class="opt-text"><span class="opt-label" title="${esc(o.n)}">${esc(optLabel(o.n))}</span><span class="opt-sub">Not available in the browser</span></span><span class="opt-static">${esc(valLabel(o.n, SH.locked[o.n]))}</span></div>`;
  }
  const label = optLabel(o.n);
  let comment = L(`option.${o.n}.comment`, o.c || '');
  if (comment.replace(/[.\s]+$/, '').toLowerCase() === label.toLowerCase()) comment = ''; // a comment that only repeats the label
  const mod = v !== o.d;
  const sub = showPath ? optionPath(o.n) : comment;
  let ctl;
  if (o.t === 'b')
    ctl = `<button type="button" class="switch" role="switch" aria-checked="${v === 'true'}" aria-label="${esc(label)}" data-opt-toggle="${esc(o.n)}"></button>`;
  else if (o.vals.length <= 1) ctl = `<span class="opt-static">${esc(valLabel(o.n, v))}</span>`;
  else if (SH.sliders.has(o.n)) {
    const i = Math.max(0, o.vals.indexOf(v));
    ctl = `<span class="opt-range"><input type="range" min="0" max="${o.vals.length - 1}" value="${i}" step="1" aria-label="${esc(label)}" aria-valuetext="${esc(valLabel(o.n, v))}" data-opt-range="${esc(o.n)}"><output>${esc(valLabel(o.n, v))}</output></span>`;
  } else
    ctl = `<select class="opt-select" aria-label="${esc(label)}" data-opt-select="${esc(o.n)}">${o.vals.map((x) => `<option value="${esc(x)}"${x === v ? ' selected' : ''}>${esc(valLabel(o.n, x))}</option>`).join('')}</select>`;
  const reset = mod
    ? `<button type="button" class="opt-reset" data-opt-reset="${esc(o.n)}" aria-label="Reset ${esc(label)}" data-tip="Reset to ${esc(valLabel(o.n, o.d))}">${ICON.retry}</button>`
    : '';
  return `<div class="opt${mod ? ' mod' : ''}${SH.sliders.has(o.n) && o.vals.length > 1 ? ' wide' : ''}">
    <span class="opt-text"><span class="opt-label" title="${esc(o.n)}">${esc(label)}</span>${sub ? `<span class="opt-sub">${esc(sub)}</span>` : ''}</span>${reset}${ctl}</div>`;
}

function timeLabel(t) {
  const h = Math.floor((t / 1000 + 6) % 24),
    m = Math.floor(((t % 1000) / 1000) * 60);
  const part =
    t < 1000 || t >= 23000
      ? 'Sunrise'
      : t < 5000
        ? 'Morning'
        : t < 7000
          ? 'Noon'
          : t < 11500
            ? 'Afternoon'
            : t < 13000
              ? 'Sunset'
              : 'Night';
  return `${h}:${String(m).padStart(2, '0')} · ${part}`;
}

function renderShaders() {
  let h = '';
  const st = SH.settings,
    packs = SH.list?.packs || [];
  const name = st.pack ? packName(st.pack) : '';
  let lead;
  if (!iris)
    lead = `<span class="sh-bad">This browser can't run shader packs. It needs WebGL 2 with floating-point render targets.</span>`;
  else if (!st.pack) lead = 'Pick a pack below. It runs right here in the page, using the same packs as Iris.';
  else if (SH.status === 'compiling') lead = `<span class="spinner xs"></span>Compiling ${esc(name)}…`;
  else if (SH.status === 'error')
    lead = `<span class="sh-bad">${esc(SH.error)}</span> <button type="button" class="link" data-sh="retry">${ICON.retry}Try again</button>`;
  else if (SH.status === 'ready') {
    lead = st.enabled ? `Running <b>${esc(name)}</b>.` : `<b>${esc(name)}</b> is ready. Turn shaders on to see it.`;
    if (SH.errors.length)
      lead += ` <button type="button" class="link warn" data-sh="problems">${SH.errors.length} ${SH.errors.length === 1 ? 'effect' : 'effects'} unavailable</button>`;
  } else lead = `<b>${esc(name)}</b> is selected.`;
  h += `<section class="panel"><div class="panel-head"><h3>Shaders</h3><button type="button" class="switch" role="switch" aria-checked="${!!st.enabled}" aria-label="Use shaders" data-sh="toggle" ${iris ? '' : 'disabled'} data-tip="Shaders" data-key="V"></button></div>
    <p class="sh-lead">${lead}</p></section>`;

  h += `<section class="panel"><div class="panel-head"><h3>Your packs</h3><button type="button" class="link" data-sh="folder" data-tip="${esc(SH.list?.dir || '')}">${ICON.folder}Open folder</button></div>`;
  h += packs.length
    ? `<div class="packs" role="radiogroup" aria-label="Shader pack">${packs.map((p) => `<button type="button" class="pack" role="radio" aria-checked="${p.id === st.pack}" data-pack="${esc(p.id)}" ${iris ? '' : 'disabled'}><span class="pack-dot"></span><span class="pack-name">${esc(p.name)}</span>${p.id === st.pack && SH.status === 'compiling' ? '<span class="spinner xs"></span>' : ''}</button>`).join('')}</div>`
    : `<div class="nav-empty">No packs yet. Get a popular one below, or put .zip packs in your shaderpacks folder.</div>`;
  h += '</section>';

  const have = new Set(packs.map((p) => p.slug).filter(Boolean));
  const feat = (SH.featured?.list || SH.list?.featured || []).filter((f) => !have.has(f.slug));
  if (feat.length) {
    // Collapsed once you have packs, so the pack's settings stay close to the top.
    const head = `<h3>${packs.length ? `Get more packs` : 'Popular packs'}</h3><span class="row-meta">${SH.featured?.offline ? 'Modrinth is unreachable' : 'From Modrinth'}</span>`;
    h += packs.length
      ? `<section class="panel"><details class="more"${SH.moreOpen ? ' open' : ''}><summary class="panel-head">${head}</summary><div class="feats">`
      : `<section class="panel"><div class="panel-head">${head}</div><div class="feats">`;
    for (const f of feat) {
      const busy = SH.installing.has(f.slug);
      const dl = f.downloads
        ? `${new Intl.NumberFormat([], { notation: 'compact' }).format(f.downloads)} downloads`
        : '';
      h += `<div class="feat">${f.icon ? `<img alt="" src="${esc(f.icon)}" loading="lazy">` : `<span class="feat-icon">${ICON.sparkle}</span>`}
        <span class="feat-main"><span class="feat-name">${esc(f.name)}</span><span class="feat-sub">${esc(f.author)}${dl ? ` · ${dl}` : ''}</span></span>
        <button type="button" class="btn sm" data-install="${esc(f.slug)}" ${busy || !iris ? 'disabled' : ''}>${busy ? '<span class="spinner xs"></span>Getting…' : `${ICON.download}Get`}</button></div>`;
    }
    h += packs.length ? '</div></details></section>' : '</div></section>';
  }

  if (st.pack && SH.status !== 'error' && iris) {
    h += `<section class="panel"><div class="panel-head"><h3>Scene</h3></div>
      <div class="sh-field"><span>Time of day</span><output id="sh-time-out">${esc(timeLabel(st.time))}</output></div>
      <div class="sh-time">${ICON.sun}<input type="range" id="sh-time" min="0" max="23900" step="100" value="${st.time}" aria-label="Time of day" aria-valuetext="${esc(timeLabel(st.time))}">${ICON.moon}</div>
      <div class="sh-field"><span>Weather</span><span class="seg flat" role="radiogroup" aria-label="Weather">${[
        [0, 'Clear'],
        [1, 'Rain'],
      ]
        .map(
          ([v, l]) =>
            `<button type="button" role="radio" aria-checked="${st.rain === v}" data-rain="${v}">${l}</button>`,
        )
        .join('')}</span></div>
      <div class="sh-field"><span>Resolution</span><span class="seg flat" role="radiogroup" aria-label="Resolution">${[
        [0.5, '50%'],
        [0.75, '75%'],
        [1, '100%'],
      ]
        .map(
          ([v, l]) =>
            `<button type="button" role="radio" aria-checked="${st.scale === v}" data-scale="${v}">${l}</button>`,
        )
        .join('')}</span></div>
    </section>`;
  }

  if (st.pack && SH.status !== 'error' && SH.schema.length) {
    const modified = SH.schema.filter((o) => SH.values[o.n] !== o.d).length;
    const profs = profiles();
    const cur = profs.length ? currentProfile() : null;
    h += `<section class="panel"><div class="panel-head"><h3>Pack settings</h3>${modified ? `<button type="button" class="link" data-sh="reset" data-tip="Back to the pack's defaults">${ICON.retry}Reset ${modified}</button>` : ''}</div>`;
    if (profs.length > 5) {
      h += `<div class="sh-field"><span>Profile</span><select class="opt-select" id="sh-profile" aria-label="Profile">${cur ? '' : '<option value="" selected>Custom</option>'}${profs.map((p) => `<option value="${esc(p.name)}"${p.name === cur ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>`;
    } else if (profs.length) {
      h += `<div class="sh-field"><span>Profile</span>${cur ? '' : '<span class="chip">Custom</span>'}</div>
        <div class="seg flat profiles" role="radiogroup" aria-label="Profile">${profs.map((p) => `<button type="button" role="radio" aria-checked="${p.name === cur}" data-profile="${esc(p.name)}">${esc(p.label)}</button>`).join('')}</div>`;
    }
    h += `<div class="mat-tools"><input class="mat-filter" id="sh-search" type="search" placeholder="Search ${SH.schema.length} settings" value="${esc(SH.query)}" aria-label="Search pack settings"></div>`;
    const q = SH.query.trim().toLowerCase();
    if (q) {
      const hits = SH.schema.filter((o) =>
        `${optLabel(o.n)} ${o.n} ${L(`option.${o.n}.comment`, '')}`.toLowerCase().includes(q),
      );
      h += hits.length
        ? `<div class="opts">${hits
            .slice(0, 60)
            .map((o) => optRow(o, true))
            .join(
              '',
            )}</div>${hits.length > 60 ? `<div class="mats-more">${hits.length - 60} more. Keep typing to narrow it down.</div>` : ''}`
        : '<div class="mats-more">No settings match.</div>';
    } else {
      const path = SH.screen;
      if (path.length) {
        h += `<nav class="sh-crumbs" aria-label="Settings screens"><button type="button" class="link" data-screen-up="0">${ICON.back}All</button>${path.map((s, i) => `<span class="sep">›</span>${i === path.length - 1 ? `<b>${esc(screenLabel(s))}</b>` : `<button type="button" class="link" data-screen-up="${i + 1}">${esc(screenLabel(s))}</button>`}`).join('')}</nav>`;
      }
      const items = screenItems(path[path.length - 1] || '');
      h += `<div class="opts">${
        items
          .map((it) =>
            it.screen
              ? `<button type="button" class="opt opt-link" data-screen="${esc(it.screen)}"><span class="opt-text"><span class="opt-label">${esc(screenLabel(it.screen))}</span>${L(`screen.${it.screen}.comment`, '') ? `<span class="opt-sub">${esc(L(`screen.${it.screen}.comment`, ''))}</span>` : ''}</span>${ICON.chevron}</button>`
              : optRow(it.opt, false),
          )
          .join('') || '<div class="mats-more">This screen is empty.</div>'
      }</div>`;
    }
    h += '</section>';
  }

  if (SH.errors.length && SH.status === 'ready') {
    h += `<section class="panel" id="sh-problems"><div class="panel-head"><h3>Unavailable in the browser</h3><span class="row-meta">${SH.errors.length}</span></div>
      <p class="sh-lead">The pack still runs without these parts of it. Usually that means a missing effect, like colored lighting.</p>
      <div class="problems">${SH.errors.map((e) => `<div class="problem"><code>${esc(e.program)}</code><span>${esc(e.message)}</span></div>`).join('')}</div></section>`;
  }
  return h;
}

function shaderClick(t) {
  const sh = t.closest('[data-sh]')?.dataset.sh;
  if (sh === 'toggle') {
    setShaderEnabled(!SH.settings.enabled);
    return true;
  }
  if (sh === 'retry') {
    compileShaders();
    return true;
  }
  if (sh === 'folder') {
    api('api/shaders/open-folder', { method: 'POST' }).catch((e) =>
      toast("Couldn't open the folder", e.message, { error: true }),
    );
    return true;
  }
  if (sh === 'reset') {
    setOptions(Object.fromEntries(SH.schema.map((o) => [o.n, o.d])));
    toast('Pack settings reset', 'Back to the defaults.');
    return true;
  }
  if (sh === 'problems') {
    $('sh-problems')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }
  const pack = t.closest('[data-pack]')?.dataset.pack;
  if (pack) {
    selectPack(pack);
    return true;
  }
  const inst = t.closest('[data-install]')?.dataset.install;
  if (inst) {
    installPack(inst);
    return true;
  }
  const rain = t.closest('[data-rain]')?.dataset.rain;
  if (rain != null) {
    setShaderScene({ rain: +rain });
    return true;
  }
  const scale = t.closest('[data-scale]')?.dataset.scale;
  if (scale != null) {
    setShaderScene({ scale: +scale });
    return true;
  }
  const prof = t.closest('[data-profile]')?.dataset.profile;
  if (prof) {
    applyProfile(prof);
    return true;
  }
  const scr = t.closest('[data-screen]')?.dataset.screen;
  if (scr) {
    SH.screen = [...SH.screen, scr];
    renderInspector();
    $('inspector').querySelector('.sh-crumbs .link')?.focus();
    return true;
  }
  const up = t.closest('[data-screen-up]')?.dataset.screenUp;
  if (up != null) {
    SH.screen = SH.screen.slice(0, +up);
    renderInspector();
    return true;
  }
  const tog = t.closest('[data-opt-toggle]')?.dataset.optToggle;
  if (tog) {
    setOptions({ [tog]: SH.values[tog] === 'true' ? 'false' : 'true' });
    return true;
  }
  const rs = t.closest('[data-opt-reset]')?.dataset.optReset;
  if (rs) {
    setOptions({ [rs]: SH.byName.get(rs).d });
    return true;
  }
  return false;
}

function shaderChange(t) {
  if (t.dataset.optSelect) setOptions({ [t.dataset.optSelect]: t.value });
  if (t.dataset.optRange) setOptions({ [t.dataset.optRange]: SH.byName.get(t.dataset.optRange).vals[+t.value] });
  if (t.id === 'sh-time') setShaderScene({ time: +t.value });
  if (t.id === 'sh-profile' && t.value) applyProfile(t.value);
}

function shaderInput(t) {
  if (t.id === 'sh-search') {
    SH.query = t.value;
    SH.searchFocus = true;
    renderInspector();
    return;
  }
  if (t.id === 'sh-time') {
    SH.settings.time = +t.value; // live while dragging; saved on change
    const l = timeLabel(+t.value);
    $('sh-time-out').textContent = l;
    t.setAttribute('aria-valuetext', l);
  }
  if (t.dataset.optRange) {
    const n = t.dataset.optRange,
      l = valLabel(n, SH.byName.get(n).vals[+t.value]);
    t.nextElementSibling.textContent = l;
    t.setAttribute('aria-valuetext', l);
  }
}

// ---------------------------------------------------------------- command palette

const COMMANDS = () => {
  const has = !!S.data,
    st = !!S.status;
  const pl = S.desc?.type === 'placement' ? S.api?.placements?.find((p) => p.id === S.desc.id) : null;
  return [
    has && { title: 'Fit to view', key: 'F', run: fit },
    has && { title: 'Reload view', key: 'R', run: () => open(S.desc, { force: true }) },
    has && { title: 'Save screenshot', key: 'S', run: screenshot },
    has && { title: 'Layers: show all', key: 'L', run: () => setLayer('all') },
    has && { title: 'Layers: up to current layer', run: () => setLayer('below') },
    has && { title: 'Layers: single layer', run: () => setLayer('single') },
    st && { title: 'Show all blocks', key: '1', run: () => setFilter('all') },
    st && { title: 'Show remaining blocks', key: '2', run: () => setFilter('remaining') },
    st && { title: 'Show problems only', key: '3', run: () => setFilter('problems') },
    st && {
      title: S.ghosts ? 'Hide missing-block ghosts' : 'Show missing-block ghosts',
      key: 'G',
      run: () => {
        S.ghosts = !S.ghosts;
        renderInspector();
        remesh();
      },
    },
    has && { title: 'Copy material list', run: copyMaterials },
    has &&
      iris && {
        title: SH.settings.enabled ? 'Turn shaders off' : 'Turn shaders on',
        key: 'V',
        run: () => setShaderEnabled(!SH.settings.enabled),
      },
    has && { title: 'Open shader settings', run: openShaderTab },
    ...(has && iris
      ? (SH.list?.packs || [])
          .filter((p) => p.id !== SH.settings.pack || !SH.settings.enabled)
          .map((p) => ({ title: `Use shader pack: ${p.name}`, run: () => selectPack(p.id) }))
      : []),
    ...(has && SH.settings.enabled
      ? [
          ['Sunrise', 0],
          ['Noon', 6000],
          ['Sunset', 12000],
          ['Midnight', 18000],
        ].map(([l, t]) => ({ title: `Shader time: ${l}`, run: () => setShaderScene({ time: t }) }))
      : []),
    ...(has && SH.status === 'ready'
      ? profiles().map((p) => ({ title: `Shader profile: ${p.label}`, run: () => applyProfile(p.name) }))
      : []),
    pl &&
      S.api.serverMod && {
        title: pl.sharedId ? 'Update shared copy' : 'Share this placement to the server',
        run: () => sharePlacement(pl.id),
      },
    pl?.sharedId && { title: 'Stop sharing this placement', run: () => unshare(pl.sharedId, pl.id) },
    { title: 'Toggle sidebar', key: `${MOD} B`, run: () => toggle('sidebar') },
    { title: 'Toggle details panel', key: 'I', run: () => toggle('inspector') },
    {
      title:
        'Switch theme: ' +
        (document.documentElement.dataset.theme === 'light'
          ? 'dark'
          : document.documentElement.dataset.theme === 'dark'
            ? 'system'
            : 'light'),
      run: cycleTheme,
    },
  ].filter(Boolean);
};

function paletteItems(q) {
  const a = S.api;
  const items = [];
  if (a?.inWorld) {
    if (a.selection)
      items.push({
        group: 'Views',
        icon: ICON.selection,
        title: a.selection.name,
        sub: `Selection · ${dims(boxSize(a.selection.boxes))}`,
        run: () => open({ type: 'selection' }),
      });
    for (const p of a.placements || [])
      items.push({
        group: 'Views',
        icon: ICON.placement,
        title: p.name,
        sub: `Your placement · ${dims(boxSize(p.boxes))}`,
        run: () => open({ type: 'placement', id: p.id }),
      });
    for (const s of a.shared || [])
      items.push({
        group: 'Views',
        icon: ICON.shared,
        title: s.name,
        sub: `Shared by ${s.mine ? 'you' : s.ownerName} · ${dims(s.size)}`,
        run: () => open({ type: 'shared', id: s.id }),
      });
  }
  for (const c of COMMANDS()) items.push({ group: 'Commands', icon: ICON.cmd, ...c });
  if (!q) return items;
  const ql = q.toLowerCase();
  return items
    .map((it) => ({ it, s: score(ql, `${it.title} ${it.sub || ''}`.toLowerCase()) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.it);
}
function score(q, text) {
  if (text.includes(q)) return 100 - text.indexOf(q);
  let i = 0;
  for (const ch of text) if (ch === q[i]) i++;
  return i === q.length ? 10 : 0;
}

let palSel = 0,
  palItems = [],
  palReturn = null;
function openPalette(q) {
  palReturn = document.activeElement;
  $('palette').hidden = false;
  const input = $('palette-input');
  input.value = q;
  palSel = 0;
  renderPalette();
  input.focus();
}
function closePalette() {
  $('palette').hidden = true;
  palReturn?.focus?.();
}
function renderPalette() {
  palItems = paletteItems($('palette-input').value.trim());
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  let h = '',
    group = '';
  palItems.forEach((it, i) => {
    if (it.group !== group) {
      group = it.group;
      h += `<div class="pal-group">${group}</div>`;
    }
    h += `<button type="button" class="pal-item" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === palSel}">
      <span class="row-icon">${it.icon}</span><span class="row-main"><span class="row-title">${esc(it.title)}</span>${it.sub ? `<span class="row-sub">${esc(it.sub)}</span>` : ''}</span>
      ${it.key ? `<kbd class="kbd">${it.key}</kbd>` : ''}</button>`;
  });
  $('palette-list').innerHTML = h || '<div class="pal-empty">No results</div>';
  $('palette-input').setAttribute('aria-activedescendant', palItems.length ? `pal-${palSel}` : '');
  document.getElementById(`pal-${palSel}`)?.scrollIntoView({ block: 'nearest' });
}
$('palette-input').addEventListener('input', () => {
  palSel = 0;
  renderPalette();
});
$('palette-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    palSel = (palSel + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % Math.max(1, palItems.length);
    renderPalette();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const it = palItems[palSel];
    closePalette();
    it?.run();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  }
});
$('palette-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  const it = palItems[+b.dataset.i];
  closePalette();
  it?.run();
});
$('palette-list').addEventListener('mousemove', (e) => {
  const b = e.target.closest('[data-i]');
  if (b && +b.dataset.i !== palSel) {
    palSel = +b.dataset.i;
    renderPalette();
  }
});
$('palette').addEventListener('mousedown', (e) => {
  if (e.target.id === 'palette') closePalette();
});

function cycleTheme() {
  const r = document.documentElement;
  const next = r.dataset.theme === 'light' ? 'dark' : r.dataset.theme === 'dark' ? '' : 'light';
  if (next) r.dataset.theme = next;
  else delete r.dataset.theme;
  try {
    localStorage.setItem('litweb.theme', next);
  } catch {}
  applyTheme();
  if (S.data) buildHelpers(S.data);
}

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('palette').hidden ? openPalette('') : closePalette();
    return;
  }
  if (mod && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    toggle('sidebar');
    return;
  }
  if (!$('palette').hidden) return;
  if (e.target.closest?.('input, textarea') && e.key !== 'Escape') return;
  if (mod || e.altKey) return;
  const k = e.key;
  if (k === 'Escape') {
    if (e.target.id === 'mat-filter') {
      e.target.blur();
      return;
    }
    if (S.iso >= 0) {
      S.iso = -1;
      renderInspector();
      remesh();
    }
    return;
  }
  if (k === '?') {
    openPalette('');
    return;
  }
  if (!S.data) return;
  const top = S.data.size[1] - 1;
  const act = {
    f: fit,
    r: () => open(S.desc, { force: true }),
    s: screenshot,
    i: () => toggle('inspector'),
    l: () => setLayer({ all: 'below', below: 'single', single: 'all' }[S.layerMode]),
    g: () => {
      if (S.status) {
        S.ghosts = !S.ghosts;
        renderInspector();
        remesh();
      }
    },
    v: () => setShaderEnabled(!SH.settings.enabled),
    1: () => setFilter('all'),
    2: () => setFilter('remaining'),
    3: () => setFilter('problems'),
    ArrowUp: () => setLayer(S.layerMode === 'all' ? 'below' : null, S.layerMode === 'all' ? top : S.layerY + 1),
    ArrowDown: () => setLayer(S.layerMode === 'all' ? 'below' : null, S.layerMode === 'all' ? top - 1 : S.layerY - 1),
    PageUp: () => setLayer(null, S.layerY + 1),
    PageDown: () => setLayer(null, S.layerY - 1),
  }[k.length === 1 ? k.toLowerCase() : k];
  if (act) {
    e.preventDefault();
    act();
  }
});

// ---------------------------------------------------------------- toasts & tooltips

function toast(title, body, opts = {}) {
  const el = document.createElement('div');
  el.className = `toast${opts.error ? ' error' : ''}`;
  el.setAttribute('role', opts.error ? 'alert' : 'status');
  el.innerHTML = `${opts.error ? ICON.alert : ICON.check}<div class="t-body">${esc(title)}${body ? `<small>${esc(body)}</small>` : ''}</div>${opts.action ? `<button class="t-action">${esc(opts.action)}</button>` : ''}`;
  if (opts.action)
    el.querySelector('.t-action').addEventListener('click', () => {
      el.remove();
      opts.run();
    });
  $('toasts').append(el);
  setTimeout(() => el.remove(), opts.action || opts.error ? 7000 : 3500);
  while ($('toasts').children.length > 3) $('toasts').firstElementChild.remove();
}

let tipTimer = 0;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  clearTimeout(tipTimer);
  const tip = $('tooltip');
  if (!t) {
    tip.hidden = true;
    return;
  }
  tipTimer = setTimeout(() => {
    tip.innerHTML =
      esc(t.dataset.tip) +
      (t.dataset.key ? ` <kbd class="kbd">${esc(t.dataset.key.replace('mod', MOD).replace('+', ' '))}</kbd>` : '');
    tip.hidden = false;
    const r = t.getBoundingClientRect(),
      w = tip.offsetWidth;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.bottom + 6 + tip.offsetHeight > innerHeight ? r.top - tip.offsetHeight - 6 : r.bottom + 6}px`;
  }, 350);
});
document.addEventListener('mousedown', () => {
  clearTimeout(tipTimer);
  $('tooltip').hidden = true;
});

// ---------------------------------------------------------------- boot

try {
  const theme = localStorage.getItem('litweb.theme');
  if (theme) document.documentElement.dataset.theme = theme;
  if (localStorage.getItem('litweb.hint') === '0') $('hint').style.opacity = '0';
  if (localStorage.getItem('litweb.sidebar') === '0' || innerWidth <= 900) toggle('sidebar', false);
  if (localStorage.getItem('litweb.inspector') === '0' || innerWidth <= 900) toggle('inspector', false);
  if (localStorage.getItem('litweb.tab') === 'shaders') SH.tab = 'shaders';
} catch {}
document.querySelectorAll('[data-mod]').forEach((k) => {
  k.textContent = `${MOD} K`;
});
$('toggle-sidebar').setAttribute('aria-pressed', String(!$('app').classList.contains('no-sidebar')));
$('toggle-inspector').setAttribute('aria-pressed', String(!$('app').classList.contains('no-inspector')));
addEventListener('hashchange', () => {
  const d = parseHash();
  if (d && exists(d)) open(d);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.desc && S.desc.type !== 'selection') pollStatus(true);
});
setInterval(() => {
  if (S.counts && !$('app').classList.contains('no-inspector')) {
    const u = $('updated-at');
    if (u && !S.statusErr) {
      const ago = Math.round((Date.now() - S.statusAt) / 1000);
      u.textContent = `Updated ${ago < 2 ? 'just now' : `${ago}s ago`}`;
    }
  }
}, 1000);
applyTheme();
resize();
requestAnimationFrame(frame);
pollState();
loadShaderIndex();
