// Reads back the line patterns the Mapper writes (groupFor, skipPatternFor and
// the defaults) so they can be shown in plain words. Anything else is shown as
// the pattern itself.
import type { GroupRule, TableRule } from '@pdfx/engine';

export type LinePattern =
  /** Lines that start with these words. */
  | { kind: 'startsWith'; text: string }
  /** Lines that are exactly this text. */
  | { kind: 'exactly'; text: string }
  /** A heading in capitals on its own line (a company name). */
  | { kind: 'capitals' }
  /** A heading without numbers on its own line (a section name). */
  | { kind: 'words' }
  /** "Page 3 of 12". */
  | { kind: 'pageNumbers' }
  | { kind: 'pattern'; pattern: string };

const unescape = (s: string) => s.replace(/\\(.)/g, '$1');
const plain = (s: string) => !/(^|[^\\])[.*+?^${}()|[\]]/.test(s);

export function readPattern(pattern: string): LinePattern {
  if (pattern === 'Page \\d+ of \\d+$') return { kind: 'pageNumbers' };
  if (pattern === '^[^a-z\\d]+$') return { kind: 'capitals' };
  if (pattern === '^(?=.*[a-z])[^\\d]+$' || pattern === '^[^\\d]+$') return { kind: 'words' };
  let m = /^\^(.+?)(?:\(\?=\\s\|\$\)|\\s\+\(\.\+\)\$)$/.exec(pattern);
  if (m && plain(m[1]!)) return { kind: 'startsWith', text: unescape(m[1]!) };
  m = /^\^(.+)\$$/.exec(pattern);
  if (m && plain(m[1]!)) return { kind: 'exactly', text: unescape(m[1]!) };
  m = /^\^(.+)$/.exec(pattern);
  if (m && plain(m[1]!)) return { kind: 'startsWith', text: unescape(m[1]!) };
  return { kind: 'pattern', pattern };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern for lines to skip, written from a plain choice (the reverse of readPattern). */
export function skipPattern(m: LinePattern): string {
  switch (m.kind) {
    case 'startsWith':
      return String.raw`^${escapeRe(m.text.trim())}(?=\s|$)`;
    case 'exactly':
      return `^${escapeRe(m.text.trim())}$`;
    case 'capitals':
      return String.raw`^[^a-z\d]+$`;
    case 'words':
      return String.raw`^(?=.*[a-z])[^\d]+$`;
    case 'pageNumbers':
      return String.raw`Page \d+ of \d+$`;
    case 'pattern':
      return m.pattern;
  }
}

/**
 * A heading rule from a plain choice. "Starts with" copies the rest of the line;
 * capitals and words copy a whole line that stands on its own.
 */
export function headingRule(name: string, m: LinePattern): GroupRule {
  if (m.kind === 'startsWith')
    return { name, pattern: String.raw`^${escapeRe(m.text.trim())}\s+(.+)$`, capture: 1 };
  if (m.kind === 'capitals' || m.kind === 'words')
    return { name, pattern: skipPattern(m), lone: true };
  if (m.kind === 'exactly') return { name, pattern: skipPattern(m) };
  return { name, pattern: skipPattern(m), capture: /\(/.test(skipPattern(m)) ? 1 : 0 };
}

/** How a row-start pattern reads: any text, the shape of a value ("99/99/9999"), or a start. */
export type RowStart =
  | { kind: 'any' }
  | { kind: 'shape'; example: string }
  | { kind: 'startsWith'; text: string }
  | { kind: 'pattern'; pattern: string };

export function readRowStart(pattern: string): RowStart {
  if (pattern === '\\S') return { kind: 'any' };
  // The Mapper writes the first value's shape: \d{2}/\d{2}/\d{4} reads "99/99/9999".
  const shape = /^\^(.+)\$$/.exec(pattern)?.[1];
  if (shape && !/[a-z]{2}|[()|*+?[\]]/i.test(shape.replace(/\\d\{\d+\}|\\d/g, '')))
    return {
      kind: 'shape',
      example: unescape(shape.replace(/\\d\{(\d+)\}/g, (_, n: string) => '9'.repeat(Number(n))))
        .replace(/\\d/g, '9')
        .replace(/d/g, '9'),
    };
  const m = readPattern(pattern);
  if (m.kind === 'startsWith') return { kind: 'startsWith', text: m.text };
  return { kind: 'pattern', pattern };
}

export function rowStartPattern(r: RowStart): string {
  switch (r.kind) {
    case 'any':
      return '\\S';
    case 'shape':
      return `^${r.example
        .split('')
        .map((ch) => (/\d/.test(ch) ? '\\d' : escapeRe(ch)))
        .join('')
        .replace(/(\\d)+/g, (m) => `\\d{${m.length / 2}}`)}$`;
    case 'startsWith':
      return `^${escapeRe(r.text.trim())}`;
    case 'pattern':
      return r.pattern;
  }
}

export interface LineRuleView {
  kind: 'row' | 'heading' | 'skip' | 'end';
  /** Heading: the CSV column it fills. */
  name?: string;
  match: LinePattern;
  /** Index in `groups` or `skip`, for removing it. */
  index?: number;
}

/** A table's line rules, in the order the engine applies them. */
export function lineRules(t: TableRule): LineRuleView[] {
  const out: LineRuleView[] = [];
  if (t.rowStart)
    out.push({
      kind: 'row',
      name: t.rowStart.column,
      match:
        t.rowStart.pattern === '\\S'
          ? { kind: 'words' }
          : { kind: 'pattern', pattern: t.rowStart.pattern },
    });
  (t.groups ?? []).forEach((g: GroupRule, index) =>
    out.push({ kind: 'heading', name: g.name, match: readPattern(g.pattern), index }),
  );
  (t.skip ?? []).forEach((p, index) => out.push({ kind: 'skip', match: readPattern(p), index }));
  if (t.end)
    out.push({ kind: 'end', match: { kind: 'startsWith', text: t.end.labels.join(' / ') } });
  return out;
}
