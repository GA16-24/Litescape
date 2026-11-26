// Web Worker: turns a block volume into vertex buffers.
// Groups: 0 = solid + cutout, 1 = translucent, 2 = ghost (blocks still missing from a build).

// Face order matches Minecraft's Direction: down, up, north (-z), south (+z), west (-x), east (+x).
const DIRS = [
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
];
const SHADE = [0.5, 1, 0.8, 0.8, 0.6, 0.6];
// Status codes from Volume.java: 1 ok, 2 missing, 3 wrong block, 4 wrong state, 5 not loaded, 6 wrong redstone setting.
const STATUS_TINT = { 3: [1, 0.33, 0.3], 4: [1, 0.72, 0.25], 6: [0.85, 0.35, 1] };

let V = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'load') {
    V = m;
    return;
  }
  if (m.type === 'ent' && V) {
    V.ent = m.ent; // palette index -> block.properties id, for mc_Entity
    return;
  }
  if (m.type === 'mesh' && V) {
    const out = build(m.opts);
    out.seq = m.seq;
    out.iris = !!m.opts.iris;
    const transfer = [out.vis.buffer];
    for (const g of out.groups) for (const a of Object.values(g)) transfer.push(a.buffer);
    self.postMessage(out, transfer);
  }
};

class Buf {
  constructor(Type, n = 4096) {
    this.a = new Type(n);
    this.n = 0;
    this.Type = Type;
  }
  push(v) {
    if (this.n === this.a.length) {
      const b = new this.Type(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}

function group(iris) {
  const g = {
    pos: new Buf(Float32Array),
    uv: new Buf(Float32Array),
    col: new Buf(Uint8Array),
    pid: new Buf(Float32Array),
    idx: new Buf(Uint32Array),
    verts: 0,
  };
  // Extra vertex data shader packs read: normal, tangent, mc_midTexCoord, lightmap, mc_Entity, at_midBlock.
  if (iris)
    Object.assign(g, {
      nrm: new Buf(Int8Array),
      tan: new Buf(Int8Array),
      mid: new Buf(Float32Array),
      lm: new Buf(Uint8Array),
      ent: new Buf(Float32Array),
      mb: new Buf(Int8Array),
    });
  return g;
}

function build(o) {
  const { sx, sy, sz, blocks, pal, rects } = V;
  const st = o.status;
  const n = sx * sy * sz;
  const layer = sx * sz;
  const vis = new Uint8Array(n); // 0 hidden, 1 shown solid, 2 shown as ghost

  for (let i = 0; i < n; i++) {
    const p = blocks[i];
    const e = pal[p];
    if (!e || e.air) continue;
    const y = (i / layer) | 0;
    if (y < o.y0 || y > o.y1) continue;
    if (e.t) {
      // Captured surroundings: no build status, so they step aside while a filter or material is picked.
      if (o.terrain !== 'off' && o.iso < 0 && (!st || o.filter === 'all')) vis[i] = 1;
      continue;
    }
    if (o.iso >= 0 && e.mid !== o.iso) continue;
    let g = 1;
    if (st) {
      const s = st[i];
      if (o.filter === 'remaining' && s === 1) continue;
      if (o.filter === 'problems' && s !== 3 && s !== 4 && s !== 6) continue;
      if (s === 2) g = o.ghosts ? 2 : 0;
      if (g === 0) continue;
    }
    vis[i] = g;
  }

  const iris = o.iris;
  const groups = [group(iris), group(iris), group(iris)];
  const col = [0, 0, 0];
  const light = iris ? lightOf() : null;

  const emit = (G, x, y, z, q, off, r, g2, b2, pidv, i, e) => {
    // q: [tex, cull, tint, layer, shade, x,y,z,u,v ×4]
    const t = q[off] * 4;
    const u0 = rects[t],
      v0 = rects[t + 1],
      du = rects[t + 2] - u0,
      dv = rects[t + 3] - v0;
    const base = G.verts;
    if (iris) irisQuad(G, x, y, z, q, off, r, g2, b2, u0, v0, du, dv, i, e);
    for (let k = 0; k < 4; k++) {
      const j = off + 5 + k * 5;
      G.pos.push(x + q[j]);
      G.pos.push(y + q[j + 1]);
      G.pos.push(z + q[j + 2]);
      G.uv.push(u0 + q[j + 3] * du);
      G.uv.push(v0 + q[j + 4] * dv);
      if (!iris) {
        G.col.push(r);
        G.col.push(g2);
        G.col.push(b2);
      }
      G.pid.push(pidv);
    }
    G.idx.push(base);
    G.idx.push(base + 1);
    G.idx.push(base + 2);
    G.idx.push(base);
    G.idx.push(base + 2);
    G.idx.push(base + 3);
    G.verts += 4;
  };

  const occludes = (_i, d, x, y, z, e, p, gi) => {
    const nx = x + DIRS[d][0],
      ny = y + DIRS[d][1],
      nz = z + DIRS[d][2];
    if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) return false;
    const ni = (ny * sz + nz) * sx + nx;
    if (vis[ni] !== gi) return false;
    const np = blocks[ni];
    const ne = pal[np];
    return !!ne && (ne.opaque || (np === p && e.selfCull));
  };

  const fluidQuad = new Float32Array(25);
  for (let i = 0; i < n; i++) {
    const gi = vis[i];
    if (!gi) continue;
    const p = blocks[i];
    const e = pal[p];
    const x = i % sx,
      z = ((i / sx) | 0) % sz,
      y = (i / layer) | 0;
    const s = st ? st[i] : 0;
    const tintS = STATUS_TINT[s];
    const q = e.q;
    for (let off = 0; off < q.length; off += 25) {
      const cull = q[off + 1];
      if (cull >= 0 && occludes(i, cull, x, y, z, e, p, gi)) continue;
      const G = gi === 2 ? groups[2] : q[off + 3] === 2 ? groups[1] : groups[0];
      (iris ? irisColor : shadeColor)(q[off + 2], q[off + 4], tintS, col);
      if (e.t && o.terrain === 'faded') fade(col);
      emit(G, x, y, z, q, off, col[0], col[1], col[2], e.mid, i, e);
    }
    const f = e.f;
    if (f) {
      const above = y + 1 < sy ? pal[blocks[i + layer]] : null;
      const h = above?.f && above.f.k === f.k && vis[i + layer] ? 1 : f.h;
      for (let d = 0; d < 6; d++) {
        const nx = x + DIRS[d][0],
          ny = y + DIRS[d][1],
          nz = z + DIRS[d][2];
        if (nx >= 0 && ny >= 0 && nz >= 0 && nx < sx && ny < sy && nz < sz) {
          const ni = (ny * sz + nz) * sx + nx;
          const ne = pal[blocks[ni]];
          if (vis[ni] === gi && ne && ((ne.f && ne.f.k === f.k) || ne.opaque)) continue;
        }
        fluidFace(fluidQuad, d, h, f.t);
        const G = gi === 2 ? groups[2] : f.l === 2 ? groups[1] : groups[0];
        (iris ? irisColor : shadeColor)(f.c, d, tintS, col);
        if (e.t && o.terrain === 'faded') fade(col);
        emit(G, x, y, z, fluidQuad, 0, col[0], col[1], col[2], e.mid, i, e);
      }
    }
  }

  return {
    vis,
    groups: groups.map((G) => {
      const out = {};
      for (const [k, b] of Object.entries(G)) if (b instanceof Buf) out[k] = b.done();
      return out;
    }),
  };

  // ---- shader-pack vertex data ----

  function irisQuad(G, x, y, z, q, off, r, g2, b2, u0, v0, du, dv, i, e) {
    const P = (k, c) => q[off + 5 + k * 5 + c];
    // Normal from the first triangle; tangent along +u.
    const e1 = [P(1, 0) - P(0, 0), P(1, 1) - P(0, 1), P(1, 2) - P(0, 2)],
      e2 = [P(2, 0) - P(0, 0), P(2, 1) - P(0, 1), P(2, 2) - P(0, 2)];
    const n = norm([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
    const du1 = (P(1, 3) - P(0, 3)) * du,
      dv1 = (P(1, 4) - P(0, 4)) * dv,
      du2 = (P(2, 3) - P(0, 3)) * du,
      dv2 = (P(2, 4) - P(0, 4)) * dv;
    const det = du1 * dv2 - du2 * dv1 || 1;
    const t = norm([
      (e1[0] * dv2 - e2[0] * dv1) / det,
      (e1[1] * dv2 - e2[1] * dv1) / det,
      (e1[2] * dv2 - e2[2] * dv1) / det,
    ]);
    const cull = q[off + 1];
    // Light comes from the cell the face looks into (for faces on the block's edge) or the block's own cell.
    const ax = Math.abs(n[0]) > 0.7 ? 0 : Math.abs(n[1]) > 0.7 ? 1 : Math.abs(n[2]) > 0.7 ? 2 : -1;
    const step =
      ax < 0
        ? [0, 0, 0]
        : [ax === 0 ? Math.sign(n[0]) : 0, ax === 1 ? Math.sign(n[1]) : 0, ax === 2 ? Math.sign(n[2]) : 0];
    const onEdge = cull >= 0 || e.opaque;
    const cx = x + (onEdge ? step[0] : 0),
      cy = y + (onEdge ? step[1] : 0),
      cz = z + (onEdge ? step[2] : 0);
    const L = lightAt(cx, cy, cz);
    for (let k = 0; k < 4; k++) {
      const px = P(k, 0),
        py = P(k, 1),
        pz = P(k, 2);
      let ao = 1;
      if (onEdge && ax >= 0) {
        // Vanilla-style corner occlusion: the two side blocks and the corner block in front of this vertex.
        const ua = (ax + 1) % 3,
          wa = (ax + 2) % 3;
        const pc = [px, py, pz];
        const su = pc[ua] > 0.5 ? 1 : -1,
          sw = pc[wa] > 0.5 ? 1 : -1;
        const c0 = [cx, cy, cz];
        const s1 = c0.slice();
        s1[ua] += su;
        const s2 = c0.slice();
        s2[wa] += sw;
        const cc = c0.slice();
        cc[ua] += su;
        cc[wa] += sw;
        const o1 = solidAt(s1),
          o2 = solidAt(s2),
          o3 = o1 && o2 ? 1 : solidAt(cc);
        ao = 1 - 0.2 * (o1 + o2 + o3);
      }
      const a = o.separateAo ? ao : 1;
      const m = o.separateAo ? 1 : ao;
      G.col.push(r * m);
      G.col.push(g2 * m);
      G.col.push(b2 * m);
      G.col.push(255 * a);
      G.nrm.push(n[0] * 127);
      G.nrm.push(n[1] * 127);
      G.nrm.push(n[2] * 127);
      G.tan.push(t[0] * 127);
      G.tan.push(t[1] * 127);
      G.tan.push(t[2] * 127);
      G.tan.push(127);
      G.mid.push(u0 + du / 2);
      G.mid.push(v0 + dv / 2);
      G.lm.push((L >> 4) * 16);
      G.lm.push((L & 15) * 16);
      G.ent.push(V.ent ? V.ent[blocks[i]] : -1);
      G.mb.push(Math.round((0.5 - px) * 64));
      G.mb.push(Math.round((0.5 - py) * 64));
      G.mb.push(Math.round((0.5 - pz) * 64));
      G.mb.push(e.light || 0);
    }
  }

  function solidAt(c) {
    if (c[0] < 0 || c[1] < 0 || c[2] < 0 || c[0] >= sx || c[1] >= sy || c[2] >= sz) return 0;
    const ni = (c[1] * sz + c[2]) * sx + c[0];
    const ne = pal[blocks[ni]];
    return vis[ni] && ne?.opaque ? 1 : 0;
  }

  function lightAt(cx, cy, cz) {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) return 15; // open sky outside the volume
    return light[(cy * sz + cz) * sx + cx];
  }

  /** Block light (high nibble) and sky light (low nibble), flood-filled like the game does, over the shown blocks. */
  function lightOf() {
    if (V.light && V.lightFor === vis) return V.light;
    const L = new Uint8Array(n);
    const opaque = (i) => vis[i] === 1 && pal[blocks[i]] && pal[blocks[i]].opaque;
    const queue = new Int32Array(n);
    // Sky: full brightness straight down to the first opaque block, then spread sideways losing 1 per block.
    let qh = 0,
      qt = 0;
    for (let zz = 0; zz < sz; zz++)
      for (let xx = 0; xx < sx; xx++) {
        for (let yy = sy - 1; yy >= 0; yy--) {
          const i = (yy * sz + zz) * sx + xx;
          if (opaque(i)) break;
          L[i] = 15;
          queue[qt++] = i;
        }
      }
    spread(L, queue, qh, qt, opaque);
    // Block light from emitters, brightest first so each cell is reached at its final level.
    const B = new Uint8Array(n);
    qt = 0;
    const buckets = Array.from({ length: 16 }, () => []);
    for (let i = 0; i < n; i++) {
      const e = vis[i] === 1 && pal[blocks[i]];
      if (e && e.light > 0) buckets[Math.min(15, e.light)].push(i);
    }
    for (let lv = 15; lv > 0; lv--)
      for (const i of buckets[lv]) {
        B[i] = lv;
        queue[qt++] = i;
      }
    spread(B, queue, 0, qt, opaque);
    for (let i = 0; i < n; i++) L[i] |= B[i] << 4;
    V.light = L;
    V.lightFor = vis;
    return L;
  }

  function spread(L, queue, qh, qt, opaque) {
    while (qh < qt) {
      const i = queue[qh++];
      const v = L[i];
      if (v <= 1) continue;
      const xx = i % sx,
        zz = ((i / sx) | 0) % sz,
        yy = (i / layer) | 0;
      for (let d = 0; d < 6; d++) {
        const nx = xx + DIRS[d][0],
          ny = yy + DIRS[d][1],
          nz = zz + DIRS[d][2];
        if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
        const ni = (ny * sz + nz) * sx + nx;
        if (L[ni] >= v - 1 || opaque(ni)) continue;
        L[ni] = v - 1;
        if (qt < queue.length) queue[qt++] = ni;
      }
    }
  }
}

/** Mostly greys out a surroundings color so the build stands out against it. */
function fade(c) {
  const l = (c[0] + c[1] + c[2]) / 3;
  for (let k = 0; k < 3; k++) c[k] = c[k] * 0.3 + l * 0.7;
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Shader packs get the block tint in sRGB with no baked directional shading, like Iris gives them. */
function irisColor(tint, _shadeDir, statusTint, out) {
  let r = 1,
    g = 1,
    b = 1;
  if (tint >= 0) {
    r = ((tint >> 16) & 255) / 255;
    g = ((tint >> 8) & 255) / 255;
    b = (tint & 255) / 255;
  }
  if (statusTint) {
    r = r * 0.45 + statusTint[0] * 0.55;
    g = g * 0.45 + statusTint[1] * 0.55;
    b = b * 0.45 + statusTint[2] * 0.55;
  }
  out[0] = r * 255;
  out[1] = g * 255;
  out[2] = b * 255;
}

function shadeColor(tint, shadeDir, statusTint, out) {
  const s = SHADE[shadeDir] ?? 1;
  let r = s,
    g = s,
    b = s;
  if (tint >= 0) {
    r *= ((tint >> 16) & 255) / 255;
    g *= ((tint >> 8) & 255) / 255;
    b *= (tint & 255) / 255;
  }
  if (statusTint) {
    r = r * 0.45 + statusTint[0] * 0.55;
    g = g * 0.45 + statusTint[1] * 0.55;
    b = b * 0.45 + statusTint[2] * 0.55;
  }
  // three.js treats vertex colors as linear; Minecraft multiplies in sRGB, so convert.
  out[0] = Math.min(255, r ** 2.2 * 255) | 0;
  out[1] = Math.min(255, g ** 2.2 * 255) | 0;
  out[2] = Math.min(255, b ** 2.2 * 255) | 0;
}

// Cube face for a fluid of height h, in the same [tex, cull, tint, layer, shade, verts...] layout.
function fluidFace(q, d, h, tex) {
  const F = [
    [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1],
    [0, h, 0, 0, h, 1, 1, h, 1, 1, h, 0],
    [1, h, 0, 1, 0, 0, 0, 0, 0, 0, h, 0],
    [0, h, 1, 0, 0, 1, 1, 0, 1, 1, h, 1],
    [0, h, 0, 0, 0, 0, 0, 0, 1, 0, h, 1],
    [1, h, 1, 1, 0, 1, 1, 0, 0, 1, h, 0],
  ][d];
  const UV = [0, 0, 0, 1, 1, 1, 1, 0];
  q[0] = tex;
  q[1] = d;
  q[2] = -1;
  q[3] = 0;
  q[4] = d;
  for (let k = 0; k < 4; k++) {
    q[5 + k * 5] = F[k * 3];
    q[6 + k * 5] = F[k * 3 + 1];
    q[7 + k * 5] = F[k * 3 + 2];
    q[8 + k * 5] = UV[k * 2];
    q[9 + k * 5] = d > 1 ? (k === 0 || k === 3 ? 1 - h : 1) : UV[k * 2 + 1];
  }
}
