import type { BBox, DocLayout, Line, Phrase, Token } from './types';
import type { MatchMode } from './template';
import { normToken, normalize } from './normalize';
import { bboxOf, phrases } from './layout';

export interface AnchorHit {
  page: number;
  line: Line;
  phrase: Phrase;
  tokens: Token[];
  bbox: BBox;
  /** Which label matched (0 = main label). */
  labelIndex: number;
  label: string;
}

interface NormPhrase {
  phrase: Phrase;
  /** Normalised tokens (empty tokens dropped) with their index in phrase.tokens. */
  norm: { text: string; i: number }[];
  joined: string;
  /** Character offset of each norm token in `joined`. */
  offsets: number[];
}

function normPhrase(p: Phrase): NormPhrase {
  const norm: { text: string; i: number }[] = [];
  p.tokens.forEach((t, i) => {
    const n = normToken(t.text);
    if (n) for (const part of n.split(' ')) norm.push({ text: part, i });
  });
  const offsets: number[] = [];
  let pos = 0;
  for (const n of norm) {
    offsets.push(pos);
    pos += n.text.length + 1;
  }
  return { phrase: p, norm, joined: norm.map((n) => n.text).join(' '), offsets };
}

function tokensForRange(np: NormPhrase, start: number, end: number): Token[] {
  const idx = new Set<number>();
  np.norm.forEach((n, k) => {
    const s = np.offsets[k]!;
    const e = s + n.text.length;
    if (e > start && s < end) idx.add(n.i);
  });
  return [...idx].sort((a, b) => a - b).map((i) => np.phrase.tokens[i]!);
}

/** Matches one label against one phrase; returns the matched tokens or null. */
export function matchLabel(np: NormPhrase, label: string, mode: MatchMode): Token[] | null {
  if (mode === 'regex') {
    let re: RegExp;
    try {
      re = new RegExp(label, 'i');
    } catch {
      return null;
    }
    return re.test(np.phrase.text) ? np.phrase.tokens : null;
  }
  const l = normalize(label);
  if (!l) return null;
  if (mode === 'exact') {
    const lt = l.split(' ');
    if (lt.length > np.norm.length) return null;
    for (let k = 0; k < lt.length; k++) if (np.norm[k]!.text !== lt[k]) return null;
    const lastTokIdx = np.norm[lt.length - 1]!.i;
    const nextNorm = np.norm[lt.length];
    const whole = !nextNorm;
    if (!whole) {
      if (nextNorm.i === lastTokIdx) return null; // label ends inside a token
      const lastRaw = np.phrase.tokens[lastTokIdx]!.text;
      const nextRaw = np.phrase.tokens[nextNorm.i]!.text;
      const delimited = /[:#]$/.test(lastRaw) || !/^\p{L}/u.test(nextRaw);
      if (!delimited) return null;
    }
    return np.phrase.tokens.slice(0, lastTokIdx + 1);
  }
  if (mode === 'starts-with') {
    if (!np.joined.startsWith(l)) return null;
    return tokensForRange(np, 0, l.length);
  }
  // contains
  const at = np.joined.indexOf(l);
  if (at < 0) return null;
  return tokensForRange(np, at, at + l.length);
}

export type PageSel = 'first' | 'last' | 'any' | number;

export function pagesFor(layout: DocLayout, sel: PageSel): DocLayout['pages'] {
  const n = layout.pages.length;
  if (sel === 'first') return layout.pages.slice(0, 1);
  if (sel === 'last') return layout.pages.slice(n - 1);
  if (typeof sel === 'number') return layout.pages.filter((p) => p.page === sel);
  return layout.pages;
}

/** All hits for the first label (main first, then alternates) that has any, in reading order. */
export function findAnchors(
  layout: DocLayout,
  labels: string[],
  mode: MatchMode,
  page: PageSel,
): AnchorHit[] {
  const pages = pagesFor(layout, page);
  for (let li = 0; li < labels.length; li++) {
    const hits: AnchorHit[] = [];
    for (const p of pages) {
      for (const line of p.lines) {
        for (const ph of phrases(line)) {
          const toks = matchLabel(normPhrase(ph), labels[li]!, mode);
          if (toks && toks.length) {
            hits.push({
              page: p.page,
              line,
              phrase: ph,
              tokens: toks,
              bbox: bboxOf(toks),
              labelIndex: li,
              label: labels[li]!,
            });
          }
        }
      }
    }
    if (hits.length) return hits;
  }
  return [];
}

/** True when the line matches a label (used for table end markers). */
export function lineMatches(line: Line, labels: string[], mode: MatchMode): boolean {
  const text = normalize(line.text);
  for (const label of labels) {
    if (mode === 'regex') {
      try {
        if (new RegExp(label, 'i').test(line.text)) return true;
      } catch {
        /* invalid pattern never matches */
      }
      continue;
    }
    const l = normalize(label);
    if (!l) continue;
    if (mode === 'exact' && text === l) return true;
    if (mode === 'starts-with' && text.startsWith(l)) return true;
    if (mode === 'contains' && text.includes(l)) return true;
  }
  return false;
}

export function chooseHit(
  hits: AnchorHit[],
  occurrence: 'first' | 'last' | number | undefined,
  hint?: { page: number; bbox: BBox },
): AnchorHit | undefined {
  if (!hits.length) return undefined;
  if (occurrence === 'last') return hits[hits.length - 1];
  if (typeof occurrence === 'number') return hits[occurrence - 1];
  if (occurrence === 'first' || !hint || hits.length === 1) return hits[0];
  const hc = [(hint.bbox[0] + hint.bbox[2]) / 2, (hint.bbox[1] + hint.bbox[3]) / 2];
  let best = hits[0]!;
  let bestD = Infinity;
  for (const h of hits) {
    const d =
      (h.page === hint.page ? 0 : 1e6 * Math.abs(h.page - hint.page)) +
      Math.hypot((h.bbox[0] + h.bbox[2]) / 2 - hc[0]!, (h.bbox[1] + h.bbox[3]) / 2 - hc[1]!);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}
