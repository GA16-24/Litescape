// Runs an Iris/OptiFine shader pack in WebGL2. The mod has already translated each program to GLSL ES;
// this file is the frame graph around them: shadow pass, gbuffers, deferred, translucent, composite and
// final passes, ping-ponged colortex buffers, and the uniforms packs expect.
import { customUniforms, evaluate } from './expr.js';

// Stable ids for GL objects, so FBO cache keys can name them.
const idOf = (o) => {
  o.__id ??= Math.random().toString(36).slice(2);
  return o.__id;
};
const STAGE = { NONE: 0, SKY: 1, TERRAIN_SOLID: 8, TERRAIN_TRANSLUCENT: 17 };
const ALIAS = {
  gcolor: 'colortex0',
  gdepth: 'colortex1',
  gnormal: 'colortex2',
  composite: 'colortex3',
  gaux1: 'colortex4',
  gaux2: 'colortex5',
  gaux3: 'colortex6',
  gaux4: 'colortex7',
  gdepthtex: 'depthtex0',
  shadowcolor: 'shadowcolor0',
  tex: 'gtexture',
  texture: 'gtexture',
};
const DEFAULT_BLEND = ['SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'ONE', 'ONE_MINUS_SRC_ALPHA'];

// ---------------------------------------------------------------- small matrix kit (column-major)

const M = {
  id: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    return o;
  },
  translate: (m, x, y, z) => M.mul(m, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])),
  rotX(m, a) {
    const c = Math.cos(a),
      s = Math.sin(a);
    return M.mul(m, new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]));
  },
  rotY(m, a) {
    const c = Math.cos(a),
      s = Math.sin(a);
    return M.mul(m, new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]));
  },
  rotZ(m, a) {
    const c = Math.cos(a),
      s = Math.sin(a);
    return M.mul(m, new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([
      2 / (r - l),
      0,
      0,
      0,
      0,
      2 / (t - b),
      0,
      0,
      0,
      0,
      -2 / (f - n),
      0,
      -(r + l) / (r - l),
      -(t + b) / (t - b),
      -(f + n) / (f - n),
      1,
    ]);
  },
  perspective(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2);
    return new Float32Array([
      t / aspect,
      0,
      0,
      0,
      0,
      t,
      0,
      0,
      0,
      0,
      (f + n) / (n - f),
      -1,
      0,
      0,
      (2 * f * n) / (n - f),
      0,
    ]);
  },
  invert(m) {
    const o = new Float32Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10,
      b01 = a00 * a12 - a02 * a10,
      b02 = a00 * a13 - a03 * a10,
      b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11,
      b05 = a02 * a13 - a03 * a12,
      b06 = a20 * a31 - a21 * a30,
      b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30,
      b09 = a21 * a32 - a22 * a31,
      b10 = a21 * a33 - a23 * a31,
      b11 = a22 * a33 - a23 * a32;
    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06 || 1e-12;
    const d = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
    return o;
  },
  mat3: (m) => new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]),
  vec(m, x, y, z, w) {
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12] * w,
      m[1] * x + m[5] * y + m[9] * z + m[13] * w,
      m[2] * x + m[6] * y + m[10] * z + m[14] * w,
      m[3] * x + m[7] * y + m[11] * z + m[15] * w,
    ];
  },
};
const DEG = Math.PI / 180;

/** Minecraft's celestial angle for a day time (0 = sunrise, 6000 = noon). */
function celestialAngle(t) {
  const d = (((t / 24000 - 0.25) % 1) + 1) % 1;
  const e = 0.5 - Math.cos(d * Math.PI) / 2;
  return (d * 2 + e) / 3;
}

// ---------------------------------------------------------------- built-in programs

const FALLBACK_VS = `#version 300 es
in vec4 iris_Vertex; in vec4 iris_Color; in vec4 iris_MultiTexCoord0; in vec4 iris_MultiTexCoord1;
uniform mat4 iris_ModelViewMatrix, iris_ProjectionMatrix;
out vec2 uv; out vec4 col; out vec2 lm;
void main() { gl_Position = iris_ProjectionMatrix * iris_ModelViewMatrix * iris_Vertex; uv = iris_MultiTexCoord0.xy; col = iris_Color; lm = (iris_MultiTexCoord1.xy + 8.0) / 256.0; }`;
const FALLBACK_FS = `#version 300 es
precision highp float;
in vec2 uv; in vec4 col; in vec2 lm;
uniform sampler2D gtexture, lightmap; uniform float iris_alphaTestRef;
layout(location = 0) out vec4 o;
void main() { vec4 c = texture(gtexture, uv) * col; if (c.a <= iris_alphaTestRef) discard; c.rgb *= texture(lightmap, lm).rgb; o = c; }`;
const QUAD_VS = `#version 300 es
in vec4 iris_Vertex; out vec2 uv;
void main() { uv = iris_Vertex.xy; gl_Position = vec4(iris_Vertex.xy * 2.0 - 1.0, 0.0, 1.0); }`;
const COPY_FS = `#version 300 es
precision highp float;
in vec2 uv; uniform sampler2D src; out vec4 o;
void main() { o = vec4(texture(src, uv).rgb, 1.0); }`;
// Ghosts (blocks still missing from a build) and the hover box sit on top of the shaded image,
// depth-tested by hand against the pack's depth buffer.
const OVERLAY_VS = `#version 300 es
in vec4 iris_Vertex; uniform mat4 mvp; out float z;
void main() { gl_Position = mvp * iris_Vertex; }`;
const OVERLAY_FS = `#version 300 es
precision highp float;
uniform highp sampler2D depthtex0; uniform vec4 color; uniform float testDepth; out vec4 o;
void main() {
  float d = texelFetch(depthtex0, ivec2(gl_FragCoord.xy), 0).r;
  if (testDepth > 0.5 && gl_FragCoord.z > d + 1e-5) discard;
  o = color;
}`;

// ---------------------------------------------------------------- renderer

export class Iris {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    this.gl = gl;
    this.supported = !!gl && !!gl.getExtension('EXT_color_buffer_float');
    if (!this.supported) return;
    this.floatLinear = !!gl.getExtension('OES_texture_float_linear');
    this.indexed = gl.getExtension('OES_draw_buffers_indexed');
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    this.maxDraw = gl.getParameter(gl.MAX_DRAW_BUFFERS);
    this.maxUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    this.U = {};
    this.frame = 0;
    this.time = 0;
    this.groups = [];
    this.samplerCache = new Map();
    this.fbos = new Map();
    this.W = 0;
    this.H = 0;
    this.dummies = this.makeDummies();
    this.quad = this.buffer(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
    this.sky = this.skyBox();
    this.copy = this.link('copy', QUAD_VS, COPY_FS);
    this.overlay = this.link('overlay', OVERLAY_VS, OVERLAY_FS);
    this.fallback = this.link('fallback', FALLBACK_VS, FALLBACK_FS);
    this.fallback.drawBuffers = [0];
    this.lightmap = this.texture2D(16, 16, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.normals = this.solid([127, 127, 255, 255]);
    this.specular = this.solid([0, 0, 0, 0]);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.onLost?.();
    });
  }

  // ---- resources

  buffer(data, target = this.gl.ARRAY_BUFFER) {
    const gl = this.gl,
      b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }

  texture2D(w, h, internal, format, type, data, levels = 1) {
    const gl = this.gl,
      t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (data === undefined || levels > 1 || (data === null && internal !== gl.RGBA8))
      gl.texStorage2D(gl.TEXTURE_2D, levels, internal, w, h);
    else gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  solid(rgba) {
    return this.texture2D(1, 1, this.gl.RGBA8, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array(rgba));
  }

  makeDummies() {
    const gl = this.gl;
    const d = {};
    d[gl.SAMPLER_2D] = this.solid([0, 0, 0, 0]);
    const depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT32F,
      1,
      1,
      0,
      gl.DEPTH_COMPONENT,
      gl.FLOAT,
      new Float32Array([1]),
    );
    d[gl.SAMPLER_2D_SHADOW] = depth;
    const int = (internal, format, arr) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        internal,
        1,
        1,
        0,
        format,
        arr instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.BYTE,
        arr,
      );
      return t;
    };
    d[gl.UNSIGNED_INT_SAMPLER_2D] = int(gl.RGBA8UI, gl.RGBA_INTEGER, new Uint8Array(4));
    d[gl.INT_SAMPLER_2D] = int(gl.RGBA8I, gl.RGBA_INTEGER, new Int8Array(4));
    const t3 = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t3);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    d[gl.SAMPLER_3D] = t3;
    const ta = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, ta);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    d[gl.SAMPLER_2D_ARRAY] = ta;
    return d;
  }

  skyBox() {
    // A cube around the camera; sky programs compute their colour from the view direction.
    const s = 128,
      p = [];
    const c = [
      [-s, -s, -s],
      [s, -s, -s],
      [s, s, -s],
      [-s, s, -s],
      [-s, -s, s],
      [s, -s, s],
      [s, s, s],
      [-s, s, s],
    ];
    for (const f of [
      [0, 1, 2, 0, 2, 3],
      [5, 4, 7, 5, 7, 6],
      [4, 0, 3, 4, 3, 7],
      [1, 5, 6, 1, 6, 2],
      [3, 2, 6, 3, 6, 7],
      [4, 5, 1, 4, 1, 0],
    ])
      for (const i of f) p.push(...c[i]);
    return { buf: this.buffer(new Float32Array(p)), count: p.length / 3 };
  }

  sampler(min, mag, wrap, compare) {
    const key = `${min}/${mag}/${wrap}/${compare}`;
    let s = this.samplerCache.get(key);
    if (!s) {
      const gl = this.gl;
      s = gl.createSampler();
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, min);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, mag);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_R, wrap);
      if (compare) {
        gl.samplerParameteri(s, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.samplerParameteri(s, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      }
      this.samplerCache.set(key, s);
    }
    return s;
  }

  // ---- programs

  link(name, vs, fs) {
    return this.finish(this.start(name, vs, fs));
  }

  /** Queues compile and link; with KHR_parallel_shader_compile the driver does the work off the main thread. */
  start(name, vs, fs) {
    const gl = this.gl;
    // GLSL ES has no uniform initializers (desktop GLSL does): strip them and set the values after linking.
    const defaults = {};
    const strip = (src) =>
      src.replace(/^(\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+))\s*=\s*([^;]+);/gm, (_m, decl, n, v) => {
        const nums = (v.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number);
        defaults[n] = nums.length === 1 ? nums[0] : nums;
        return `${decl};`;
      });
    vs = strip(vs);
    fs = strip(fs);
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram();
    const v = sh(gl.VERTEX_SHADER, vs),
      f = sh(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    return { name, p, v, f, fs, defaults };
  }

  done(job) {
    return !this.parallel || this.gl.getProgramParameter(job.p, this.parallel.COMPLETION_STATUS_KHR);
  }

  finish({ name, p, v, f, fs, defaults }) {
    const gl = this.gl;
    const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
    const log = ok ? '' : gl.getShaderInfoLog(v) || gl.getShaderInfoLog(f) || gl.getProgramInfoLog(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!ok) {
      gl.deleteProgram(p);
      throw new Error(firstError(log));
    }
    const prog = { name, p, uniforms: [], samplers: [], attribs: {}, vaos: new Map() };
    // WebGL refuses to draw when an enabled draw buffer has no shader output (desktop GL ignores it).
    const outs = [...fs.matchAll(/layout\s*\(\s*location\s*=\s*(\d+)\s*\)\s*out\b/g)].map((m) => +m[1]);
    prog.outputs = new Set(outs.length ? outs : /^\s*out\s/m.test(fs) ? [0] : []);
    gl.useProgram(p);
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    let unit = 0;
    for (let i = 0; i < nu; i++) {
      const u = gl.getActiveUniform(p, i);
      const loc = gl.getUniformLocation(p, u.name);
      const base = u.name.replace(/\[0\]$/, '');
      if (isSampler(gl, u.type)) {
        if (unit >= this.maxUnits) throw new Error(`Needs more than ${this.maxUnits} textures at once`);
        gl.uniform1i(loc, unit);
        prog.samplers.push({ name: base, unit: unit++, type: u.type });
      } else prog.uniforms.push({ name: base, loc, type: u.type, size: u.size });
    }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const a = gl.getActiveAttrib(p, i);
      prog.attribs[a.name] = { loc: gl.getAttribLocation(p, a.name), type: a.type };
    }
    prog.hasWatershadow = prog.samplers.some((s) => s.name === 'watershadow');
    for (const u of prog.uniforms) if (u.name in defaults) setUniform(gl, u, defaults[u.name]);
    prog.defaults = defaults;
    return prog;
  }

  /** Loads a compiled pack from /api/shaders/load. Returns the programs that failed, with reasons. */
  /**
   * Compiles a pack from /api/shaders/load and swaps it in once every program is ready; the old pack keeps
   * rendering meanwhile. Returns false (and discards the work) if isCurrent() says a newer request won.
   */
  async setPack(pack, loadImage, isCurrent = () => true) {
    const gl = this.gl;
    const props = pack.props || {};
    const errors = [];
    const jobs = [];
    for (const [name, src] of Object.entries(pack.programs)) {
      if (src.error) errors.push({ program: name, message: src.error });
      else jobs.push([name, src, this.start(name, src.vs, src.fs)]);
    }
    while (jobs.some(([, , j]) => !this.done(j))) await new Promise((r) => setTimeout(r, 16));
    if (!isCurrent() || this.lost) {
      for (const [, , j] of jobs) {
        gl.deleteShader(j.v);
        gl.deleteShader(j.f);
        gl.deleteProgram(j.p);
      }
      return false;
    }
    this.disposePack();
    this.pack = pack;
    this.props = props;
    this.consts = pack.consts || {};
    this.errors = errors;
    this.programs = {};
    for (const [name, src, job] of jobs) {
      try {
        const p = this.finish(job);
        p.drawBuffers = (src.drawBuffers || [0]).slice(0, this.maxDraw);
        p.mipmap = (src.mipmap || []).map((n) => +String(ALIAS[n] || n).replace('colortex', '')).filter((n) => n >= 0);
        p.stage = stageOf(name);
        p.blend = blendOf(props, name);
        const at = /GREATER\s+([\d.]+)/i.exec(props[`alphaTest.${name}`] || '');
        p.alphaRef = props[`alphaTest.${name}`]?.trim().toLowerCase() === 'off' ? -1 : at ? +at[1] : 0.1;
        this.programs[name] = p;
      } catch (e) {
        this.errors.push({ program: name, message: e.message });
      }
    }
    const P = this.programs;
    const first = (...n) => n.map((x) => P[x]).find(Boolean) || null;
    this.terrain =
      first(
        'gbuffers_terrain',
        'gbuffers_terrain_solid',
        'gbuffers_textured_lit',
        'gbuffers_textured',
        'gbuffers_basic',
      ) || this.fallback;
    this.water = first('gbuffers_water') || this.terrain;
    this.skyProg = first('gbuffers_skybasic', 'gbuffers_basic');
    this.shadowProg = first('shadow', 'shadow_solid');
    const passes = (prefix) =>
      Object.keys(P)
        .filter((n) => n === prefix || new RegExp(`^${prefix}\\d+$`).test(n))
        .sort((a, b) => (+a.slice(prefix.length) || 0) - (+b.slice(prefix.length) || 0))
        .map((n) => P[n]);
    this.begin = passes('begin');
    this.prepare = passes('prepare');
    this.deferred = passes('deferred');
    this.composite = passes('composite');
    this.final = P.final || null;
    for (const p of [this.skyProg, this.terrain, this.water, this.fallback]) if (p) p.alphaRef ??= 0.1;
    if (this.water !== this.terrain) this.water.blend ??= DEFAULT_BLEND;
    this.water.alphaRef = this.water === this.terrain ? this.terrain.alphaRef : -1;

    const cu = customUniforms(props);
    this.custom = cu.list;
    for (const e of cu.errors) this.errors.push({ program: 'shaders.properties', message: e });
    this.U = {};
    this.frame = 0;

    // Buffer settings.
    this.formats = {};
    for (const [k, v] of Object.entries(pack.buffers?.format || {})) this.formats[ALIAS[k] || k] = v;
    this.clear = {};
    for (const [k, v] of Object.entries(pack.buffers?.clear || {})) this.clear[ALIAS[k] || k] = v !== 'false';
    this.clearColor = {};
    for (const [k, v] of Object.entries(pack.buffers?.clearColor || {}))
      this.clearColor[ALIAS[k] || k] = v.split(',').map(Number);
    this.mipmapped = new Set(Object.values(P).flatMap((p) => p.mipmap || []));
    this.shadowRes = Math.min(4096, Math.max(256, +this.consts.shadowMapResolution || 1024));
    this.shadowDistance = +this.consts.shadowDistance || 128;
    this.sunPath = +this.consts.sunPathRotation || 0;
    this.shadowInterval = +(this.consts.shadowIntervalSize ?? 2) || 0;
    this.hwShadow = String(this.consts.shadowHardwareFiltering ?? this.consts.shadowHardwareFiltering0) === 'true';
    this.separateAo = props.separateAo === 'true';
    this.oldLighting = props.oldLighting === 'true';
    this.shadowTranslucent = props.shadowTranslucent !== 'false';
    this.ct = [];
    this.W = 0;

    // Textures from the pack: noise and custom ones.
    const res = Math.min(1024, +this.consts.noiseTextureResolution || 256);
    this.noise = this.texture2D(res, res, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, randomBytes(res * res * 4));
    const want = (path, assign) => {
      if (!/\.png$/i.test(path) || path.includes(':')) return; // resource-pack and raw textures aren't supported
      loadImage(path.replace(/^\//, '')).then((img) => {
        if (img && this.pack === pack) assign(this.imageTexture(img));
      });
    };
    if (props['texture.noise'])
      want(props['texture.noise'], (t) => {
        gl.deleteTexture(this.noise);
        this.noise = t;
      });
    for (const [k, v] of Object.entries(props)) {
      let m = /^texture\.(\w+)\.(\w+)$/.exec(k);
      if (m && m[1] !== 'noise')
        want(v.trim().split(/\s+/)[0], (t) => {
          this.customTex[m[1]] ??= {};
          this.customTex[m[1]][m[2]] = t;
        });
      m = /^customTexture\.(\w+)$/.exec(k);
      if (m)
        want(v.trim().split(/\s+/)[0], (t) => {
          this.customTex.any ??= {};
          this.customTex.any[m[1]] = t;
        });
    }
    return true;
  }

  imageTexture(img) {
    const gl = this.gl,
      t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }

  disposePack() {
    const gl = this.gl;
    for (const p of Object.values(this.programs || {})) {
      gl.deleteProgram(p.p);
      for (const v of p.vaos.values()) gl.deleteVertexArray(v);
    }
    this.programs = {};
    if (this.noise) gl.deleteTexture(this.noise);
    for (const stage of Object.values(this.customTex || {})) for (const t of Object.values(stage)) gl.deleteTexture(t);
    this.noise = null;
    this.customTex = {};
    this.freeTargets();
    for (const p of [this.fallback, this.overlay, this.copy]) {
      for (const v of p.vaos.values()) gl.deleteVertexArray(v);
      p.vaos.clear();
    }
  }

  setAtlas(canvas) {
    const gl = this.gl;
    if (this.atlas) gl.deleteTexture(this.atlas);
    this.atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.atlasSize = [canvas.width, canvas.height];
  }

  /** Mesh groups from the mesher worker: 0 opaque and cutout, 1 translucent, 2 ghosts. */
  setMesh(groups) {
    const gl = this.gl;
    for (const g of this.groups) {
      for (const b of Object.values(g.bufs)) gl.deleteBuffer(b);
    }
    for (const p of [...Object.values(this.programs || {}), this.fallback, this.overlay]) {
      for (const v of p.vaos.values()) gl.deleteVertexArray(v);
      p.vaos.clear();
    }
    this.groups = groups.map((g, i) => {
      const bufs = {};
      if (g.idx.length) {
        for (const k of ['pos', 'uv', 'col', 'nrm', 'tan', 'mid', 'lm', 'ent', 'mb'])
          if (g[k]) bufs[k] = this.buffer(g[k]);
        bufs.idx = this.buffer(g.idx, gl.ELEMENT_ARRAY_BUFFER);
      }
      return { id: i, bufs, count: g.idx.length };
    });
  }

  vao(prog, group) {
    const key = group ? group.id : group === null ? 'sky' : 'quad';
    let v = prog.vaos.get(key);
    if (v) return v;
    const gl = this.gl;
    v = gl.createVertexArray();
    gl.bindVertexArray(v);
    v.bound = new Set();
    const bind = (name, buf, size, type, norm, int = false) => {
      const a = prog.attribs[name];
      if (!a || a.loc < 0) return;
      const wantsInt = int || isIntType(gl, a.type);
      if (wantsInt && type === gl.FLOAT) return; // e.g. an ivec mc_Entity: leave it at its constant default
      v.bound.add(name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(a.loc);
      if (wantsInt) gl.vertexAttribIPointer(a.loc, size, type, 0, 0);
      else gl.vertexAttribPointer(a.loc, size, type, norm, 0, 0);
    };
    if (group) {
      const b = group.bufs;
      for (const n of ['iris_Vertex', 'vaPosition']) bind(n, b.pos, 3, gl.FLOAT, false);
      for (const n of ['iris_Color', 'vaColor']) bind(n, b.col, 4, gl.UNSIGNED_BYTE, true);
      for (const n of ['iris_MultiTexCoord0', 'vaUV0']) bind(n, b.uv, 2, gl.FLOAT, false);
      bind('iris_MultiTexCoord1', b.lm, 2, gl.UNSIGNED_BYTE, false);
      bind('vaUV2', b.lm, 2, gl.UNSIGNED_BYTE, false, true);
      for (const n of ['iris_Normal', 'vaNormal']) bind(n, b.nrm, 3, gl.BYTE, true);
      bind('at_tangent', b.tan, 4, gl.BYTE, true);
      bind('mc_midTexCoord', b.mid, 2, gl.FLOAT, false);
      bind('mc_Entity', b.ent, 1, gl.FLOAT, false);
      bind('at_midBlock', b.mb, 4, gl.BYTE, false);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
    } else if (group === null) {
      for (const n of ['iris_Vertex', 'vaPosition']) bind(n, this.sky.buf, 3, gl.FLOAT, false);
    } else {
      for (const n of ['iris_Vertex', 'vaPosition', 'iris_MultiTexCoord0', 'vaUV0'])
        bind(n, this.quad, 2, gl.FLOAT, false);
    }
    gl.bindVertexArray(null);
    prog.vaos.set(key, v);
    return v;
  }

  /** Binds a VAO and gives attributes without a buffer a constant of the right type (WebGL errors on a mismatch). */
  useVao(prog, group, color) {
    const gl = this.gl;
    const v = this.vao(prog, group);
    gl.bindVertexArray(v);
    for (const [name, a] of Object.entries(prog.attribs)) {
      if (a.loc < 0 || v.bound.has(name)) continue;
      if (isIntType(gl, a.type)) {
        if (name === 'vaUV1')
          gl.vertexAttribI4i(a.loc, 0, 10, 0, 0); // "no overlay"
        else if (name === 'vaUV2')
          gl.vertexAttribI4i(a.loc, 0, 240, 0, 0); // full sky light
        else if ([gl.UNSIGNED_INT, gl.UNSIGNED_INT_VEC2, gl.UNSIGNED_INT_VEC3, gl.UNSIGNED_INT_VEC4].includes(a.type))
          gl.vertexAttribI4ui(a.loc, 0, 0, 0, 0);
        else gl.vertexAttribI4i(a.loc, name === 'mc_Entity' ? -1 : 0, 0, 0, 0);
      } else if (name === 'iris_Color' || name === 'vaColor') gl.vertexAttrib4f(a.loc, ...(color || [1, 1, 1]), 1);
      else if (name === 'mc_Entity') gl.vertexAttrib4f(a.loc, -1, 0, 0, 1);
      else if (name === 'iris_MultiTexCoord1') gl.vertexAttrib4f(a.loc, 0, 240, 0, 1);
      else gl.vertexAttrib4f(a.loc, 0, 0, 0, 1);
    }
    return v;
  }

  // ---- render targets

  freeTargets() {
    const gl = this.gl;
    for (const t of this.ct || []) for (const x of t?.tex || []) gl.deleteTexture(x);
    for (const k of ['depth0', 'depth1', 'depth2', 'shadow0', 'shadow1', 'shadowColor0', 'shadowColor1'])
      if (this[k]) {
        gl.deleteTexture(this[k]);
        this[k] = null;
      }
    for (const f of this.fbos.values()) gl.deleteFramebuffer(f);
    this.fbos.clear();
    this.ct = [];
  }

  resize(W, H) {
    if (W === this.W && H === this.H) return;
    this.freeTargets();
    this.W = W;
    this.H = H;
    const gl = this.gl;
    const depth = (w, h) => this.texture2D(w, h, gl.DEPTH_COMPONENT32F, gl.DEPTH_COMPONENT, gl.FLOAT);
    this.depth0 = depth(W, H);
    this.depth1 = depth(W, H);
    this.depth2 = depth(W, H);
    const S = this.shadowRes;
    this.shadow0 = depth(S, S);
    this.shadow1 = depth(S, S);
    const sf = (n) => FORMAT(gl, this.formats[`shadowcolor${n}`] || 'RGBA8');
    this.shadowColor0 = this.texture2D(S, S, sf(0), 0, 0);
    this.shadowColor1 = this.texture2D(S, S, sf(1), 0, 0);
  }

  /** colortexN, created on first use with the pack's format and size. */
  target(n) {
    let t = this.ct[n];
    if (t) return t;
    const gl = this.gl;
    const fmt = FORMAT(gl, this.formats[`colortex${n}`] || 'RGBA8');
    const size = (this.props[`size.buffer.colortex${n}`] || '').trim().split(/\s+/);
    let w = this.W,
      h = this.H;
    if (size.length === 2) {
      const [a, b] = size;
      w = a.includes('.') ? Math.max(1, Math.round(this.W * +a)) : +a;
      h = b.includes('.') ? Math.max(1, Math.round(this.H * +b)) : +b;
    }
    const levels = this.mipmapped.has(n) ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    t = {
      n,
      fmt,
      w,
      h,
      mip: levels > 1,
      cur: 0,
      tex: [this.texture2D(w, h, fmt, 0, 0, undefined, levels), this.texture2D(w, h, fmt, 0, 0, undefined, levels)],
    };
    t.filterable = !/32F/.test(FORMAT_NAME(gl, fmt)) || this.floatLinear;
    this.ct[n] = t;
    return t;
  }

  fbo(colors, depth) {
    const key = colors.map((c) => (c ? idOf(c) : '-')).join(',') + '|' + (depth ? idOf(depth) : '');
    let f = this.fbos.get(key);
    const gl = this.gl;
    if (!f) {
      f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      colors.forEach((c, i) => {
        if (c) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c, 0);
      });
      if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      this.fbos.set(key, f);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.drawBuffers(colors.length ? colors.map((c, i) => (c ? gl.COLOR_ATTACHMENT0 + i : gl.NONE)) : [gl.NONE]);
    return f;
  }

  // ---- uniforms

  frameUniforms(f) {
    const U = this.U;
    const dt = Math.min(0.25, f.dt);
    this.time += dt;
    const [ox, oy, oz] = f.origin;
    const cam = [f.cam[0] + ox, f.cam[1] + oy, f.cam[2] + oz];
    const target = [f.target[0] + ox, f.target[1] + oy, f.target[2] + oz];
    const far = Math.max(
      160,
      Math.ceil(
        (Math.hypot(f.cam[0] - f.target[0], f.cam[1] - f.target[1], f.cam[2] - f.target[2]) + f.radius * 1.6) / 16,
      ) * 16,
    );
    const view = new Float32Array(f.view);
    view[12] = view[13] = view[14] = 0;
    const proj = M.perspective(f.fov, f.aspect, 0.05, far * 4);
    const prevView = U.gbufferModelView || view,
      prevProj = U.gbufferProjection || proj,
      prevCam = U.cameraPosition || cam;

    const t = f.worldTime;
    const celestial = celestialAngle(t);
    const sunAngle = celestial < 0.75 ? celestial + 0.25 : celestial - 0.75;
    const shadowAngle = sunAngle > 0.5 ? sunAngle - 0.5 : sunAngle;
    const day = sunAngle <= 0.5;
    const celes = M.rotX(M.rotZ(M.rotY(view, -90 * DEG), this.sunPath * DEG), celestial * 360 * DEG);
    const sunPos = M.vec(celes, 0, 100, 0, 0).slice(0, 3),
      moonPos = M.vec(celes, 0, -100, 0, 0).slice(0, 3);

    // Shadows centre on what the camera orbits, so the build keeps the sharp part of the shadow map.
    const skyA = shadowAngle < 0.25 ? shadowAngle + 0.75 : shadowAngle - 0.25;
    let smv = M.translate(M.id(), 0, 0, -100);
    smv = M.rotZ(M.rotX(smv, 90 * DEG), skyA * -360 * DEG);
    smv = M.rotX(smv, this.sunPath * DEG);
    const iv = this.shadowInterval || 1;
    const c = target.map((v) => Math.round(v / iv) * iv);
    smv = M.translate(smv, cam[0] - c[0], cam[1] - c[1], cam[2] - c[2]);
    const D = this.shadowDistance;
    const sproj = M.ortho(-D, D, -D, D, 0.05, 256);

    const bright = Math.max(0, Math.min(1, Math.cos(celestial * Math.PI * 2) * 2 + 0.5)) * (1 - f.rain * 0.75);
    const sky = [0.47 * bright, 0.65 * bright, 1.0 * bright];
    const fog = [0.75 * bright + 0.02, 0.85 * bright + 0.03, 1.0 * bright + 0.05];
    this.skyColor = sky;
    this.fogColor = fog;
    this.updateLightmap(bright, f.rain);

    const tc = M.vec(M.mul(proj, view), target[0] - cam[0], target[1] - cam[1], target[2] - cam[2], 1);
    Object.assign(U, {
      frameCounter: this.frame % 720720,
      frameTime: dt,
      frameTimeCounter: this.time % 3600,
      worldTime: Math.floor(t) % 24000,
      worldDay: 0,
      moonPhase: 0,
      sunAngle,
      shadowAngle,
      rainStrength: f.rain,
      wetness: f.rain,
      thunderStrength: 0,
      viewWidth: this.W,
      viewHeight: this.H,
      aspectRatio: this.W / this.H,
      near: 0.05,
      far,
      cameraPosition: cam,
      previousCameraPosition: prevCam,
      cameraPositionInt: cam.map(Math.floor),
      cameraPositionFract: cam.map((v) => v - Math.floor(v)),
      previousCameraPositionInt: prevCam.map(Math.floor),
      previousCameraPositionFract: prevCam.map((v) => v - Math.floor(v)),
      eyePosition: cam,
      relativeEyePosition: [0, 0, 0],
      eyeAltitude: cam[1],
      playerLookVector: [-view[2], -view[6], -view[10]],
      playerBodyVector: [-view[2], 0, -view[10]],
      gbufferModelView: view,
      gbufferModelViewInverse: M.invert(view),
      gbufferProjection: proj,
      gbufferProjectionInverse: M.invert(proj),
      gbufferPreviousModelView: prevView,
      gbufferPreviousProjection: prevProj,
      shadowModelView: smv,
      shadowModelViewInverse: M.invert(smv),
      shadowProjection: sproj,
      shadowProjectionInverse: M.invert(sproj),
      sunPosition: sunPos,
      moonPosition: moonPos,
      shadowLightPosition: day ? sunPos : moonPos,
      upPosition: M.vec(view, 0, 100, 0, 0).slice(0, 3),
      skyColor: sky,
      fogColor: fog,
      fogStart: far * 0.8,
      fogEnd: far,
      fogDensity: 0.1,
      fogMode: 9729,
      fogShape: 1,
      isEyeInWater: 0,
      eyeBrightness: [0, 240],
      eyeBrightnessSmooth: [0, 240],
      nightVision: 0,
      blindness: 0,
      darknessFactor: 0,
      darknessLightFactor: 0,
      screenBrightness: 0.5,
      playerMood: 0,
      constantMood: 0,
      heldItemId: 0,
      heldBlockLightValue: 0,
      heldItemId2: 0,
      heldBlockLightValue2: 0,
      atlasSize: this.atlasSize || [1, 1],
      entityColor: [0, 0, 0, 0],
      entityId: 0,
      blockEntityId: 0,
      biome: 1,
      BIOME_PLAINS: 1,
      biome_category: 0,
      biome_precipitation: 1,
      temperature: 0.8,
      rainfall: 0.4,
      bedrockLevel: -64,
      heightLimit: 384,
      logicalHeightLimit: 384,
      cloudHeight: 192.33,
      ambientLight: 0,
      hasCeiling: 0,
      hasSkylight: 1,
      centerDepthSmooth: Math.min(1, Math.max(0, (tc[2] / tc[3]) * 0.5 + 0.5)),
      isRightHanded: 1,
      hideGUI: 1,
      currentPlayerHealth: 1,
      maxPlayerHealth: 20,
      currentPlayerAir: 1,
      maxPlayerAir: 300,
      currentPlayerHunger: 1,
      maxPlayerHunger: 20,
      currentPlayerArmor: 0,
      maxPlayerArmor: 20,
      alphaTestRef: 0.1,
      iris_Fog_color: [...fog, 1],
      iris_Fog_start: far * 0.8,
      iris_Fog_end: far,
      iris_Fog_density: 0.1,
      iris_Fog_scale: 1 / (far * 0.2),
      iris_TextureMatrix0: M.id(),
      iris_TextureMatrix1: new Float32Array([1 / 256, 0, 0, 0, 0, 1 / 256, 0, 0, 0, 0, 1, 0, 1 / 32, 1 / 32, 0, 1]),
    });
    evaluate(this.custom, U, dt);
    this.chunk = [ox - cam[0], oy - cam[1], oz - cam[2]];
  }

  updateLightmap(bright, rain) {
    const key = `${Math.round(bright * 64)}:${rain}`;
    if (this.lmKey === key) return;
    this.lmKey = key;
    const data = new Uint8Array(16 * 16 * 4);
    const curve = (l) => {
      const x = l / 15;
      return x / (4 - 3 * x);
    };
    for (let s = 0; s < 16; s++)
      for (let b = 0; b < 16; b++) {
        const sk = curve(s) * (0.12 + bright * 0.88),
          bl = curve(b) * 1.5;
        const r = Math.min(1, 0.04 + sk + bl * 1.0),
          g = Math.min(1, 0.04 + sk + bl * 0.82),
          bb = Math.min(1, 0.05 + sk * 1.05 + bl * 0.62);
        const i = (s * 16 + b) * 4;
        data[i] = r * 255;
        data[i + 1] = g * 255;
        data[i + 2] = bb * 255;
        data[i + 3] = 255;
      }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lightmap);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  setUniforms(prog, over) {
    const gl = this.gl,
      U = this.U;
    for (const u of prog.uniforms) {
      const v = u.name in over ? over[u.name] : U[u.name];
      if (v === undefined) continue;
      setUniform(gl, u, v);
    }
  }

  bindSamplers(prog, ctx) {
    const gl = this.gl;
    for (const s of prog.samplers) {
      const [tex, smp] = this.resolve(prog, s, ctx);
      gl.activeTexture(gl.TEXTURE0 + s.unit);
      const bindTarget =
        s.type === gl.SAMPLER_3D ? gl.TEXTURE_3D : s.type === gl.SAMPLER_2D_ARRAY ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
      gl.bindTexture(bindTarget, tex);
      gl.bindSampler(s.unit, smp);
    }
  }

  /** Which texture a sampler name means in this pass, Iris-style. */
  resolve(prog, s, ctx) {
    const gl = this.gl;
    const shadowSampler = s.type === gl.SAMPLER_2D_SHADOW;
    const plain2D = s.type === gl.SAMPLER_2D;
    const dummy = () => [
      this.dummies[s.type] || this.dummies[gl.SAMPLER_2D],
      this.sampler(gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, shadowSampler),
    ];
    if (!plain2D && !shadowSampler) return dummy();
    const lin = this.sampler(gl.LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE, false);
    const depthTex = (t) =>
      shadowSampler
        ? [
            t,
            this.hwShadow
              ? this.sampler(gl.LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE, true)
              : this.sampler(gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, true),
          ]
        : [t, this.sampler(gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, false)];
    const raw = s.name;
    const name = ALIAS[raw] || raw;
    const custom = this.customTex[prog.stage]?.[raw] || this.customTex[prog.stage]?.[name] || this.customTex.any?.[raw];
    if (custom && plain2D) return [custom, this.sampler(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR, gl.REPEAT, false)];
    if (shadowSampler && !/^(shadow|watershadow|shadowtex[01])$/.test(name)) return dummy();
    switch (name) {
      case 'gtexture':
        return [
          this.atlas || this.dummies[gl.SAMPLER_2D],
          this.sampler(gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, false),
        ];
      case 'lightmap':
        return [this.lightmap, lin];
      case 'normals':
        return [this.normals, lin];
      case 'specular':
        return [this.specular, lin];
      case 'noisetex':
        return [this.noise, this.sampler(gl.LINEAR, gl.LINEAR, gl.REPEAT, false)];
      case 'watershadow':
        return depthTex(this.shadow0);
      case 'shadow':
        return depthTex(prog.hasWatershadow ? this.shadow1 : this.shadow0);
      case 'shadowtex0':
        return depthTex(this.shadow0);
      case 'shadowtex1':
        return depthTex(this.shadow1);
      case 'shadowcolor0':
        return [this.shadowColor0, lin];
      case 'shadowcolor1':
        return [this.shadowColor1, lin];
      // While drawing geometry depthtex0 is the bound depth buffer; read the pre-translucent copy instead.
      case 'depthtex0':
        return depthTex(ctx.writing ? this.depth1 : this.depth0);
      case 'depthtex1':
        return depthTex(this.depth1);
      case 'depthtex2':
        return depthTex(this.depth2);
    }
    const m = /^colortex(\d+)$/.exec(name);
    if (m && +m[1] < 16) {
      const t = this.target(+m[1]);
      // A gbuffers pass that writes this buffer reads the other copy (WebGL forbids reading what you draw to).
      const side = ctx.writing?.has(t.n) ? t.cur ^ 1 : t.cur;
      const min = !t.filterable ? gl.NEAREST : t.mip && ctx.mip?.has(t.n) ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
      return [t.tex[side], this.sampler(min, t.filterable ? gl.LINEAR : gl.NEAREST, gl.CLAMP_TO_EDGE, false)];
    }
    return dummy();
  }

  applyBlend(prog) {
    const gl = this.gl,
      b = prog.blend;
    if (!b) {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    const f = (n) => gl[n] ?? gl.ONE;
    gl.blendFuncSeparate(f(b[0]), f(b[1]), f(b[2]), f(b[3]));
    if (this.indexed && prog.bufferBlend) {
      prog.drawBuffers.forEach((n, i) => {
        const pb = prog.bufferBlend[n];
        if (pb === undefined) return;
        if (pb === null) this.indexed.disableiOES(gl.BLEND, i);
        else {
          this.indexed.enableiOES(gl.BLEND, i);
          this.indexed.blendFuncSeparateiOES(i, f(pb[0]), f(pb[1]), f(pb[2]), f(pb[3]));
        }
      });
    }
  }

  // ---- the frame

  /**
   * f: { view (three's matrixWorldInverse), fov, aspect, cam, target (local coords), origin, radius,
   *      worldTime, rain, dt, ghosts: bool, hover: [x,y,z] | null, width, height }
   */
  render(f) {
    if (!this.pack || this.lost) return;
    const gl = this.gl;
    this.resize(f.width, f.height);
    this.frameUniforms(f);
    this.frame++;
    const U = this.U;
    const chunk = this.chunk;
    const gbMV = M.translate(U.gbufferModelView, ...chunk);
    const gb = {
      iris_ModelViewMatrix: gbMV,
      iris_ModelViewMatrixInverse: M.invert(gbMV),
      iris_ProjectionMatrix: U.gbufferProjection,
      iris_ProjectionMatrixInverse: U.gbufferProjectionInverse,
      iris_NormalMatrix: M.mat3(U.gbufferModelView),
      modelViewMatrix: U.gbufferModelView,
      modelViewMatrixInverse: U.gbufferModelViewInverse,
      projectionMatrix: U.gbufferProjection,
      projectionMatrixInverse: U.gbufferProjectionInverse,
      normalMatrix: M.mat3(U.gbufferModelView),
      chunkOffset: chunk,
      textureMatrix: M.id(),
    };
    const quadM = M.ortho(0, 1, 0, 1, -1, 1);
    const fs = {
      iris_ModelViewMatrix: M.id(),
      iris_ModelViewMatrixInverse: M.id(),
      iris_ProjectionMatrix: quadM,
      iris_ProjectionMatrixInverse: M.invert(quadM),
      iris_NormalMatrix: M.mat3(M.id()),
      modelViewMatrix: M.id(),
      projectionMatrix: quadM,
      normalMatrix: M.mat3(M.id()),
      chunkOffset: [0, 0, 0],
      textureMatrix: M.id(),
    };
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthFunc(gl.LEQUAL);

    // Clear colour buffers that clear every frame.
    for (let n = 0; n < 16; n++) {
      const t = this.ct[n];
      if (!t || this.clear[`colortex${n}`] === false) continue;
      this.fbo([t.tex[t.cur]], null);
      gl.viewport(0, 0, t.w, t.h);
      const cc =
        this.clearColor[`colortex${n}`] || (n === 0 ? [...this.fogColor, 1] : n === 1 ? [1, 1, 1, 1] : [0, 0, 0, 0]);
      gl.clearColor(cc[0], cc[1], cc[2], cc[3] ?? 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    for (const p of this.begin) this.fullscreen(p, fs);

    // Shadow pass.
    if (this.shadowProg && this.groups.length) {
      const p = this.shadowProg;
      const S = this.shadowRes;
      const colors = p.drawBuffers.map((n, i) =>
        !p.outputs.has(i) ? null : n === 0 ? this.shadowColor0 : n === 1 ? this.shadowColor1 : null,
      );
      this.fbo(colors, this.shadow0);
      gl.viewport(0, 0, S, S);
      gl.clearColor(1, 1, 1, 1);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
      const smv = M.translate(U.shadowModelView, ...chunk);
      const so = {
        iris_ModelViewMatrix: smv,
        iris_ModelViewMatrixInverse: M.invert(smv),
        iris_ProjectionMatrix: U.shadowProjection,
        iris_ProjectionMatrixInverse: U.shadowProjectionInverse,
        iris_NormalMatrix: M.mat3(U.shadowModelView),
        modelViewMatrix: U.shadowModelView,
        modelViewMatrixInverse: U.shadowModelViewInverse,
        projectionMatrix: U.shadowProjection,
        normalMatrix: M.mat3(U.shadowModelView),
        chunkOffset: chunk,
        textureMatrix: M.id(),
      };
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      this.draw(p, this.groups[0], { ...so, renderStage: STAGE.TERRAIN_SOLID, iris_alphaTestRef: 0.1 }, {});
      this.copyDepth(this.shadow0, this.shadow1, S, S);
      if (this.shadowTranslucent) {
        this.fbo(colors, this.shadow0);
        this.draw(p, this.groups[1], { ...so, renderStage: STAGE.TERRAIN_TRANSLUCENT, iris_alphaTestRef: 0.1 }, {});
      }
    }

    for (const p of this.prepare) this.fullscreen(p, fs);

    // Opaque gbuffers: sky, then terrain.
    const gbFbo = (p) => {
      const colors = p.drawBuffers.map((n, i) => {
        if (!p.outputs.has(i)) return null;
        const t = this.target(n);
        return t.tex[t.cur];
      });
      this.fbo(colors, this.depth0);
      gl.viewport(0, 0, this.W, this.H);
    };
    gbFbo(this.terrain);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (this.skyProg) {
      const p = this.skyProg;
      gbFbo(p);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      const sv = {
        ...gb,
        iris_ModelViewMatrix: U.gbufferModelView,
        iris_ModelViewMatrixInverse: U.gbufferModelViewInverse,
        renderStage: STAGE.SKY,
        iris_alphaTestRef: -1,
      };
      this.applyBlend({ blend: p.blend === undefined ? DEFAULT_BLEND : p.blend });
      gl.useProgram(p.p);
      this.setUniforms(p, sv);
      this.bindSamplers(p, { writing: new Set(p.drawBuffers) });
      this.useVao(p, null, this.skyColor);
      gl.drawArrays(gl.TRIANGLES, 0, this.sky.count);
      gl.depthMask(true);
    }
    gl.enable(gl.DEPTH_TEST);
    if (this.groups[0]?.count) {
      gbFbo(this.terrain);
      this.applyBlend(this.terrain);
      this.draw(
        this.terrain,
        this.groups[0],
        { ...gb, renderStage: STAGE.TERRAIN_SOLID, iris_alphaTestRef: this.terrain.alphaRef },
        { writing: new Set(this.terrain.drawBuffers) },
      );
    }
    this.copyDepth(this.depth0, this.depth1, this.W, this.H);
    this.copyDepth(this.depth0, this.depth2, this.W, this.H);

    for (const p of this.deferred) this.fullscreen(p, fs);

    // Translucent gbuffers.
    if (this.groups[1]?.count) {
      const p = this.water;
      gbFbo(p);
      gl.enable(gl.DEPTH_TEST);
      this.applyBlend(p.blend === undefined ? { blend: DEFAULT_BLEND } : p);
      this.draw(
        p,
        this.groups[1],
        { ...gb, renderStage: STAGE.TERRAIN_TRANSLUCENT, iris_alphaTestRef: p.alphaRef },
        { writing: new Set(p.drawBuffers) },
      );
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    for (const p of this.composite) this.fullscreen(p, fs);

    // Final pass to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawBuffers([gl.BACK]);
    gl.viewport(0, 0, this.W, this.H);
    if (this.final) {
      const p = this.final;
      gl.useProgram(p.p);
      this.setUniforms(p, { ...fs, renderStage: STAGE.NONE });
      this.bindSamplers(p, { mip: this.mipFor(p) });
      this.useVao(p, undefined);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      const t = this.target(0);
      gl.useProgram(this.copy.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.tex[t.cur]);
      gl.bindSampler(0, this.sampler(gl.LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE, false));
      this.useVao(this.copy, undefined);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    this.drawOverlay(f, gbMV);
    gl.bindVertexArray(null);
  }

  mipFor(p) {
    const gl = this.gl;
    const set = new Set(p.mipmap || []);
    for (const n of set) {
      const t = this.target(n);
      if (!t.mip) continue;
      gl.bindTexture(gl.TEXTURE_2D, t.tex[t.cur]);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    return set;
  }

  fullscreen(p, fs) {
    const gl = this.gl;
    const mip = this.mipFor(p);
    const targets = p.drawBuffers.filter((_n, i) => p.outputs.has(i)).map((n) => this.target(n));
    this.fbo(
      p.drawBuffers.map((n, i) => (p.outputs.has(i) ? this.target(n).tex[this.target(n).cur ^ 1] : null)),
      null,
    );
    const scale = (this.props[`scale.${p.name}`] || '').trim().split(/\s+/).map(Number);
    const t0 = targets[0] || { w: this.W, h: this.H };
    if (scale[0] > 0 && scale[0] <= 1)
      gl.viewport(
        Math.round((scale[1] || 0) * t0.w),
        Math.round((scale[2] || 0) * t0.h),
        Math.round(scale[0] * t0.w),
        Math.round(scale[0] * t0.h),
      );
    else gl.viewport(0, 0, t0.w, t0.h);
    gl.useProgram(p.p);
    this.applyBlend({ blend: p.blend || null });
    this.setUniforms(p, { ...fs, renderStage: STAGE.NONE });
    this.bindSamplers(p, { mip });
    this.useVao(p, undefined);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Written buffers flip so the next pass reads this one's output; flip.<pass>.<buffer> overrides.
    const written = new Set(targets.map((t) => t.n));
    for (let n = 0; n < 16; n++) {
      const t = this.ct[n];
      if (!t) continue;
      const over =
        this.props[`flip.${p.name}.colortex${n}`] ??
        Object.entries(ALIAS)
          .filter(([, v]) => v === `colortex${n}`)
          .map(([k]) => this.props[`flip.${p.name}.${k}`])
          .find((x) => x != null);
      if (over != null ? over.trim() === 'true' : written.has(n)) t.cur ^= 1;
    }
  }

  draw(p, group, over, ctx) {
    if (!group?.count) return;
    const gl = this.gl;
    gl.useProgram(p.p);
    this.setUniforms(p, over);
    this.bindSamplers(p, ctx);
    this.useVao(p, group);
    gl.drawElements(gl.TRIANGLES, group.count, gl.UNSIGNED_INT, 0);
  }

  copyDepth(src, dst, w, h) {
    const gl = this.gl;
    const a = this.fbo([], src);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, a);
    const key = `copy-${idOf(dst)}`;
    let b = this.fbos.get(key);
    if (!b) {
      b = gl.createFramebuffer();
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, b);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dst, 0);
      gl.drawBuffers([gl.NONE]);
      this.fbos.set(key, b);
    }
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, b);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  drawOverlay(f, gbMV) {
    const gl = this.gl,
      p = this.overlay;
    const mvp = M.mul(this.U.gbufferProjection, gbMV);
    gl.useProgram(p.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depth0);
    gl.bindSampler(0, this.sampler(gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, false));
    const set = (name, v) => {
      const u = p.uniforms.find((x) => x.name === name);
      if (u) setUniform(gl, u, v);
    };
    set('mvp', mvp);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (f.ghosts && this.groups[2]?.count) {
      set('color', [0.66, 0.73, 1, 0.28]);
      set('testDepth', 1);
      this.useVao(p, this.groups[2]);
      gl.drawElements(gl.TRIANGLES, this.groups[2].count, gl.UNSIGNED_INT, 0);
    }
    if (f.hover) {
      if (!this.box) {
        const e = [];
        const c = [
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
          [0, 0, 1],
          [0, 1, 0],
          [1, 1, 0],
          [1, 1, 1],
          [0, 1, 1],
        ].map((v) => v.map((x) => x * 1.02 - 0.01));
        for (const [a, b] of [
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
          e.push(...c[a], ...c[b]);
        this.box = { buf: this.buffer(new Float32Array(e)), vao: gl.createVertexArray() };
        gl.bindVertexArray(this.box.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.box.buf);
        const a = p.attribs.iris_Vertex.loc;
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
      }
      set('mvp', M.translate(mvp, ...f.hover));
      set('color', [1, 1, 1, 0.9]);
      set('testDepth', 0);
      gl.bindVertexArray(this.box.vao);
      gl.drawArrays(gl.LINES, 0, 24);
    }
    gl.disable(gl.BLEND);
  }
}

// ---------------------------------------------------------------- helpers

function firstError(log) {
  const lines = (log || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return (lines.find((l) => /error/i.test(l)) || lines[0] || 'Unknown WebGL error').replace(/^ERROR:\s*0:\d+:\s*/, '');
}

function stageOf(name) {
  if (name.startsWith('gbuffers_')) return 'gbuffers';
  if (name.startsWith('shadowcomp')) return 'shadowcomp';
  if (name.startsWith('shadow')) return 'shadow';
  if (name.startsWith('deferred')) return 'deferred';
  if (name.startsWith('prepare')) return 'prepare';
  if (name.startsWith('begin')) return 'begin';
  return 'composite';
}

function blendOf(props, name) {
  const v = props[`blend.${name}`];
  if (v == null) return undefined;
  const parts = v.trim().split(/\s+/);
  return parts[0].toLowerCase() === 'off' || parts.length < 4 ? null : parts;
}

function isSampler(gl, t) {
  return [
    gl.SAMPLER_2D,
    gl.SAMPLER_3D,
    gl.SAMPLER_CUBE,
    gl.SAMPLER_2D_SHADOW,
    gl.SAMPLER_2D_ARRAY,
    gl.SAMPLER_2D_ARRAY_SHADOW,
    gl.SAMPLER_CUBE_SHADOW,
    gl.INT_SAMPLER_2D,
    gl.INT_SAMPLER_3D,
    gl.INT_SAMPLER_CUBE,
    gl.INT_SAMPLER_2D_ARRAY,
    gl.UNSIGNED_INT_SAMPLER_2D,
    gl.UNSIGNED_INT_SAMPLER_3D,
    gl.UNSIGNED_INT_SAMPLER_CUBE,
    gl.UNSIGNED_INT_SAMPLER_2D_ARRAY,
  ].includes(t);
}

function isIntType(gl, t) {
  return [
    gl.INT,
    gl.INT_VEC2,
    gl.INT_VEC3,
    gl.INT_VEC4,
    gl.UNSIGNED_INT,
    gl.UNSIGNED_INT_VEC2,
    gl.UNSIGNED_INT_VEC3,
    gl.UNSIGNED_INT_VEC4,
  ].includes(t);
}

function setUniform(gl, u, v) {
  const arr = Array.isArray(v) || ArrayBuffer.isView(v) ? v : [v];
  const num = (x) => (typeof x === 'boolean' ? +x : Number.isFinite(+x) ? +x : 0);
  switch (u.type) {
    case gl.FLOAT:
      return gl.uniform1f(u.loc, num(arr[0]));
    case gl.FLOAT_VEC2:
      return gl.uniform2f(u.loc, num(arr[0]), num(arr[1]));
    case gl.FLOAT_VEC3:
      return gl.uniform3f(u.loc, num(arr[0]), num(arr[1]), num(arr[2]));
    case gl.FLOAT_VEC4:
      return gl.uniform4f(u.loc, num(arr[0]), num(arr[1]), num(arr[2]), num(arr[3] ?? 0));
    case gl.INT:
    case gl.BOOL:
      return gl.uniform1i(u.loc, Math.trunc(num(arr[0])));
    case gl.UNSIGNED_INT:
      return gl.uniform1ui(u.loc, Math.max(0, Math.trunc(num(arr[0]))));
    case gl.INT_VEC2:
    case gl.BOOL_VEC2:
      return gl.uniform2i(u.loc, Math.trunc(num(arr[0])), Math.trunc(num(arr[1])));
    case gl.INT_VEC3:
    case gl.BOOL_VEC3:
      return gl.uniform3i(u.loc, Math.trunc(num(arr[0])), Math.trunc(num(arr[1])), Math.trunc(num(arr[2])));
    case gl.INT_VEC4:
    case gl.BOOL_VEC4:
      return gl.uniform4i(
        u.loc,
        Math.trunc(num(arr[0])),
        Math.trunc(num(arr[1])),
        Math.trunc(num(arr[2])),
        Math.trunc(num(arr[3])),
      );
    case gl.FLOAT_MAT3:
      return arr.length === 9 ? gl.uniformMatrix3fv(u.loc, false, arr) : undefined;
    case gl.FLOAT_MAT4:
      return arr.length === 16 ? gl.uniformMatrix4fv(u.loc, false, arr) : undefined;
  }
}

/** Pack buffer formats in WebGL2 terms. Formats WebGL can't render to get the nearest float format. */
function FORMAT(gl, name) {
  const n = String(name).toUpperCase();
  const map = {
    RGBA8: gl.RGBA8,
    RGBA: gl.RGBA8,
    RGB8: gl.RGBA8,
    RGB: gl.RGBA8,
    R8: gl.R8,
    RG8: gl.RG8,
    RGB10_A2: gl.RGB10_A2,
    R11F_G11F_B10F: gl.R11F_G11F_B10F,
    RGBA32F: gl.RGBA32F,
    RGB32F: gl.RGBA32F,
    R32F: gl.R32F,
    RG32F: gl.RG32F,
    R16F: gl.R16F,
    R16: gl.R16F,
    R16_SNORM: gl.R16F,
    R8_SNORM: gl.R16F,
    RG16F: gl.RG16F,
    RG16: gl.RG16F,
    RG16_SNORM: gl.RG16F,
    RG8_SNORM: gl.RG16F,
  };
  return map[n] ?? (/16|SNORM|12|F/.test(n) ? gl.RGBA16F : gl.RGBA8);
}
function FORMAT_NAME(gl, f) {
  return { [gl.RGBA32F]: 'RGBA32F', [gl.R32F]: 'R32F', [gl.RG32F]: 'RG32F' }[f] || '';
}

function randomBytes(n) {
  const a = new Uint8Array(n);
  let s = 1234567;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    a[i] = s >>> 24;
  }
  return a;
}
