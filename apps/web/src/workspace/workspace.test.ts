import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { createHash } from 'node:crypto';
import { processDocument, errorExtraction, parseTemplate, type TemplateSet } from '@pdfx/engine';
import { readPdfNode } from '@pdfx/pdf/node';
import { MemoryWorkspace } from './memory';
import { uniqueName, monthFolder, slugify, safeUserFolder } from './paths';
import {
  createFolders,
  missingFolders,
  takeLock,
  heldBy,
  releaseLock,
  appendAudit,
  auditPath,
  saveVersion,
  loadTemplates,
  saveDraft,
  loadDraft,
  archiveTemplate,
  DEFAULT_SETTINGS,
} from './store';
import { processFile, type ProcessDeps } from './process';
import { listExceptions, approve, reject } from './review';
import { parseCsv } from './csv';

const ROOT = pjoin(__dirname, '..', '..', '..', '..');
const pdf = (f: string) => new Uint8Array(readFileSync(pjoin(ROOT, 'fixtures', 'pdf', f)));
const tpl = (id: string, v: string) =>
  JSON.parse(readFileSync(pjoin(ROOT, 'fixtures', 'templates', id, v), 'utf8'));

function setsOf(): TemplateSet[] {
  return [
    'northline-fuel-statement',
    'apex-fleet-invoice',
    'coastal-telco-bill',
    'harbourside-coa',
  ].map((id) => {
    const r = parseTemplate(tpl(id, id === 'northline-fuel-statement' ? 'v2.json' : 'v1.json'));
    if (!r.ok) throw new Error();
    return { id, versions: [r.template] };
  });
}

const NOW = new Date('2026-10-22T09:14:03Z');

function deps(ws: MemoryWorkspace, extra: Partial<ProcessDeps> = {}): ProcessDeps {
  const sets = setsOf();
  return {
    ws,
    user: 'Sam',
    now: () => NOW,
    sets,
    settings: DEFAULT_SETTINGS,
    sha256: async (b) => createHash('sha256').update(b).digest('hex'),
    extract: async (bytes, _name, s) => {
      const r = await readPdfNode(bytes);
      if (!r.ok) return errorExtraction(r.code, r.message);
      return processDocument({ pages: r.pages }, s);
    },
    ...extra,
  };
}

describe('paths', () => {
  it('appends (2), (3) before the extension on collisions', async () => {
    const ws = new MemoryWorkspace();
    expect(await uniqueName(ws, 'A', 'x.pdf')).toBe('x.pdf');
    await ws.write('A/x.pdf', 'a');
    expect(await uniqueName(ws, 'A', 'x.pdf')).toBe('x (2).pdf');
    await ws.write('A/x (2).pdf', 'a');
    expect(await uniqueName(ws, 'A', 'x.pdf')).toBe('x (3).pdf');
  });
  it('helpers', () => {
    expect(monthFolder(new Date(2026, 9, 3))).toBe('2026-10');
    expect(slugify('Northline Fuel statement!')).toBe('northline-fuel-statement');
    expect(safeUserFolder('a/b:c')).toBe('a_b_c');
  });
});

describe('bootstrap, locks and audit', () => {
  it('creates the folder tree and settings', async () => {
    const ws = new MemoryWorkspace();
    expect(await missingFolders(ws)).toContain('Inbox');
    await createFolders(ws);
    expect(await missingFolders(ws)).toEqual([]);
    expect(await ws.exists('settings.json')).toBe(true);
  });
  it('a fresh lock blocks others; a stale one does not', async () => {
    const ws = new MemoryWorkspace();
    expect((await takeLock(ws, 'file:a.pdf', 'Sam', 'process', NOW)).ok).toBe(true);
    expect(await heldBy(ws, 'file:a.pdf', 'Alex', NOW)).toMatchObject({ user: 'Sam' });
    expect(await heldBy(ws, 'file:a.pdf', 'Sam', NOW)).toBeNull();
    const later = new Date(NOW.getTime() + 31 * 60 * 1000);
    expect(await heldBy(ws, 'file:a.pdf', 'Alex', later)).toBeNull();
    expect((await takeLock(ws, 'file:a.pdf', 'Alex', 'process', NOW)).ok).toBe(false);
    await releaseLock(ws, 'file:a.pdf', 'Sam');
    expect(await heldBy(ws, 'file:a.pdf', 'Alex', NOW)).toBeNull();
  });
  it('appends audit lines to a per-person monthly file', async () => {
    const ws = new MemoryWorkspace();
    await appendAudit(ws, 'Sam', [{ action: 'extracted', file: 'a, b.pdf' }], NOW);
    await appendAudit(ws, 'Sam', [{ action: 'approved', file: 'c.pdf' }], NOW);
    const rows = parseCsv(await ws.readText(auditPath('Sam', NOW)));
    expect(auditPath('Sam', NOW)).toBe('Audit/Sam/audit_2026-10.csv');
    expect(rows[0]).toEqual([
      'Timestamp',
      'User',
      'Action',
      'File',
      'Sha256',
      'Template',
      'Version',
      'Field',
      'OldValue',
      'NewValue',
      'Note',
    ]);
    expect(rows.slice(1).map((r) => [r[2], r[3]])).toEqual([
      ['extracted', 'a, b.pdf'],
      ['approved', 'c.pdf'],
    ]);
  });
});

describe('templates', () => {
  it('saves versions, reloads, drafts and archives', async () => {
    const ws = new MemoryWorkspace();
    await createFolders(ws);
    const t = setsOf()[0]!.versions[0]!;
    await saveDraft(ws, { template: t, savedAt: NOW.toISOString() });
    expect((await loadDraft(ws, t.id))?.template.id).toBe(t.id);
    const v1 = await saveVersion(ws, t, 'Sam', NOW);
    expect(v1.version).toBe(1);
    expect(await ws.exists(`Templates/${t.id}/draft.json`)).toBe(false);
    const v2 = await saveVersion(ws, t, 'Sam', NOW);
    expect(v2.version).toBe(2);
    const list = await loadTemplates(ws);
    expect(list[0]!.latest.version).toBe(2);
    expect(list[0]!.set.versions).toHaveLength(2);
    await archiveTemplate(ws, t.id, 'Sam', NOW);
    expect(await loadTemplates(ws)).toEqual([]);
    expect(await ws.exists(`Templates/_archived/${t.id}/v2.json`)).toBe(true);
  });
});

describe('processing order', () => {
  it('writes CSV then JSON, moves the PDF, audits, in that order', async () => {
    const ws = new MemoryWorkspace();
    await createFolders(ws);
    await ws.write('Inbox/northline-sep26.pdf', pdf('northline-sep26.pdf'));
    ws.log.length = 0;
    const r = await processFile(deps(ws), 'Inbox/northline-sep26.pdf');
    expect(r.outcome).toBe('ok');
    const order = ws.log.filter((l) => !l.includes('.locks'));
    expect(order).toEqual([
      'write Output/northline-fuel-statement/northline-sep26.csv',
      'write Output/northline-fuel-statement/northline-sep26.json',
      'move Inbox/northline-sep26.pdf -> Processed/2026-10/northline-sep26.pdf',
      'write Audit/Sam/audit_2026-10.csv',
    ]);
    expect(ws.log[0]).toMatch(/^write \.locks\//);
    expect(ws.log[ws.log.length - 1]).toMatch(/^delete \.locks\//);
    const golden = readFileSync(pjoin(ROOT, 'fixtures', 'expected', 'northline-sep26.csv'), 'utf8');
    expect(await ws.readText('Output/northline-fuel-statement/northline-sep26.csv')).toBe(golden);
  });

  it('a crash after step 5 then a re-run leaves no duplicates', async () => {
    const ws = new MemoryWorkspace();
    await createFolders(ws);
    await ws.write('Inbox/northline-sep26.pdf', pdf('northline-sep26.pdf'));
    const crash = deps(ws, {
      afterStep: (n) => {
        if (n === 5) throw new Error('crash');
      },
    });
    await expect(processFile(crash, 'Inbox/northline-sep26.pdf')).rejects.toThrow('crash');
    expect(await ws.exists('Inbox/northline-sep26.pdf')).toBe(true);
    const r = await processFile(deps(ws), 'Inbox/northline-sep26.pdf');
    expect(r.outcome).toBe('duplicate');
    expect((await ws.list('Output/northline-fuel-statement')).map((e) => e.name)).toEqual([
      'northline-sep26.csv',
      'northline-sep26.json',
    ]);
    expect(await ws.exists('Processed/2026-10/northline-sep26.pdf')).toBe(true);
    expect(await ws.exists('Inbox/northline-sep26.pdf')).toBe(false);
    const audit = parseCsv(await ws.readText(auditPath('Sam', NOW)))
      .slice(1)
      .map((r) => r[2]);
    expect(audit).toEqual(['duplicate']);
  });

  it('the same name with different contents gets a (2) output', async () => {
    const ws = new MemoryWorkspace();
    await createFolders(ws);
    await ws.write('Inbox/statement.pdf', pdf('northline-sep26.pdf'));
    await processFile(deps(ws), 'Inbox/statement.pdf');
    await ws.write('Inbox/statement.pdf', pdf('northline-jul26.pdf'));
    const r = await processFile(deps(ws), 'Inbox/statement.pdf');
    expect(r.outcome).toBe('ok');
    expect((await ws.list('Output/northline-fuel-statement')).map((e) => e.name)).toEqual([
      'statement (2).csv',
      'statement (2).json',
      'statement.csv',
      'statement.json',
    ]);
    expect((await ws.list('Processed/2026-10')).map((e) => e.name)).toEqual([
      'statement (2).pdf',
      'statement.pdf',
    ]);
  });

  it('unknown, error and review files go to Exceptions with a review file', async () => {
    const ws = new MemoryWorkspace();
    await createFolders(ws);
    for (const f of ['ridgeway-invoice-88231.pdf', 'encrypted.pdf'])
      await ws.write(`Inbox/${f}`, pdf(f));
    expect((await processFile(deps(ws), 'Inbox/ridgeway-invoice-88231.pdf')).outcome).toBe(
      'unknown',
    );
    expect((await processFile(deps(ws), 'Inbox/encrypted.pdf')).outcome).toBe('error');
    const items = await listExceptions(ws);
    expect(items.map((i) => [i.name, i.review.extraction.status])).toEqual([
      ['encrypted.pdf', 'error'],
      ['ridgeway-invoice-88231.pdf', 'unknown'],
    ]);
    expect(await ws.exists('Exceptions/ridgeway-invoice-88231.pdf')).toBe(true);
  });

  it('a file locked by someone else is skipped', async () => {
    const ws = new MemoryWorkspace();
    await createFolders(ws);
    await ws.write('Inbox/northline-sep26.pdf', pdf('northline-sep26.pdf'));
    await takeLock(ws, 'file:northline-sep26.pdf', 'Alex', 'process', NOW);
    const r = await processFile(deps(ws), 'Inbox/northline-sep26.pdf');
    expect(r.outcome).toBe('skipped');
    expect(r.lock?.user).toBe('Alex');
    expect(await ws.exists('Inbox/northline-sep26.pdf')).toBe(true);
  });

  it('approve writes corrected outputs, moves the file and audits; reject moves to Rejected', async () => {
    const ws = new MemoryWorkspace();
    await createFolders(ws);
    await ws.write('Inbox/n.pdf', pdf('northline-sep26.pdf'));
    // Simulate a misread amount.
    const d = deps(ws, {
      extract: async (bytes, _n, s) => {
        const r = await readPdfNode(bytes);
        if (!r.ok) throw new Error();
        r.pages[0]!.tokens.find((t) => t.text === '43.32')!.text = '34.32';
        return processDocument({ pages: r.pages }, s);
      },
    });
    expect((await processFile(d, 'Inbox/n.pdf')).outcome).toBe('review');
    const [item] = await listExceptions(ws);
    const t = setsOf()[0]!.versions[0]!;
    await approve(
      ws,
      item!,
      t,
      [{ table: 'Transactions', row: 3, column: 'Amount', to: '43.32' }],
      'Sam',
      DEFAULT_SETTINGS,
      NOW,
    );
    const json = JSON.parse(await ws.readText('Output/northline-fuel-statement/n.json'));
    expect(json.reviewedBy).toBe('Sam');
    expect(json.status).toBe('ok');
    expect(json.corrections).toEqual([
      { field: 'Amount', table: 'Transactions', row: 3, from: 34.32, to: 43.32 },
    ]);
    const csv = await ws.readText('Output/northline-fuel-statement/n.csv');
    expect(csv.split('\r\n')[1]!.endsWith(',ok,Sam,true')).toBe(true);
    expect(await ws.exists('Processed/2026-10/n.pdf')).toBe(true);
    expect(await ws.exists('Exceptions/n.review.json')).toBe(false);
    const audit = parseCsv(await ws.readText(auditPath('Sam', NOW))).slice(1);
    expect(audit.map((r) => [r[2], r[7], r[8], r[9]])).toEqual([
      ['extracted', '', '', ''],
      ['corrected', 'Transactions[4].Amount', '34.32', '43.32'],
      ['approved', '', '', ''],
    ]);

    await ws.write('Inbox/r.pdf', pdf('ridgeway-invoice-88231.pdf'));
    await processFile(deps(ws), 'Inbox/r.pdf');
    const [unknown] = await listExceptions(ws);
    await reject(ws, unknown!, 'Sam', NOW);
    expect(await ws.exists('Exceptions/Rejected/r.pdf')).toBe(true);
    expect(await ws.exists('Exceptions/Rejected/r.review.json')).toBe(true);
  });
});
