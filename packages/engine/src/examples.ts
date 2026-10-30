import type { DocLayout, Token } from './types';
import type { GroupRule, TableRule } from './template';
import { blockFromHeading, rowsLike, suggestTable, tableFrame } from './infer';
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
