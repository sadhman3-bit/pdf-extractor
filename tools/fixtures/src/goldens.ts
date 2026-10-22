// Writes golden outputs (fixtures/expected) by running every fixture through the
// engine with the reference templates. Review the diff by hand before committing.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  parseTemplate,
  processDocument,
  errorExtraction,
  toCsv,
  toJson,
  baseName,
  latest,
  type TemplateSet,
  type Extraction,
} from '@pdfx/engine';
import { readPdfNode } from '@pdfx/pdf/node';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PDF_DIR = join(ROOT, 'fixtures', 'pdf');
export const TEMPLATE_DIR = join(ROOT, 'fixtures', 'templates');
export const EXPECTED_DIR = join(ROOT, 'fixtures', 'expected');
export const EXTRACTED_AT = '2026-10-22T09:14:03Z';

/** Fixtures that have golden outputs (digital, or deliberately failing). */
export const GOLDEN_FIXTURES = [
  'northline-sep26.pdf',
  'northline-jun26.pdf',
  'northline-jul26.pdf',
  'northline-aug26.pdf',
  'coastal-telco-sep26.pdf',
  'apex-fleet-sep26.pdf',
  'harbourside-coa-a2391.pdf',
  'rotated.pdf',
  'ridgeway-invoice-88231.pdf',
  'encrypted.pdf',
  'corrupt.pdf',
  'blank.pdf',
];

export function loadTemplateSets(dir = TEMPLATE_DIR): TemplateSet[] {
  return readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, 'v1.json')))
    .map((id) => ({
      id,
      versions: readdirSync(join(dir, id))
        .filter((f) => /^v\d+\.json$/.test(f))
        .map((f) => {
          const r = parseTemplate(JSON.parse(readFileSync(join(dir, id, f), 'utf8')));
          if (!r.ok) throw new Error(`${id}/${f}: ${r.errors.join('; ')}`);
          return r.template;
        }),
    }));
}

export async function runFixture(
  file: string,
  sets: TemplateSet[],
): Promise<{ result: Extraction; sha: string }> {
  const bytes = new Uint8Array(readFileSync(join(PDF_DIR, file)));
  const sha = createHash('sha256').update(bytes).digest('hex');
  const read = await readPdfNode(bytes);
  if (!read.ok) return { result: errorExtraction(read.code, read.message), sha };
  return { result: processDocument({ pages: read.pages }, sets), sha };
}

export async function goldenOutputs(file: string, sets: TemplateSet[]) {
  const { result, sha } = await runFixture(file, sets);
  const meta = { file, sha256: sha, extractedAt: EXTRACTED_AT };
  const set = result.template ? sets.find((s) => s.id === result.template!.id) : undefined;
  const t = set
    ? (set.versions.find((v) => v.version === result.template!.version) ?? latest(set))
    : null;
  const out: Record<string, string> = {};
  const base = baseName(file);
  out[`${base}.json`] = toJson(result, t, meta);
  if (t) {
    for (const csv of toCsv(result, t, meta))
      out[`${base}${csv.table ? `.${csv.table}` : ''}.csv`] = csv.content;
  }
  return { result, out };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  mkdirSync(EXPECTED_DIR, { recursive: true });
  const sets = loadTemplateSets();
  for (const file of GOLDEN_FIXTURES) {
    const { result, out } = await goldenOutputs(file, sets);
    for (const [name, content] of Object.entries(out))
      writeFileSync(join(EXPECTED_DIR, name), content);
    const rows = Object.values(result.tables).reduce((s, t) => s + t.rows.length, 0);
    console.log(
      `${file.padEnd(30)} ${result.status.padEnd(9)} rows=${rows} ${result.reasons.map((r) => r.code).join(',')}`,
    );
  }
}
