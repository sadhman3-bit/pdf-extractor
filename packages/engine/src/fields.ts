import type { BBox, DocLayout, Line, Token } from './types';
import { fieldDefaults, type FieldRule, type FieldType } from './template';
import { TOLERANCES } from './tolerances';
import { bboxOf, cx, cy, makePhrase, phrases } from './layout';
import { chooseHit, findAnchors, type AnchorHit } from './anchor';
import { applyCleaners, parseValue, type Value } from './parse';

export interface SourceBox {
  page: number;
  bbox: BBox;
}

export type FieldError = 'anchor_missing' | 'value_missing' | 'parse_failed';

export interface FieldResult {
  name: string;
  type: FieldType;
  required: boolean;
  value: Value | null;
  /** The value as written to CSV ("" when missing). */
  csv: string;
  /** Text read from the page before parsing. */
  raw: string | null;
  conf: number;
  boxes: SourceBox[];
  anchor?: SourceBox & { label: string; labelIndex: number };
  via: 'anchor' | 'region' | 'none';
  error?: FieldError;
}

export interface ExtractOptions {
  decimal?: '.' | ',';
}

const minConf = (tokens: Token[]) => (tokens.length ? Math.min(...tokens.map((t) => t.conf)) : 0);

/** Tokens in the field's direction from the anchor, nearest first. */
export function candidates(
  layout: DocLayout,
  hit: AnchorHit,
  f: FieldRule,
): { tokens: Token[]; lines: Line[] } {
  const d = fieldDefaults(f);
  const page = layout.pages.find((p) => p.page === hit.page)!;
  const anchorSet = new Set(hit.tokens);
  const a = { x0: hit.bbox[0], x1: hit.bbox[2] };
  if (d.direction === 'right' || d.direction === 'left') {
    const max = f.maxDistance ?? TOLERANCES.maxDistance;
    const toks = hit.line.tokens.filter((t) => {
      if (anchorSet.has(t)) return false;
      if (d.direction === 'right')
        return t.x0 >= a.x1 - TOLERANCES.rightSlack && t.x0 - a.x1 <= max;
      return t.x1 <= a.x0 + TOLERANCES.rightSlack && a.x0 - t.x1 <= max;
    });
    toks.sort((p, q) => (d.direction === 'right' ? p.x0 - q.x0 : q.x0 - p.x0));
    return { tokens: toks, lines: [hit.line] };
  }
  const maxLines = Math.round(
    f.maxDistance && f.maxDistance <= 20 ? f.maxDistance : TOLERANCES.maxLines,
  );
  const w0 = a.x0 - TOLERANCES.verticalWiden;
  const w1 = a.x1 + TOLERANCES.verticalWiden;
  const idx = hit.line.index;
  const range =
    d.direction === 'below'
      ? page.lines.slice(idx + 1, idx + 1 + maxLines)
      : page.lines.slice(Math.max(0, idx - maxLines), idx).reverse();
  const tokens: Token[] = [];
  const lines: Line[] = [];
  for (const line of range) {
    const hitTokens = line.tokens.filter((t) => t.x1 >= w0 && t.x0 <= w1);
    if (hitTokens.length) {
      tokens.push(...hitTokens);
      lines.push(line);
    }
  }
  return { tokens, lines };
}

function sameLine(a: Token, b: Token) {
  return (
    a.page === b.page &&
    Math.abs(cy(a) - cy(b)) <= TOLERANCES.lineCentre * Math.min(a.height, b.height)
  );
}

/** Picks the value tokens from candidates according to `take`. */
export function takeTokens(
  take: string,
  cand: { tokens: Token[]; lines: Line[] },
  direction: string,
): Token[][] {
  const toks = cand.tokens;
  if (!toks.length) return [];
  const first = toks[0]!;
  const lineOf = (t: Token) => cand.lines.find((l) => l.tokens.includes(t));
  if (take === 'phrase') {
    const line = lineOf(first);
    if (!line) return [[first]];
    const ph = phrases(line).find((p) => p.tokens.includes(first));
    if (!ph) return [[first]];
    // On the anchor's own line, only the part of the phrase in the field's direction.
    const inCand =
      direction === 'right' || direction === 'left'
        ? ph.tokens.filter((t) => toks.includes(t))
        : ph.tokens;
    return [inCand.sort((a, b) => a.x0 - b.x0)];
  }
  if (take === 'rest-of-line') {
    const line = lineOf(first);
    const same =
      direction === 'left'
        ? toks.filter((t) => sameLine(t, first))
        : (line?.tokens ?? toks).filter((t) => t.x0 >= first.x0);
    return [same.sort((a, b) => a.x0 - b.x0)];
  }
  if (take.startsWith('tokens:')) {
    const n = Number(take.slice(7)) || 1;
    return [toks.slice(0, n).sort((a, b) => a.page - b.page || cy(a) - cy(b) || a.x0 - b.x0)];
  }
  if (take === 'until-gap') {
    const line = lineOf(first);
    const lineToks = (line?.tokens ?? toks).filter((t) => t.x0 >= first.x0);
    const out: Token[] = [];
    for (const t of lineToks) {
      const prev = out[out.length - 1];
      if (prev && t.x0 - prev.x1 > TOLERANCES.untilGap * Math.min(prev.height, t.height)) break;
      out.push(t);
    }
    return [out];
  }
  // token: each start position, longest run of adjacent tokens first.
  const runs: Token[][] = [];
  for (let i = 0; i < toks.length; i++) {
    const start = toks[i]!;
    const line = lineOf(start);
    const ordered = line ? line.tokens.filter((t) => t.x0 >= start.x0) : [start];
    const run: Token[] = [start];
    for (const t of ordered.slice(1)) {
      const prev = run[run.length - 1]!;
      if (run.length >= TOLERANCES.maxJoinedTokens) break;
      if (t.x0 - prev.x1 > TOLERANCES.phraseGap * Math.min(prev.height, t.height) * 1.5) break;
      if (!toks.includes(t)) break;
      run.push(t);
    }
    for (let n = run.length; n >= 1; n--) runs.push(run.slice(0, n));
  }
  return runs;
}

function joinText(tokens: Token[]): string {
  return tokens.map((t) => t.text).join(' ');
}

/** Extracts one field. */
export function extractField(
  layout: DocLayout,
  f: FieldRule,
  opts: ExtractOptions = {},
): FieldResult {
  const d = fieldDefaults(f);
  const base: FieldResult = {
    name: f.name,
    type: d.type,
    required: d.required,
    value: null,
    csv: '',
    raw: null,
    conf: 0,
    boxes: [],
    via: 'none',
  };
  let pattern: RegExp | null = null;
  if (f.pattern) {
    try {
      pattern = new RegExp(f.pattern);
    } catch {
      pattern = null;
    }
  }
  const vopts = {
    dateFormats: d.dateFormats,
    decimal: opts.decimal ?? '.',
    creditMeansNegative: d.creditMeansNegative,
  };
  const tryParse = (tokens: Token[]) => {
    const raw = joinText(tokens);
    let cleaned: string;
    try {
      cleaned = applyCleaners(raw, d.clean);
    } catch {
      return null;
    }
    if (pattern && !pattern.test(cleaned)) return null;
    const v = parseValue(cleaned, d.type, vopts);
    return v ? { raw, v } : null;
  };

  const hits = findAnchors(layout, f.anchor.labels, d.match, d.page);
  const hit = chooseHit(hits, d.occurrence, f.hint);
  if (hit) {
    const cand = candidates(layout, hit, f);
    const anchor = { page: hit.page, bbox: hit.bbox, label: hit.label, labelIndex: hit.labelIndex };
    const options = takeTokens(d.take, cand, d.direction);
    const single = d.take === 'token' && d.type === 'text';
    for (const toks of options) {
      if (!toks.length) continue;
      if (single && toks.length > 1) continue;
      const p = tryParse(toks);
      if (p) {
        return {
          ...base,
          value: p.v.value,
          csv: p.v.csv,
          raw: p.raw,
          conf: minConf(toks),
          boxes: [{ page: hit.page, bbox: bboxOf(toks) }],
          anchor,
          via: 'anchor',
        };
      }
      if (d.take !== 'token') {
        return {
          ...base,
          raw: joinText(toks),
          boxes: [{ page: hit.page, bbox: bboxOf(toks) }],
          anchor,
          via: 'anchor',
          error: 'parse_failed',
        };
      }
    }
    if (!f.region) {
      const firstTok = cand.tokens[0];
      return {
        ...base,
        raw: firstTok ? firstTok.text : null,
        boxes: firstTok ? [{ page: hit.page, bbox: bboxOf([firstTok]) }] : [],
        anchor,
        via: 'anchor',
        error: firstTok ? 'parse_failed' : 'value_missing',
      };
    }
  }

  if (f.region) {
    const r = f.region;
    const page = layout.pages.find((p) => p.page === r.page);
    if (page) {
      const inside = page.lines.flatMap((l) =>
        l.tokens.filter((t) => {
          const x = cx(t) / page.width;
          const y = cy(t) / page.height;
          return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
        }),
      );
      if (inside.length) {
        const p = tryParse(inside);
        const box = { page: r.page, bbox: bboxOf(inside) };
        if (p) {
          return {
            ...base,
            value: p.v.value,
            csv: p.v.csv,
            raw: p.raw,
            conf: round2(minConf(inside) * TOLERANCES.regionConfidence),
            boxes: [box],
            via: 'region',
          };
        }
        return {
          ...base,
          raw: joinText(inside),
          boxes: [box],
          via: 'region',
          error: 'parse_failed',
        };
      }
    }
  }
  return { ...base, error: hit ? 'value_missing' : 'anchor_missing' };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Exposed for the mapper: phrase containing a token. */
export function phraseOf(line: Line, token: Token) {
  return phrases(line).find((p) => p.tokens.includes(token)) ?? makePhrase(line, [token]);
}
