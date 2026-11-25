// Custom uniforms from shaders.properties: `uniform.float.x = <expr>` and `variable.float.y = <expr>`.
// The expression language is OptiFine's: arithmetic, comparisons, && || !, member access (cameraPosition.y)
// and functions like if(), smooth(), clamp(), in(), between().

const FN = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: Math.atan2, torad: (x) => (x * Math.PI) / 180, todeg: (x) => (x * 180) / Math.PI,
  min: Math.min, max: Math.max, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, exp: Math.exp,
  exp2: (x) => 2 ** x, log: Math.log, log2: Math.log2, log10: Math.log10, pow: Math.pow, sqrt: Math.sqrt,
  cbrt: Math.cbrt, round: Math.round, signum: Math.sign, sign: Math.sign, hypot: Math.hypot,
  frac: (x) => x - Math.floor(x), fract: (x) => x - Math.floor(x),
  fmod: (a, b) => (b ? a - b * Math.floor(a / b) : 0),
  clamp: (x, a, b) => Math.min(Math.max(x, a), b),
  random: () => Math.random(),
  between: (x, a, b) => (x >= a && x <= b ? 1 : 0),
  equals: (a, b, eps) => (Math.abs(a - b) <= (eps ?? 0) ? 1 : 0),
  in: (x, ...list) => (list.includes(x) ? 1 : 0),
  vec2: (...a) => a, vec3: (...a) => a, vec4: (...a) => a,
};

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|([A-Za-z_][\w]*)|(&&|\|\||==|!=|<=|>=|[-+*/%()<>!,.?:]))/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    // After a name or ")", a dot is member access (m.1.2), never the start of a number like .5
    const prev = out[out.length - 1];
    if (src[at] === '.' && prev && (prev.t === 'id' || prev.v === ')' || prev.member)) {
      out.push({ t: 'op', v: '.' });
      const num = /\d+/y;
      num.lastIndex = at + 1;
      const d = num.exec(src);
      if (d) { out.push({ t: 'num', v: +d[0], raw: d[0], member: true }); re.lastIndex = num.lastIndex; } else re.lastIndex = at + 1;
      continue;
    }
    if (!(m = re.exec(src))) {
      if (/^\s*$/.test(src.slice(at))) break;
      throw new Error(`Unexpected "${src.slice(at, at + 8)}"`);
    }
    if (m[1] != null) out.push({ t: 'num', v: parseFloat(m[1]), raw: m[1] });
    else if (m[2] != null) out.push({ t: 'id', v: m[2] });
    else out.push({ t: 'op', v: m[3] });
  }
  return out;
}

const BIN = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

/** Compiles one expression to a function of (scope, dt). Each smooth() call keeps its own state. */
export function compile(src) {
  const tk = tokenize(src);
  let i = 0;
  const peek = () => tk[i];
  const take = (v) => {
    const t = tk[i];
    if (!t || (v && t.v !== v)) throw new Error(`Expected ${v || 'more input'}`);
    i++;
    return t;
  };

  function primary() {
    const t = take();
    if (t.t === 'num') return () => t.v;
    if (t.t === 'op' && t.v === '(') { const e = expr(0); take(')'); return e; }
    if (t.t === 'op' && t.v === '-') { const e = unary(); return (s, dt) => -e(s, dt); }
    if (t.t === 'op' && t.v === '!') { const e = unary(); return (s, dt) => (truthy(e(s, dt)) ? 0 : 1); }
    if (t.t === 'op' && t.v === '+') return unary();
    if (t.t !== 'id') throw new Error(`Unexpected "${t.v}"`);
    if (t.v === 'true') return () => 1;
    if (t.v === 'false') return () => 0;
    if (t.v === 'pi' || t.v === 'PI') return () => Math.PI;
    if (peek()?.v === '(') {
      take('(');
      const args = [];
      if (peek()?.v !== ')') { do args.push(expr(0)); while (peek()?.v === ',' && take(',')); }
      take(')');
      return call(t.v, args);
    }
    const name = t.v;
    return (s) => (name in s ? s[name] : name.startsWith('BIOME_') ? -999 : 0);
  }

  function unary() {
    let e = primary();
    while (peek()?.v === '.') {
      take('.');
      const t = take();
      // Vector members (.x .y .z .w) or matrix elements: gbufferProjection.1.1 is column 1, row 1.
      let idx;
      if (t.t === 'num') {
        idx = +t.raw;
        if (peek()?.v === '.' && tk[i + 1]?.member) { take('.'); idx = idx * 4 + +take().raw; }
      } else idx = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 }[t.v] ?? 0;
      const inner = e;
      e = (s, dt) => { const v = inner(s, dt); return Array.isArray(v) || ArrayBuffer.isView(v) ? v[idx] ?? 0 : v; };
    }
    return e;
  }

  function expr(minPrec) {
    let left = unary();
    for (;;) {
      const op = peek();
      if (!op || op.t !== 'op') break;
      if (op.v === '?' && minPrec === 0) {
        take('?');
        const a = expr(0); take(':'); const b = expr(0); const c = left;
        left = (s, dt) => (truthy(c(s, dt)) ? a(s, dt) : b(s, dt));
        continue;
      }
      const p = BIN[op.v];
      if (!p || p <= minPrec) break;
      take();
      const right = expr(p);
      left = binary(op.v, left, right);
    }
    return left;
  }

  const e = expr(0);
  if (i < tk.length) throw new Error(`Unexpected "${tk[i].v}"`);
  return e;
}

const truthy = (v) => (Array.isArray(v) ? v.some((x) => x) : v !== 0 && !Number.isNaN(v));

function binary(op, a, b) {
  const num = (f) => (s, dt) => {
    const x = a(s, dt), y = b(s, dt);
    if (Array.isArray(x) || Array.isArray(y)) {
      const n = Math.max(x.length || 0, y.length || 0);
      return Array.from({ length: n }, (_, k) => f(Array.isArray(x) ? x[k] : x, Array.isArray(y) ? y[k] : y));
    }
    return f(x, y);
  };
  switch (op) {
    case '+': return num((x, y) => x + y);
    case '-': return num((x, y) => x - y);
    case '*': return num((x, y) => x * y);
    case '/': return num((x, y) => (y === 0 ? 0 : x / y));
    case '%': return num((x, y) => (y === 0 ? 0 : x % y));
    case '<': return (s, dt) => (a(s, dt) < b(s, dt) ? 1 : 0);
    case '>': return (s, dt) => (a(s, dt) > b(s, dt) ? 1 : 0);
    case '<=': return (s, dt) => (a(s, dt) <= b(s, dt) ? 1 : 0);
    case '>=': return (s, dt) => (a(s, dt) >= b(s, dt) ? 1 : 0);
    case '==': return (s, dt) => (a(s, dt) === b(s, dt) ? 1 : 0);
    case '!=': return (s, dt) => (a(s, dt) !== b(s, dt) ? 1 : 0);
    case '&&': return (s, dt) => (truthy(a(s, dt)) && truthy(b(s, dt)) ? 1 : 0);
    case '||': return (s, dt) => (truthy(a(s, dt)) || truthy(b(s, dt)) ? 1 : 0);
  }
  throw new Error(`Unknown operator ${op}`);
}

function call(name, args) {
  if (name === 'if') {
    // if(cond1, val1, cond2, val2, ..., else)
    return (s, dt) => {
      let k = 0;
      for (; k + 1 < args.length; k += 2) if (truthy(args[k](s, dt))) return args[k + 1](s, dt);
      return k < args.length ? args[k](s, dt) : 0;
    };
  }
  if (name === 'smooth') {
    // smooth([id,] value, [fadeUpSeconds, [fadeDownSeconds]]): eases toward the value over time.
    const a = args.length === 4 ? args.slice(1) : args; // the optional leading id only exists in the 4-argument form
    const state = { v: null };
    return (s, dt) => {
      const target = a[0](s, dt);
      if (state.v === null) return (state.v = target);
      const up = a[1] ? a[1](s, dt) : 1, down = a[2] ? a[2](s, dt) : up;
      const t = Math.max(1e-3, target > state.v ? up : down);
      state.v += (target - state.v) * (1 - Math.exp(-dt / t));
      return state.v;
    };
  }
  const f = FN[name];
  if (!f) throw new Error(`Unknown function ${name}()`);
  return (s, dt) => f(...args.map((x) => x(s, dt)));
}

/** Parses all custom uniforms/variables of a pack, in file order. Bad expressions are reported, not fatal. */
export function customUniforms(props) {
  const out = [], errors = [];
  for (const [k, v] of Object.entries(props)) {
    const m = /^(uniform|variable)\.(float|int|bool|vec2|vec3|vec4)\.(\w+)$/.exec(k);
    if (!m) continue;
    try {
      out.push({ uniform: m[1] === 'uniform', type: m[2], name: m[3], fn: compile(v) });
    } catch (e) {
      errors.push(`${m[3]}: ${e.message}`);
    }
  }
  return { list: out, errors };
}

/** Runs all custom uniforms into scope (variables too, since later expressions may read them). */
export function evaluate(list, scope, dt) {
  for (const u of list) {
    let v = u.fn(scope, dt);
    if (u.type === 'int') v = Array.isArray(v) ? v : Math.trunc(v);
    else if (u.type === 'bool') v = truthy(v) ? 1 : 0;
    scope[u.name] = v;
  }
}
