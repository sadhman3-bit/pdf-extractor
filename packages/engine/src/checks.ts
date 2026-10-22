import type { CheckRule, FieldType, Template } from './template';
import { evaluate, parseExpr, EvalError, type EvalContext, type Node } from './expr';
import { TOLERANCES } from './tolerances';

export type CheckOutcome = 'pass' | 'fail' | 'unknown';

export interface CheckResult {
  id: string;
  label: string;
  severity: 'error' | 'warning';
  result: CheckOutcome;
  message?: string;
}

/** "TotalDue" → "Total Due", "TotalGST" → "Total GST". */
export function humanize(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

const plural = (s: string) => (/s$/i.test(s) ? s : `${s}s`);

function typeOf(n: Node, types: Record<string, FieldType>): FieldType | null {
  if (n.kind === 'name') return types[n.name] ?? null;
  if (n.kind === 'col') return types[`${n.table}.${n.column}`] ?? null;
  if (n.kind === 'call' && ['sum', 'min', 'max', 'avg', 'round', 'abs'].includes(n.fn))
    return typeOf(n.args[0]!, types);
  if (n.kind === 'bin' || n.kind === 'neg') return typeOf(n.kind === 'bin' ? n.left : n.arg, types);
  return null;
}

export function formatAmount(v: number, type: FieldType | null): string {
  const s = Math.abs(v).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = v < 0 ? '-' : '';
  if (type === 'currency') return `${sign}$${s}`;
  if (type === 'integer') return String(v);
  if (Number.isInteger(v) && type !== 'number') return String(v);
  return `${sign}${s}`;
}

function describe(n: Node): string {
  switch (n.kind) {
    case 'name':
      return humanize(n.name);
    case 'col':
      return `${plural(humanize(n.column))} in ${humanize(n.table)}`;
    case 'num':
      return String(n.value);
    case 'call':
      if (n.fn === 'sum' && n.args[0]?.kind === 'col')
        return `${plural(humanize(n.args[0].column))}`;
      if (n.fn === 'count' && n.args[0]?.kind === 'name')
        return `the number of ${humanize(n.args[0].name)} rows`;
      if (n.fn === 'round') return describe(n.args[0]!);
      return `${n.fn}(${n.args.map(describe).join(', ')})`;
    case 'bin':
      return `${describe(n.left)} ${n.op === '/' ? '÷' : n.op === '*' ? '×' : n.op} ${describe(n.right)}`;
    case 'neg':
      return `-${describe(n.arg)}`;
    case 'cmp':
      return `${describe(n.left)} ${n.op} ${describe(n.right)}`;
  }
}

function missingNames(n: Node, ctx: EvalContext): string[] {
  const out: string[] = [];
  const walk = (x: Node) => {
    if (x.kind === 'name' && x.name in ctx.fields && typeof ctx.fields[x.name] !== 'number')
      out.push(humanize(x.name));
    if (x.kind === 'call') {
      if (x.fn === 'exists' || x.fn === 'count') return;
      x.args.forEach(walk);
    }
    if (x.kind === 'bin' || x.kind === 'cmp') {
      walk(x.left);
      walk(x.right);
    }
    if (x.kind === 'neg') walk(x.arg);
  };
  walk(n);
  return [...new Set(out)];
}

export function runCheck(
  rule: CheckRule,
  ctx: Omit<EvalContext, 'tolerance'>,
  types: Record<string, FieldType>,
): CheckResult {
  const severity = rule.severity ?? 'error';
  const base = { id: rule.id, label: rule.label, severity };
  let node: Node;
  try {
    node = parseExpr(rule.expr);
  } catch (e) {
    return {
      ...base,
      result: 'unknown',
      message: `Check “${rule.label}” has an error: ${(e as Error).message}.`,
    };
  }
  const full: EvalContext = { ...ctx, tolerance: rule.tolerance ?? TOLERANCES.approxTolerance };
  let v;
  try {
    v = evaluate(node, full);
  } catch (e) {
    const msg = e instanceof EvalError ? e.message : String(e);
    return { ...base, result: 'unknown', message: `Check “${rule.label}” couldn’t run: ${msg}.` };
  }
  if (v === true) return { ...base, result: 'pass' };
  if (v === null) {
    const miss = missingNames(node, full);
    return {
      ...base,
      result: 'unknown',
      message: miss.length
        ? `Check “${rule.label}” couldn’t be worked out because ${miss.join(' and ')} ${miss.length > 1 ? 'are' : 'is'} missing.`
        : `Check “${rule.label}” couldn’t be worked out because a value is missing.`,
    };
  }
  if (v !== false) {
    return {
      ...base,
      result: 'unknown',
      message: `Check “${rule.label}” doesn’t compare anything.`,
    };
  }
  return { ...base, result: 'fail', message: failMessage(rule, node, full, types) };
}

function failMessage(
  rule: CheckRule,
  node: Node,
  ctx: EvalContext,
  types: Record<string, FieldType>,
): string {
  if (node.kind !== 'cmp') return `Check “${rule.label}” failed.`;
  const l = evaluate(node.left, ctx);
  const r = evaluate(node.right, ctx);
  if (typeof l !== 'number' || typeof r !== 'number') return `Check “${rule.label}” failed.`;
  const type = typeOf(node.left, types) ?? typeOf(node.right, types);
  const fl = formatAmount(l, type);
  const fr = formatAmount(r, type);
  const isSum =
    node.left.kind === 'call' && node.left.fn === 'sum' && node.left.args[0]?.kind === 'col';
  if (isSum && (node.op === '~=' || node.op === '==')) {
    const diff = Math.round((r - l) * 100) / 100;
    const verdict =
      diff > 0 ? `Short by ${formatAmount(diff, type)}.` : `Over by ${formatAmount(-diff, type)}.`;
    return `${describe(node.left)} add up to ${fl}, but ${describe(node.right)} is ${fr}. ${verdict}`;
  }
  const counted =
    node.left.kind === 'call' && node.left.fn === 'count' ? node.left.args[0] : undefined;
  if (counted?.kind === 'name') {
    return `${humanize(counted.name)} has ${l} ${l === 1 ? 'row' : 'rows'}, so “${rule.label}” failed.`;
  }
  return `Check “${rule.label}” failed: ${describe(node.left)} is ${fl}, but ${describe(node.right)} is ${fr}.`;
}

/** Type lookup for field names and Table.Column names. */
export function typeMap(t: Template): Record<string, FieldType> {
  const out: Record<string, FieldType> = {};
  for (const f of t.fields) out[f.name] = f.type ?? 'text';
  for (const tb of t.tables ?? [])
    for (const c of tb.columns) out[`${tb.name}.${c.name}`] = c.type ?? 'text';
  return out;
}

const AMOUNT = /amount|total|value|charge|cost|price/i;
const TOTAL = /^total ?due$|^amount ?(due|payable)$|^total$|^invoice ?total$/i;
const GST = /gst/i;

/** The default checks the mapper offers (section 4.9). */
export function defaultChecks(t: Template): CheckRule[] {
  const out: CheckRule[] = [];
  const req = t.fields.filter((f) => f.required);
  for (const f of req) {
    out.push({
      id: `d-req-${f.name}`,
      label: `${f.name} is present`,
      expr: `exists(${f.name})`,
      severity: 'error',
    });
  }
  const total = t.fields.find(
    (f) => TOTAL.test(humanize(f.name)) && (f.type === 'currency' || f.type === 'number'),
  );
  const gst = t.fields.find(
    (f) => GST.test(f.name) && (f.type === 'currency' || f.type === 'number'),
  );
  for (const tb of t.tables ?? []) {
    const amount = [...tb.columns]
      .reverse()
      .find((c) => (c.type === 'currency' || c.type === 'number') && AMOUNT.test(c.name));
    if (amount && total) {
      out.push({
        id: `d-sum-${tb.name}`,
        label: `${plural(humanize(amount.name))} add up to ${total.name}`,
        expr: `sum(${tb.name}.${amount.name}) ~= ${total.name}`,
        tolerance: 0.01,
        severity: 'error',
      });
    }
  }
  if (total && gst) {
    out.push({
      id: 'd-gst',
      label: `${gst.name} is ${total.name} ÷ 11`,
      expr: `round(${total.name} / 11, 2) ~= ${gst.name}`,
      tolerance: 0.02,
      severity: 'warning',
    });
  }
  for (const tb of t.tables ?? []) {
    out.push({
      id: `d-rows-${tb.name}`,
      label: `At least one row in ${tb.name}`,
      expr: `count(${tb.name}) > 0`,
      severity: 'error',
    });
  }
  return out;
}
