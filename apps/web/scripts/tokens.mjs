// Reads colour tokens from src/styles/tokens.css, the one place colours are defined,
// for the few places that need a literal value (theme-color, manifest, icons).
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
// Only the first (light) :root block.
const light = css.slice(0, css.indexOf('}'));

/** The hex value of a light-theme token, for example token('topbar'). */
export function token(name) {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(light);
  if (!m) throw new Error(`No colour token --${name} in tokens.css`);
  return m[1];
}

/** The same value as [r, g, b]. */
export function rgb(name) {
  const h = token(name).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
