import type { DocLayout } from './types';
import type { Template, TemplateSet } from './template';
import { normalize, digitsOnly } from './normalize';
import { pageNormText } from './layout';

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** True when the 11 digits pass the ABN checksum. */
export function isValidAbn(s: string): boolean {
  const d = digitsOnly(s);
  if (d.length !== 11) return false;
  const sum = [...d].reduce(
    (acc, ch, i) => acc + (i === 0 ? Number(ch) - 1 : Number(ch)) * ABN_WEIGHTS[i]!,
    0,
  );
  return sum % 89 === 0;
}

/** Finds ABNs on a page: 11 digits (spaced as written) passing the checksum. */
export function findAbns(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})(?!\d)/g)) {
    if (isValidAbn(m[1]!) && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

export function fingerprintMatches(layout: DocLayout, t: Template): boolean {
  const fp = t.fingerprint;
  const pages = fp.anyPage ? layout.pages : layout.pages.slice(0, 1);
  const text = pages.map((p) => pageNormText(p.lines)).join('\n');
  // Phrases may wrap or be split across lines, so also compare with line breaks as spaces.
  const flat = text.replace(/\n/g, ' ');
  const has = (s: string) => {
    const n = normalize(s);
    return !n || text.includes(n) || flat.includes(n);
  };
  if (!fp.mustContain.length && !fp.abn) return false;
  if (!fp.mustContain.every(has)) return false;
  if ((fp.mustNotContain ?? []).some((s) => normalize(s) && has(s))) return false;
  if (fp.abn) {
    const digits = digitsOnly(fp.abn);
    if (digits && !digitsOnly(text).includes(digits)) return false;
  }
  return true;
}

/** Templates whose fingerprint (in any saved version) matches the document. */
export function matchTemplates(layout: DocLayout, sets: TemplateSet[]): TemplateSet[] {
  return sets.filter((s) => s.versions.some((v) => fingerprintMatches(layout, v)));
}
