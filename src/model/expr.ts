// A small expression language for "Plot a function": numbers, x, pi, e,
// + - * / ^ (right-associative), unary minus, implicit multiplication (2x,
// 3sin(x), (x+1)(x-1)), and sin cos tan asin acos atan sinh cosh tanh exp ln
// log sqrt abs floor ceil sign. No eval: parsed into a function.

type Fn = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Parse an expression in x. Throws an Error with a short message. */
export function parseExpr(src: string): Fn {
  const toks = src.replace(/\\/g, "").match(/\d*\.\d+|\d+\.?|[a-zA-Z]+|\*\*|[-+*/^()|]|\S/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (t: string) => {
    if (next() !== t) throw new Error(`expected ${t}`);
  };

  // sum := term (('+'|'-') term)*
  function sum(): Fn {
    let f = term();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const a = f;
      const b = term();
      f = op === "+" ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
    }
    return f;
  }
  // term := unary (('*'|'/'|implicit) unary)*
  function term(): Fn {
    let f = unary();
    for (;;) {
      const t = peek();
      if (t === "*" || t === "/") {
        next();
        const a = f;
        const b = unary();
        f = t === "*" ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
      } else if (t !== undefined && (t === "(" || /^[a-zA-Z\d.]/.test(t))) {
        // Implicit multiplication: 2x, 3sin(x), (x+1)(x-1)
        const a = f;
        const b = power();
        f = (x) => a(x) * b(x);
      } else return f;
    }
  }
  // unary := '-' unary | '+' unary | power
  function unary(): Fn {
    if (peek() === "-") {
      next();
      const a = unary();
      return (x) => -a(x);
    }
    if (peek() === "+") {
      next();
      return unary();
    }
    return power();
  }
  // power := atom ('^' unary)?   (right-associative: 2^3^2 = 2^9; -x^2 = -(x^2))
  function power(): Fn {
    const a = atom();
    if (peek() === "^" || peek() === "**") {
      next();
      const b = unary();
      return (x) => Math.pow(a(x), b(x));
    }
    return a;
  }
  function atom(): Fn {
    const t = next();
    if (t === undefined) throw new Error("unexpected end");
    if (/^[\d.]/.test(t)) {
      const v = parseFloat(t);
      return () => v;
    }
    if (t === "(") {
      const f = sum();
      expect(")");
      return f;
    }
    if (t === "|") {
      const f = sum();
      expect("|");
      return (x) => Math.abs(f(x));
    }
    if (/^[a-zA-Z]+$/.test(t)) {
      const name = t.toLowerCase();
      if (name === "x") return (x) => x;
      if (name in CONSTS) {
        const v = CONSTS[name];
        return () => v;
      }
      if (name in FUNCS) {
        const g = FUNCS[name];
        // sin(x) or sin x
        const a = peek() === "(" ? atom() : power();
        return (x) => g(a(x));
      }
      throw new Error(`unknown name "${t}"`);
    }
    throw new Error(`unexpected "${t}"`);
  }

  const f = sum();
  if (i < toks.length) throw new Error(`unexpected "${toks[i]}"`);
  return f;
}

/** Pieces of the graph of f on [a, b] as point lists: split where f is
 *  undefined or jumps (1/x, tan x), each with enough points for a smooth curve. */
export function graphPieces(f: Fn, a: number, b: number, n = 24): { x: number; y: number }[][] {
  const N = 400;
  const fine: ({ x: number; y: number } | null)[] = [];
  for (let k = 0; k <= N; k++) {
    const x = a + ((b - a) * k) / N;
    const y = f(x);
    fine.push(Number.isFinite(y) && Math.abs(y) < 1e4 ? { x, y } : null);
  }
  // Split at gaps and at jumps much larger than the typical step.
  const runs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  const steps = fine.flatMap((p, k) => (p && fine[k + 1] ? [Math.abs(fine[k + 1]!.y - p.y)] : [])).sort((u, v) => u - v);
  const typical = steps.length ? steps[Math.floor(steps.length * 0.9)] : 0;
  const jump = Math.max(typical * 20, ((b - a) / N) * 50);
  fine.forEach((p, k) => {
    const prev = k > 0 ? fine[k - 1] : null;
    if (!p || (prev && Math.abs(p.y - prev.y) > jump)) {
      if (cur.length > 1) runs.push(cur);
      cur = p ? [p] : [];
    } else cur.push(p);
  });
  if (cur.length > 1) runs.push(cur);
  // Fewer points for the curve: evenly in x, plus the run's ends.
  return runs.map((r) => {
    const m = Math.max(2, Math.min(r.length, Math.round((n * (r[r.length - 1].x - r[0].x)) / (b - a)) + 1));
    const out: { x: number; y: number }[] = [];
    for (let k = 0; k < m; k++) out.push(r[Math.round(((r.length - 1) * k) / (m - 1))]);
    return out;
  });
}
