import type { DocLayout, Token } from './types';
import type { GroupRule, TableRule } from './template';
import { blockFromHeading, rowsLike, suggestTable, tableFrame } from './infer';
import { cx } from './layout';

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
  const line = layout.pages.flatMap((p) => p.lines).find((l) => l.tokens.includes(selected[0]!));
  if (!line || selected.some((t) => !line.tokens.includes(t))) return null;
  const indices = selected.map((t) => line.tokens.indexOf(t)).sort((a, b) => a - b);
  if (indices.at(-1)! - indices[0]! + 1 !== indices.length) return null;
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
  const text = indices.map((i) => line.tokens[i]!.text).join(' ');
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
    const pattern = /^[+\d][\d ()-]+$/.test(text)
      ? `^${shape(before)}\\s+([+\\d][\\d ()-]{6,}\\d)(?=\\s|$)`
      : `^${shape(before)}\\s+(.+?)${after ? `\\s+${shape(after)}` : ''}$`;
    const groups: GroupRule[] = rule.block
      ? [...(rule.groups ?? [])]
      : heading.groups!.filter((g) => g.name !== 'Name');
    const prior = groups.find((g) => g.name === name);
    if (
      prior?.examples?.some((e) => {
        try {
          const match = new RegExp(e.pattern).exec(line.text);
          return match && match[1]?.trim() !== text;
        } catch {
          return true;
        }
      })
    )
      return null;
    const examples = [...(prior?.examples ?? [])];
    if (!examples.some((e) => e.pattern === pattern && e.text === text))
      examples.push({ text, pattern });
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
    rule = {
      ...rule,
      groups: [group, ...others],
      block: {
        ...heading.block!,
        ...rule.block,
        headingPattern: rule.block
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
