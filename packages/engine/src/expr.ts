// A small hand-written parser and evaluator for check expressions. No eval.
//
// expr       := comparison
// comparison := additive ( ( "==" | "!=" | "~=" | ">" | ">=" | "<" | "<=" ) additive )?
// additive   := term ( ( "+" | "-" ) term )*
// term       := unary ( ( "*" | "/" ) unary )*
// unary      := "-" unary | primary
// primary    := number | name | call | "(" expr ")"

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'col'; table: string; column: string }
  | { kind: 'neg'; arg: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Node; right: Node }
  | { kind: 'cmp'; op: CmpOp; left: Node; right: Node }
  | { kind: 'call'; fn: Fn; args: Node[] };

export type CmpOp = '==' | '!=' | '~=' | '>' | '>=' | '<' | '<=';
export const FUNCTIONS = ['sum', 'count', 'min', 'max', 'avg', 'round', 'abs', 'exists'] as const;
export type Fn = (typeof FUNCTIONS)[number];
const AGGREGATES: Fn[] = ['sum', 'min', 'max', 'avg', 'count'];

export class ExprError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

type Tok = { t: 'num' | 'id' | 'op' | '(' | ')' | ',' | 'eof'; v: string; at: number };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+(\.\d*)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new ExprError(`Unexpected "${ch}"`, i);
      out.push({ t: 'num', v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '~=', '>=', '<='].includes(two)) {
      out.push({ t: 'op', v: two, at: i });
      i += 2;
      continue;
    }
    if ('+-*/<>'.includes(ch)) {
      out.push({ t: 'op', v: ch, at: i });
      i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      out.push({ t: ch, v: ch, at: i });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected "${ch}"`, i);
  }
  out.push({ t: 'eof', v: '', at: src.length });
  return out;
}

export function parseExpr(src: string): Node {
  const toks = lex(src);
  let pos = 0;
  const peek = () => toks[pos]!;
  const next = () => toks[pos++]!;
  const expect = (t: Tok['t'], what: string) => {
    const k = next();
    if (k.t !== t) throw new ExprError(`Expected ${what}`, k.at);
    return k;
  };

  function comparison(): Node {
    const left = additive();
    const k = peek();
    if (k.t === 'op' && ['==', '!=', '~=', '>', '>=', '<', '<='].includes(k.v)) {
      next();
      const right = additive();
      return { kind: 'cmp', op: k.v as CmpOp, left, right };
    }
    return left;
  }
  function additive(): Node {
    let left = term();
    for (;;) {
      const k = peek();
      if (k.t === 'op' && (k.v === '+' || k.v === '-')) {
        next();
        left = { kind: 'bin', op: k.v, left, right: term() };
      } else return left;
    }
  }
  function term(): Node {
    let left = unary();
    for (;;) {
      const k = peek();
      if (k.t === 'op' && (k.v === '*' || k.v === '/')) {
        next();
        left = { kind: 'bin', op: k.v, left, right: unary() };
      } else return left;
    }
  }
  function unary(): Node {
    const k = peek();
    if (k.t === 'op' && k.v === '-') {
      next();
      return { kind: 'neg', arg: unary() };
    }
    return primary();
  }
  function primary(): Node {
    const k = next();
    if (k.t === 'num') return { kind: 'num', value: Number(k.v) };
    if (k.t === '(') {
      const e = comparison();
      expect(')', '")"');
      return e;
    }
    if (k.t === 'id') {
      if (peek().t === '(') {
        const fn = k.v as Fn;
        if (!FUNCTIONS.includes(fn)) throw new ExprError(`Unknown function "${k.v}"`, k.at);
        next();
        const args: Node[] = [];
        if (peek().t !== ')') {
          args.push(argument(fn));
          while (peek().t === ',') {
            next();
            args.push(argument(fn));
          }
        }
        expect(')', '")"');
        validateCall(fn, args, k.at);
        return { kind: 'call', fn, args };
      }
      if (k.v.includes('.'))
        throw new ExprError(`"${k.v}" can only be used inside sum, min, max, avg or count`, k.at);
      return { kind: 'name', name: k.v };
    }
    if (k.t === 'eof') throw new ExprError('Expression is incomplete', k.at);
    throw new ExprError(`Unexpected "${k.v}"`, k.at);
  }
  function argument(fn: Fn): Node {
    const k = peek();
    if (k.t === 'id' && k.v.includes('.') && toks[pos + 1]?.t !== '(') {
      if (!AGGREGATES.includes(fn))
        throw new ExprError(`"${k.v}" can only be used inside sum, min, max, avg or count`, k.at);
      next();
      const [table, column] = k.v.split('.') as [string, string];
      return { kind: 'col', table, column };
    }
    return comparison();
  }
  function validateCall(fn: Fn, args: Node[], at: number) {
    const n = args.length;
    if (fn === 'round' && (n < 1 || n > 2)) throw new ExprError('round takes 1 or 2 values', at);
    if ((fn === 'abs' || fn === 'exists' || fn === 'count') && n !== 1)
      throw new ExprError(`${fn} takes 1 value`, at);
    if (fn === 'exists' && args[0]!.kind !== 'name')
      throw new ExprError('exists takes a field name', at);
    if (fn === 'count' && args[0]!.kind !== 'name' && args[0]!.kind !== 'col')
      throw new ExprError('count takes a table name', at);
    if (n === 0) throw new ExprError(`${fn} needs a value`, at);
  }

  const e = comparison();
  const k = peek();
  if (k.t !== 'eof') throw new ExprError(`Unexpected "${k.v}"`, k.at);
  return e;
}

/** Names an expression refers to (fields and table columns). */
export function references(n: Node): { fields: string[]; tables: string[]; columns: string[] } {
  const out = { fields: new Set<string>(), tables: new Set<string>(), columns: new Set<string>() };
  const walk = (x: Node) => {
    switch (x.kind) {
      case 'name':
        out.fields.add(x.name);
        break;
      case 'col':
        out.tables.add(x.table);
        out.columns.add(`${x.table}.${x.column}`);
        break;
      case 'neg':
        walk(x.arg);
        break;
      case 'bin':
      case 'cmp':
        walk(x.left);
        walk(x.right);
        break;
      case 'call':
        if (x.fn === 'count' && x.args[0]?.kind === 'name') out.tables.add(x.args[0].name);
        else x.args.forEach(walk);
        break;
    }
  };
  walk(n);
  return { fields: [...out.fields], tables: [...out.tables], columns: [...out.columns] };
}

// ---------------------------------------------------------------- evaluation

export type EvalValue = number | boolean | null;

export interface EvalContext {
  fields: Record<string, string | number | null>;
  tables: Record<string, Record<string, string | number | null>[]>;
  tolerance: number;
}

export class EvalError extends Error {}

const num = (v: EvalValue | string | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function evaluate(n: Node, ctx: EvalContext): EvalValue {
  switch (n.kind) {
    case 'num':
      return n.value;
    case 'name': {
      if (!(n.name in ctx.fields)) {
        if (n.name in ctx.tables)
          throw new EvalError(`"${n.name}" is a table; use count(${n.name})`);
        throw new EvalError(`Unknown field "${n.name}"`);
      }
      const v = ctx.fields[n.name];
      return typeof v === 'number' ? v : null;
    }
    case 'col':
      throw new EvalError(
        `"${n.table}.${n.column}" can only be used inside sum, min, max, avg or count`,
      );
    case 'neg': {
      const v = num(evaluate(n.arg, ctx));
      return v === null ? null : -v;
    }
    case 'bin': {
      const a = num(evaluate(n.left, ctx));
      const b = num(evaluate(n.right, ctx));
      if (a === null || b === null) return null;
      switch (n.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? null : a / b;
      }
      return null;
    }
    case 'cmp': {
      const a = evaluate(n.left, ctx);
      const b = evaluate(n.right, ctx);
      if (a === null || b === null) return null;
      if (typeof a === 'boolean' || typeof b === 'boolean') {
        if (n.op === '==') return a === b;
        if (n.op === '!=') return a !== b;
        throw new EvalError('Only == and != can compare true/false values');
      }
      const eps = 1e-9;
      switch (n.op) {
        case '==':
          return Math.abs(a - b) < eps;
        case '!=':
          return Math.abs(a - b) >= eps;
        case '~=':
          return Math.abs(a - b) <= ctx.tolerance + eps;
        case '>':
          return a > b;
        case '>=':
          return a >= b - eps;
        case '<':
          return a < b;
        case '<=':
          return a <= b + eps;
      }
      return null;
    }
    case 'call':
      return call(n.fn, n.args, ctx);
  }
}

function columnValues(n: Node, ctx: EvalContext): (number | null)[] | null {
  if (n.kind !== 'col') return null;
  const rows = ctx.tables[n.table];
  if (!rows) throw new EvalError(`Unknown table "${n.table}"`);
  return rows.map((r) => {
    if (!(n.column in r)) throw new EvalError(`Unknown column "${n.table}.${n.column}"`);
    const v = r[n.column];
    return typeof v === 'number' ? v : null;
  });
}

function call(fn: Fn, args: Node[], ctx: EvalContext): EvalValue {
  if (fn === 'exists') {
    const a = args[0]!;
    if (a.kind !== 'name') throw new EvalError('exists takes a field name');
    if (!(a.name in ctx.fields)) throw new EvalError(`Unknown field "${a.name}"`);
    const v = ctx.fields[a.name];
    return v !== null && v !== undefined && v !== '';
  }
  if (fn === 'count') {
    const a = args[0]!;
    if (a.kind === 'name') {
      const rows = ctx.tables[a.name];
      if (!rows) throw new EvalError(`Unknown table "${a.name}"`);
      return rows.length;
    }
    if (a.kind !== 'col') throw new EvalError('count takes a table name');
    const rows = ctx.tables[a.table];
    if (!rows) throw new EvalError(`Unknown table "${a.table}"`);
    return rows.filter(
      (r) => r[a.column] !== null && r[a.column] !== undefined && r[a.column] !== '',
    ).length;
  }
  if (fn === 'round') {
    const v = num(evaluate(args[0]!, ctx));
    const d = args[1] ? num(evaluate(args[1], ctx)) : 0;
    if (v === null || d === null) return null;
    const f = 10 ** d;
    return Math.round((v + Math.sign(v) * Number.EPSILON) * f) / f;
  }
  if (fn === 'abs') {
    const v = num(evaluate(args[0]!, ctx));
    return v === null ? null : Math.abs(v);
  }
  // sum, min, max, avg over a column or a list of values.
  let values: (number | null)[];
  if (args.length === 1 && args[0]!.kind === 'col') {
    values = columnValues(args[0]!, ctx)!.filter((v) => v !== null);
  } else {
    values = args.map((a) => num(evaluate(a, ctx)));
    if (values.some((v) => v === null)) return null;
  }
  const xs = values as number[];
  switch (fn) {
    case 'sum':
      return Math.round(xs.reduce((s, v) => s + v, 0) * 1e6) / 1e6;
    case 'min':
      return xs.length ? Math.min(...xs) : null;
    case 'max':
      return xs.length ? Math.max(...xs) : null;
    case 'avg':
      return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
  }
  return null;
}

/** Validates an expression against known names. Returns an error message or null. */
export function validateExpr(
  src: string,
  known: { fields: string[]; tables: Record<string, string[]> },
): string | null {
  let node: Node;
  try {
    node = parseExpr(src);
  } catch (e) {
    return (e as Error).message;
  }
  const refs = references(node);
  for (const f of refs.fields) {
    if (!known.fields.includes(f) && !(f in known.tables)) return `Unknown field "${f}"`;
  }
  for (const c of refs.columns) {
    const [t, col] = c.split('.') as [string, string];
    if (!(t in known.tables)) return `Unknown table "${t}"`;
    if (!known.tables[t]!.includes(col)) return `Unknown column "${c}"`;
  }
  return null;
}
