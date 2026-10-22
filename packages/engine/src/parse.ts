import type { Cleaner, FieldType } from './template';

// ---------------------------------------------------------------- cleaners

const OCR_MAP: Record<string, string> = { O: '0', o: '0', l: '1', I: '1', S: '5', B: '8' };

function ocrDigits(s: string): string {
  return s
    .split(/(\s+)/)
    .map((tok) => {
      if (!/\d/.test(tok)) return tok;
      if (!/^[0-9OolISB.,\-/$:()%]+$/.test(tok)) return tok;
      return tok.replace(/[OolISB]/g, (c) => OCR_MAP[c] ?? c);
    })
    .join('');
}

export function applyCleaners(value: string, cleaners: Cleaner[]): string {
  let s = value;
  for (const c of cleaners) {
    if (typeof c === 'string') {
      const [name, arg = ''] = splitOnce(c, ':');
      switch (name) {
        case 'trim':
          s = s.trim();
          break;
        case 'collapseSpaces':
          s = s.replace(/\s+/g, ' ');
          break;
        case 'upper':
          s = s.toUpperCase();
          break;
        case 'lower':
          s = s.toLowerCase();
          break;
        case 'removeSpaces':
          s = s.replace(/\s+/g, '');
          break;
        case 'removeDashes':
          s = s.replace(/[-‐-―−]/g, '');
          break;
        case 'removeChars':
          for (const ch of arg) s = s.split(ch).join('');
          break;
        case 'stripLeadingZeros':
          s = s.replace(/^0+(?=.)/, '');
          break;
        case 'digitsOnly':
          s = s.replace(/\D/g, '');
          break;
        case 'ocrDigits':
          s = ocrDigits(s);
          break;
        default:
          throw new Error(`Unknown cleaner "${c}"`);
      }
    } else if ('replace' in c && c.replace) {
      const r = c.replace as { pattern: string; with?: string };
      s = s.replace(new RegExp(r.pattern, 'g'), r.with ?? '');
    } else if ('keep' in c && c.keep) {
      const k = c.keep as { pattern: string; group?: number };
      const m = new RegExp(k.pattern).exec(s);
      s = m ? (m[k.group ?? 0] ?? '') : '';
    }
  }
  return s;
}

function splitOnce(s: string, sep: string): [string, string?] {
  const i = s.indexOf(sep);
  return i < 0 ? [s] : [s.slice(0, i), s.slice(i + 1)];
}

export const CLEANER_NAMES = [
  'trim',
  'collapseSpaces',
  'upper',
  'lower',
  'removeSpaces',
  'removeDashes',
  'removeChars:',
  'stripLeadingZeros',
  'digitsOnly',
  'ocrDigits',
] as const;

// ---------------------------------------------------------------- numbers

export interface ParsedNumber {
  value: number;
  decimals: number;
}

export interface NumberOptions {
  decimal?: '.' | ',';
  creditMeansNegative?: boolean;
  integer?: boolean;
}

export function parseNumber(input: string, opts: NumberOptions = {}): ParsedNumber | null {
  const dec = opts.decimal ?? '.';
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  const cr = /\s*(CR|DR)\.?$/i.exec(s);
  if (cr) {
    if (cr[1]!.toUpperCase() === 'CR' && (opts.creditMeansNegative ?? true)) negative = true;
    s = s.slice(0, cr.index);
  }
  s = s.trim();
  if (/^\(.*\)$/.test(s)) {
    negative = !negative;
    s = s.slice(1, -1).trim();
  }
  if (/^[-−]/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  } else if (/[-−]$/.test(s)) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/^(AUD|AU\$|A\$|\$)/i, '').replace(/(AUD)$/i, '');
  s = s.replace(/\s+/g, '');
  if (/^[-−]/.test(s)) {
    // "$-12.00"
    negative = !negative;
    s = s.slice(1);
  }
  const thousands = dec === '.' ? /,/g : /\./g;
  s = s.replace(thousands, '');
  if (dec === ',') s = s.replace(',', '.');
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
  const decimals = s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
  if (opts.integer && decimals > 0) return null;
  let value = Number(s);
  if (!Number.isFinite(value)) return null;
  if (negative && value !== 0) value = -value;
  return { value, decimals };
}

/** Formats a number for CSV: "." decimals, no thousands separators, decimals as shown on the document. */
export function formatNumber(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

// ---------------------------------------------------------------- dates

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

type Part = { kind: 'D' | 'M' | 'MMM' | 'MMMM' | 'YY' | 'YYYY' } | { kind: 'lit'; re: string };

function compileFormat(fmt: string): { re: RegExp; parts: Part[] } {
  const parts: Part[] = [];
  let src = '';
  let i = 0;
  while (i < fmt.length) {
    const rest = fmt.slice(i);
    const tok = /^(YYYY|YY|MMMM|MMM|MM|M|DD|D)/.exec(rest)?.[1];
    if (tok) {
      switch (tok) {
        case 'DD':
          src += '(\\d{2})';
          parts.push({ kind: 'D' });
          break;
        case 'D':
          src += '(\\d{1,2})';
          parts.push({ kind: 'D' });
          break;
        case 'MM':
          src += '(\\d{2})';
          parts.push({ kind: 'M' });
          break;
        case 'M':
          src += '(\\d{1,2})';
          parts.push({ kind: 'M' });
          break;
        case 'MMM':
          src += '([A-Za-z]{3}|Sept)';
          parts.push({ kind: 'MMM' });
          break;
        case 'MMMM':
          src += '([A-Za-z]{3,9})';
          parts.push({ kind: 'MMMM' });
          break;
        case 'YY':
          src += '(\\d{2})';
          parts.push({ kind: 'YY' });
          break;
        case 'YYYY':
          src += '(\\d{4})';
          parts.push({ kind: 'YYYY' });
          break;
      }
      i += tok.length;
    } else {
      const ch = fmt[i]!;
      src += /\s/.test(ch) ? '\\s+' : ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
      i++;
    }
  }
  return { re: new RegExp(`^${src}$`, 'i'), parts };
}

const cache = new Map<string, ReturnType<typeof compileFormat>>();

/** Parses a date using only the given formats, in order. Returns ISO YYYY-MM-DD or null. */
export function parseDate(input: string, formats: string[]): string | null {
  const s = input.trim().replace(/\s+/g, ' ');
  for (const fmt of formats) {
    let c = cache.get(fmt);
    if (!c) {
      c = compileFormat(fmt);
      cache.set(fmt, c);
    }
    const m = c.re.exec(s);
    if (!m) continue;
    let d = 0;
    let mo = 0;
    let y = 0;
    let ok = true;
    c.parts.forEach((p, idx) => {
      const v = m[idx + 1]!;
      switch (p.kind) {
        case 'D':
          d = Number(v);
          break;
        case 'M':
          mo = Number(v);
          break;
        case 'MMM': {
          const i = MONTHS.findIndex((n) => n.startsWith(v.toLowerCase().slice(0, 3)));
          if (i < 0) ok = false;
          mo = i + 1;
          break;
        }
        case 'MMMM': {
          const i = MONTHS.indexOf(v.toLowerCase());
          if (i < 0) ok = false;
          mo = i + 1;
          break;
        }
        case 'YY': {
          const n = Number(v);
          y = n < 70 ? 2000 + n : 1900 + n;
          break;
        }
        case 'YYYY':
          y = Number(v);
          break;
      }
    });
    if (!ok || !y || mo < 1 || mo > 12 || d < 1) continue;
    const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (d > dim) continue;
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

// ---------------------------------------------------------------- typed values

export type Value = string | number;

export interface ParsedValue {
  value: Value;
  /** The value as written to CSV. */
  csv: string;
}

export interface ValueOptions {
  dateFormats?: string[];
  decimal?: '.' | ',';
  creditMeansNegative?: boolean;
}

/** Parses already-cleaned text as the given type. */
export function parseValue(
  text: string,
  type: FieldType,
  opts: ValueOptions = {},
): ParsedValue | null {
  switch (type) {
    case 'text': {
      if (!text) return null;
      return { value: text, csv: text };
    }
    case 'date': {
      const iso = parseDate(text, opts.dateFormats ?? ['DD/MM/YYYY']);
      return iso ? { value: iso, csv: iso } : null;
    }
    case 'number':
    case 'currency':
    case 'integer': {
      const n = parseNumber(text, {
        decimal: opts.decimal ?? '.',
        creditMeansNegative: opts.creditMeansNegative ?? true,
        integer: type === 'integer',
      });
      return n ? { value: n.value, csv: formatNumber(n.value, n.decimals) } : null;
    }
  }
}

/** Guesses the type of a value, for the mapper. */
export function inferType(text: string, dateFormats: string[] = DATE_GUESS_FORMATS): FieldType {
  const t = text.trim();
  if (parseDate(t, dateFormats)) return 'date';
  if (
    /^(\(?-?\s*(A\$|AUD|\$)\s*)[\d,]*\.?\d+\)?(\s*CR)?$/i.test(t) ||
    /^-?\$?[\d,]*\d\.\d{2}(\s*CR)?$/i.test(t)
  ) {
    return 'currency';
  }
  if (parseNumber(t) && /^[-\d,.()\s]+$/.test(t)) return 'number';
  return 'text';
}

export const DATE_GUESS_FORMATS = [
  'DD/MM/YYYY',
  'D/M/YYYY',
  'DD-MM-YYYY',
  'DD.MM.YYYY',
  'D MMM YYYY',
  'D MMMM YYYY',
  'DD/MM/YY',
  'YYYY-MM-DD',
];

/** Which formats from the guess list match, for suggesting dateFormats. */
export function guessDateFormat(text: string): string | null {
  for (const f of DATE_GUESS_FORMATS) if (parseDate(text, [f])) return f;
  return null;
}
