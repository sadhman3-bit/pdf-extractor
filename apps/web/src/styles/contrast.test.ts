import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8');
const tokens = new Map<string, string>();
for (const m of css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens.set(m[1]!, m[2]!);

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Every text-on-background pair the interface actually uses. */
const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-subtle'],
  ['text-2', 'surface'],
  ['text-2', 'surface-subtle'],
  ['text-2', 'neutral-chip'],
  ['text-muted', 'surface'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface-subtle'],
  ['text-muted', 'surface-hover'],
  ['topbar-text', 'topbar'],
  ['topbar-text', 'topbar-active'],
  ['surface', 'topbar'],
  ['surface', 'topbar-active'],
  ['on-accent', 'accent'],
  ['on-accent', 'accent-hover'],
  ['accent', 'surface'],
  ['accent', 'accent-tint'],
  ['accent-ink', 'accent-tint'],
  ['accent-ink', 'surface-hover'],
  ['warn-ink', 'warn-tint'],
  ['warn-ink', 'surface'],
  ['danger-ink', 'danger-tint'],
  ['danger-ink', 'surface'],
  ['success-ink', 'success-tint'],
  ['success-ink', 'surface'],
  ['text', 'warn-tint'],
  ['text', 'danger-tint'],
  ['text', 'accent-tint'],
];

describe('colour contrast (WCAG 2.1 AA)', () => {
  it.each(TEXT_PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
    const a = tokens.get(fg);
    const b = tokens.get(bg);
    expect(a, fg).toBeDefined();
    expect(b, bg).toBeDefined();
    expect(contrast(a!, b!)).toBeGreaterThanOrEqual(4.5);
  });

  it('focus ring is at least 3:1 against the surfaces it sits on', () => {
    for (const bg of ['surface', 'bg', 'viewer-bg']) {
      expect(contrast(tokens.get('focus')!, tokens.get(bg)!)).toBeGreaterThanOrEqual(3);
    }
  });
});
