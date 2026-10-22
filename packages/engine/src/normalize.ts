/**
 * Normalised text used for every comparison: NFKC, lower case, collapsed
 * whitespace, straight quotes, dashes as "-", and trailing ":", "#" and "."
 * removed.
 */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .split(/\s+/)
    .map(stripTrailing)
    .filter(Boolean)
    .join(' ');
}

function stripTrailing(t: string): string {
  return t.replace(/[:#.]+$/, '');
}

/** Normalises one token (no whitespace inside). May return "" for tokens like ":". */
export function normToken(t: string): string {
  return normalize(t);
}

/** Splits a label into normalised tokens. */
export function normTokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** Text with only its digits. */
export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}
