import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('one source for colours', () => {
  it('has no hard-coded hex colours outside tokens.css', () => {
    const offenders: string[] = [];
    const web = join(SRC, '..');
    const extra = [
      join(web, 'index.html'),
      join(web, 'vite.config.ts'),
      ...walk(join(web, 'scripts')).filter((f) => f.endsWith('.mjs')),
    ];
    for (const file of [...walk(SRC), ...extra]) {
      if (!/\.(tsx|css|html|mjs)$/.test(file) && !extra.includes(file)) continue;
      if (file.endsWith('tokens.css')) continue;
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        // Hex colour literals: #abc, #aabbcc, #aabbccdd (not inside url fragments or ids like href="#x").
        const m = line.match(/(?<![&\w])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
        if (m) offenders.push(`${relative(SRC, file)}:${i + 1}: ${m[0]}`);
        if (/\brgba?\(\s*\d/.test(line) && !file.endsWith('tokens.css')) {
          offenders.push(`${relative(SRC, file)}:${i + 1}: rgb()`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
