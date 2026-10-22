// Runs the real engine in Node so e2e tests can compare what the interface saved
// against the golden outputs.
import { parseTemplate, toJsonObject, type Template } from '@pdfx/engine';
import { runFixture, EXTRACTED_AT } from '../../../tools/fixtures/src/goldens';
import { golden } from './helpers';

export async function extractWithSaved(
  file: string,
  json: string,
): Promise<{ fields: Record<string, unknown>; tables: Record<string, unknown>; status: string }> {
  const r = parseTemplate(JSON.parse(json));
  if (!r.ok) throw new Error(r.errors.join('; '));
  const t: Template = r.template;
  const { result, sha } = await runFixture(file, [{ id: t.id, versions: [t] }]);
  const o = toJsonObject(result, t, { file, sha256: sha, extractedAt: EXTRACTED_AT }) as {
    fields: Record<string, unknown>;
    tables: Record<string, unknown>;
    status: string;
  };
  return o;
}

export function goldenJson(base: string): {
  fields: Record<string, unknown>;
  tables: Record<string, unknown>;
  status: string;
} {
  return JSON.parse(golden(`${base}.json`));
}
