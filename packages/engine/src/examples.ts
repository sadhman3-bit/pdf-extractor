import type { DocLayout, Line, Token } from './types';
import type { GroupRule, TableRule } from './template';
import { blockFromHeading, rowsLike, skipPatternFor, suggestTable, tableFrame } from './infer';
import { cx, phrases } from './layout';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shape = (s: string) => escape(s).replace(/\d+/g, '\\d+').replace(/\s+/g, '\\s+');
const union = (a: string, b: string) => (a === b ? a : `(?:${a})|(?:${b})`);

/** Learn a selected heading fragment or a whole table cell without storing document coordinates. */
export function learnExample(
  layout: DocLayout,
  existing: TableRule | null,
  selected: Token[],
  name: string,
): TableRule | null {
  if (!selected.length || !name.trim()) return null;
  name = name.trim();
  const lines = layout.pages.flatMap((p) => p.lines);
  const parts = lines.filter((l) => selected.some((t) => l.tokens.includes(t)));
  const line = parts[0];
  if (
    !line ||
    parts.length > 5 ||
    parts.some((l, i) => l.page !== line.page || (i > 0 && l.index !== parts[i - 1]!.index + 1))
  )
    return null;
  const indices = selected
    .filter((t) => line.tokens.includes(t))
    .map((t) => line.tokens.indexOf(t))
    .sort((a, b) => a - b);
  if (indices.at(-1)! - indices[0]! + 1 !== indices.length) return null;
  if (
    parts.length > 1 &&
    (indices.at(-1) !== line.tokens.length - 1 ||
      parts
        .slice(1)
        .some(
          (l) =>
            l.tokens.some((t) => !selected.includes(t)) ||
            Math.abs(l.x0 - line.x0) > 12 ||
            l.cy - parts[parts.indexOf(l) - 1]!.cy > 24 ||
            /^\s*(?:Total|Subtotal)\b/i.test(l.text),
        ))
  )
    return null;
  const initial = existing ?? suggestTable(layout)?.rule;
  if (!initial) return null;
  let rule: TableRule = initial;
  const initialFrame = tableFrame(layout, initial);
  if (
    !initialFrame ||
    line.page < initialFrame.page ||
    (line.page === initialFrame.page && line.y0 <= initialFrame.bbox[3])
  )
    return null;
  const text = [
    ...indices.map((i) => line.tokens[i]!.text),
    ...parts.slice(1).map((l) => l.text),
  ].join(' ');
  const before = line.tokens
    .slice(0, indices[0])
    .map((t) => t.text)
    .join(' ');
  const after = line.tokens
    .slice(indices.at(-1)! + 1)
    .map((t) => t.text)
    .join(' ');
  const heading = blockFromHeading(rule, line);
  const number = /[+\d][\d ()-]{6,}\d/.exec(line.text);
  // A heading has a number and words after it, or the selected number itself.
  // Totals and ordinary data rows are learned as table cells below.
  if (
    number &&
    heading.block?.keyGroup &&
    before.length > 0 &&
    !/^\s*(?:total|subtotal)\b/i.test(line.text) &&
    (before.includes(number[0].trim()) || /^[+\d][\d ()-]+$/.test(text))
  ) {
    if (rule.columns.some((c) => c.name === name)) return null;
    const flexibleBefore = before.includes(number[0].trim())
      ? `${shape(before.slice(0, before.indexOf(number[0].trim())).trim())}\\s+[+\\d][\\d ()-]{6,}\\d`
      : shape(before);
    const pattern = /^[+\d][\d ()-]+$/.test(text)
      ? `^${shape(before)}\\s+([+\\d][\\d ()-]{6,}\\d)(?=\\s|$)`
      : `^${flexibleBefore}\\s+((?![\\d ()-]+$).+?)${after ? `\\s+${shape(after)}` : ''}$`;
    const groups: GroupRule[] = rule.block
      ? [...(rule.groups ?? [])]
      : heading.groups!.filter((g) => g.name !== 'Name');
    const prior = groups.find((g) => g.name === name);
    if (
      prior?.examples?.some((e) => {
        try {
          const match = new RegExp(e.pattern).exec(line.text);
          return (
            match &&
            match[1]?.trim() !== text &&
            !(parts.length > 1 && text.startsWith(match[1]!.trim() + ' '))
          );
        } catch {
          return true;
        }
      })
    )
      return null;
    const examples = [...(prior?.examples ?? [])];
    if (!examples.some((e) => e.pattern === pattern && e.text === text))
      examples.push({ text, pattern });
    // Other headings are safe candidates only when their service key has a matching total.
    // Keep the labels from this document rather than guessing supplier-specific words.
    const totalKeys = new Set(
      lines
        .filter((l) => /^\s*Total\b/i.test(l.text))
        .map((l) =>
          /[+\d][\d ()-]{6,}\d/.exec(phrases(l)[0]?.text ?? l.text)?.[0].replace(/[ ()-]/g, ''),
        )
        .filter(Boolean),
    );
    const candidates = lines.filter((l) => {
      if (
        l.page < initialFrame.page ||
        (l.page === initialFrame.page && l.y0 <= initialFrame.bbox[3]) ||
        Math.abs(l.x0 - line.x0) > 3 ||
        /^\s*(?:Total|Subtotal)\b/i.test(l.text)
      )
        return false;
      const n = /[+\d][\d ()-]{6,}\d/.exec(l.text);
      if (!n || n.index === 0) return false;
      const key = n[0].replace(/[ ()-]/g, '');
      return totalKeys.has(key);
    });
    const prefixes = [
      ...new Set(
        candidates.map((l) => l.text.slice(0, /[+\d][\d ()-]{6,}\d/.exec(l.text)!.index).trim()),
      ),
    ];
    const prefixPattern = `(?:${prefixes.map(shape).join('|')})`;
    const wholeName = before.trim().endsWith(number[0].trim()) && !after;
    const following = candidates.map((l) => lines[lines.indexOf(l) + 1]).filter((l) => !!l);
    const bodyLabels = [
      ...new Set(
        following
          .filter((l) => following.filter((other) => other.text === l.text).length >= 2)
          .map((l) => l.text),
      ),
    ];
    const wrapGaps: number[] = [];
    if (wholeName)
      for (const candidate of candidates) {
        const at = lines.indexOf(candidate);
        const continuation = lines[at + 1];
        const body = lines[at + 2];
        if (
          continuation &&
          body &&
          continuation.page === candidate.page &&
          body.page === candidate.page &&
          bodyLabels.includes(body.text) &&
          !bodyLabels.includes(continuation.text) &&
          !/[\d$]/.test(continuation.text) &&
          Math.abs(continuation.x0 - candidate.x0) <= 3 &&
          continuation.cy - candidate.cy <= 18
        )
          wrapGaps.push(continuation.cy - candidate.cy);
      }
    if (wholeName && prefixes.length && !examples.some((e) => !e.text))
      examples.push({
        text: '',
        pattern: `^${prefixPattern}\\s+[+\\d][\\d ()-]{6,}\\d\\s+((?![\\d ()-]+$).+?)$`,
      });
    const group: GroupRule = { name, pattern, capture: 1, examples };
    const others = groups
      .filter((g) => g.name !== name)
      .map((g) => {
        const fresh = heading.groups?.find((h) => h.name === g.name);
        // Phone prefixes differ between service types; keep capture group one.
        if (fresh && g.name === (rule.block?.keyGroup ?? heading.block?.keyGroup)) {
          return {
            ...g,
            examples: [
              ...(g.examples ?? [{ text: '', pattern: g.pattern }]),
              { text: '', pattern: fresh.pattern },
            ],
          };
        }
        return g;
      });
    if (wholeName && prefixes.length) {
      const keyGroup = others.find((g) => g.name === heading.block!.keyGroup);
      if (keyGroup)
        keyGroup.examples = [
          ...(keyGroup.examples ?? []),
          { text: '', pattern: `^${prefixPattern}\\s+([+\\d][\\d ()-]{6,}\\d)(?=\\s|$)` },
        ];
    }
    rule = {
      ...rule,
      groups: [group, ...others],
      block: {
        ...heading.block!,
        ...(wrapGaps.length
          ? {
              headingLines: 5,
              headingMaxGap: Math.max(...wrapGaps) + 1,
              headingStopPattern: `^(?:${bodyLabels.map(shape).join('|')})$`,
            }
          : {}),
        ...rule.block,
        ...(parts.length > 1
          ? {
              headingLines: 5,
              headingMaxGap: Math.max(...parts.slice(1).map((l, i) => l.cy - parts[i]!.cy)) + 1,
              headingStopPattern: union(
                rule.block?.headingStopPattern ?? '(?!)',
                `^${shape(lines[lines.indexOf(parts.at(-1)!) + 1]?.text ?? '')}$`,
              ),
            }
          : {}),
        headingPattern:
          wholeName && prefixes.length
            ? union(rule.block?.headingPattern ?? '(?!)', `^${prefixPattern}(?=\\s|$)`)
            : rule.block
              ? union(rule.block.headingPattern, heading.block!.headingPattern)
              : heading.block!.headingPattern,
      },
    };
    const key = number[0].replace(/[ ()-]/g, '');
    const total = layout.pages
      .flatMap((p) => p.lines)
      .find((l) => /^\s*Total\b/i.test(l.text) && l.text.replace(/[ ()-]/g, '').includes(key));
    if (!total && !initial.block) return null;
    if (total) rule = rowsLike(layout, rule, total) ?? rule;
    rule.outputColumns = [
      ...rule.groups!.map((g) => g.name),
      ...rule.columns
        .filter((c) => ['currency', 'number', 'integer'].includes(c.type ?? ''))
        .map((c) => c.name),
    ];
    return rule;
  }
  if (parts.length > 1) return null;
  const frame = tableFrame(layout, rule);
  const bound = frame?.bounds.find((b) => selected.every((t) => cx(t) >= b.x0 && cx(t) < b.x1));
  if (
    !bound ||
    rule.groups?.some((g) => g.name === name) ||
    rule.columns.some((c) => c.name === name && c.name !== bound.name)
  )
    return null;
  const old = bound.name;
  return {
    ...rule,
    columns: rule.columns.map((c) => ({
      ...c,
      ...(c.name === old ? { name } : {}),
      ...(c.partOf === old ? { partOf: name } : {}),
    })),
    rowStart: rule.rowStart?.column === old ? { ...rule.rowStart, column: name } : rule.rowStart,
    outputColumns: rule.outputColumns?.map((n) => (n === old ? name : n)),
  };
}

const NUMBER = /[+\d][\d ()-]{6,}\d/;
const keyOf = (s: string) => s.replace(/[ ()-]/g, '');
const isTotal = (s: string) => /^\s*(?:Total|Subtotal)\b/i.test(s);

/** The words of a line that start between two character offsets of its text. */
function wordsAt(line: Line, from: number, to = Infinity): Token[] {
  let at = 0;
  return line.tokens.filter((t) => {
    const start = at;
    at += t.text.length + 1;
    return start >= from && start < to;
  });
}

/** The lines below a table's header, across pages. */
function bodyOf(layout: DocLayout, rule: TableRule): Line[] {
  const f = tableFrame(layout, rule);
  if (!f) return [];
  return layout.pages
    .flatMap((p) => p.lines)
    .filter((l) => l.page > f.page || (l.page === f.page && l.y0 > f.bbox[3]));
}

/**
 * Finds repeating blocks on its own: a heading with a number ("Telephone 02 5550
 * 0101 West Depot") whose total repeats the number ("Total for 02 5550 0101").
 * Each block becomes one row: the words after the number name it, the total gives
 * the amounts. Null when the table has no such pairs.
 */
export function findBlocks(layout: DocLayout, rule: TableRule): TableRule | null {
  const lines = bodyOf(layout, rule);
  for (let i = 0; i < lines.length; i++) {
    const total = lines[i]!;
    const n = isTotal(total.text) ? NUMBER.exec(total.text) : null;
    if (!n) continue;
    for (let j = i - 1; j >= 0 && i - j < 200; j--) {
      const h = lines[j]!;
      if (isTotal(h.text)) break;
      const m = NUMBER.exec(h.text);
      if (!m || m.index === 0 || keyOf(m[0]) !== keyOf(n[0])) continue;
      const end = m.index + m[0].length;
      const after = wordsAt(h, end);
      return (
        (after.length ? learnExample(layout, rule, after, 'Name') : null) ??
        learnExample(layout, rule, wordsAt(h, m.index, end), 'Number')
      );
    }
  }
  return null;
}

/** What one row of a table is: a whole block, each item line, every line, or lines like one. */
export type RowKind = 'block' | 'items' | 'lines' | 'custom';

export function rowKindOf(rule: TableRule): RowKind {
  if (rule.block)
    return rule.block.rows === 'items' ? 'items' : rule.block.rows === 'lines' ? 'lines' : 'block';
  if (!rule.rowStart) return 'lines';
  return rule.wrappedLines === 'ignore' ? 'custom' : 'items';
}

/** Changes what one row of the table is. Null when it can't (no blocks to find). */
export function setRowKind(
  layout: DocLayout,
  rule: TableRule,
  kind: Exclude<RowKind, 'custom'>,
): TableRule | null {
  const f = tableFrame(layout, rule);
  if (!f) return null;
  const totalLine = bodyOf(layout, rule).find((l) => isTotal(l.text) && NUMBER.test(l.text));
  const { rowStart: _rowStart, ...rest } = rule;
  const block = rule.block ? (({ rows: _rows, ...b }) => b)(rule.block) : undefined;
  const allColumns = rule.block
    ? {
        outputColumns: [
          ...(rule.groups ?? []).map((g) => g.name),
          ...rule.columns.map((c) => c.name),
        ],
      }
    : {};
  if (kind === 'block') {
    if (!block) return findBlocks(layout, rule);
    return totalLine ? rowsLike(layout, { ...rule, block }, totalLine) : null;
  }
  if (kind === 'lines')
    return {
      ...rest,
      wrappedLines: 'join',
      ...(block ? { block: { ...block, rows: 'lines' as const } } : {}),
      ...allColumns,
    };
  // Each item: a row starts where the first column has text; the block's total is left out.
  const own = totalLine ? skipPatternFor(totalLine) : null;
  const skip = rule.skip ?? [];
  return {
    ...rest,
    rowStart: { column: f.bounds[0]?.name ?? rule.columns[0]!.name, pattern: '\\S' },
    wrappedLines: 'join',
    ...(block
      ? {
          block: { ...block, rows: 'items' as const },
          skip: own && !skip.includes(own) ? [...skip, own] : skip,
        }
      : {}),
    ...allColumns,
  };
}
