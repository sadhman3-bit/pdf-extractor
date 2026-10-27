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
