import { useState } from 'preact/hooks';
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';
import { S } from '../strings';
import { app, useApp } from '../app/store';
import { chooseFolder, refresh, now } from '../app/session';
import { Dialog, downloadBlob, Banner } from '../components/ui';
import { importTemplate, saveSettings } from '../workspace/store';
import { local } from '../lib/local';

/** On GitHub Pages (owner.github.io/pdf-extractor) the repository is github.com/owner/pdf-extractor. */
export function repoUrl(): string | null {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
  return m ? `https://github.com/${m[1]}/pdf-extractor` : null;
}

export async function exportAllTemplates(): Promise<void> {
  const { templates } = app.get();
  const files: Record<string, Uint8Array> = {};
  for (const t of templates)
    for (const v of t.set.versions)
      files[`${t.id}/v${v.version}.json`] = strToU8(`${JSON.stringify(v, null, 2)}\n`);
  downloadBlob('pdf-extractor-templates.zip', zipSync(files), 'application/zip');
}

export async function importFiles(files: File[]): Promise<number> {
  const { ws, user } = app.get();
  if (!ws) return 0;
  let n = 0;
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const docs: unknown[] = [];
    if (/\.zip$/i.test(f.name)) {
      for (const [name, data] of Object.entries(unzipSync(bytes)))
        if (name.endsWith('.json')) docs.push(JSON.parse(strFromU8(data)));
    } else docs.push(JSON.parse(strFromU8(bytes)));
    for (const d of docs) {
      await importTemplate(ws, d, user || 'Unknown', now());
      n++;
    }
  }
  await refresh();
  return n;
}

export function SettingsDialog() {
  const s = useApp();
  const [name, setName] = useState(s.user);
  const [threshold, setThreshold] = useState(String(s.settings.confidenceThreshold));
  const [bom, setBom] = useState(s.settings.csvBom);
  const [msg, setMsg] = useState('');
  const close = () => app.set({ settingsOpen: false });
  const t = Number(threshold);
  const valid = Number.isFinite(t) && t >= 0.5 && t <= 1;
  return (
    <Dialog title={S.settings.title} onClose={close}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          local.setUser(name.trim());
          app.set({ user: name.trim() });
          if (s.ws) {
            const settings = { ...s.settings, confidenceThreshold: t, csvBom: bom };
            await saveSettings(s.ws, settings);
            app.set({ settings });
          }
          setMsg(S.settings.saved);
          app.announce(S.settings.saved);
        }}
      >
        <label class="field">
          {S.settings.name}
          <input
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        {!s.basic ? (
          <>
            <label class="field">
              {S.settings.threshold}
              <input
                type="number"
                min="0.5"
                max="1"
                step="0.05"
                value={threshold}
                aria-invalid={!valid}
                onInput={(e) => setThreshold((e.target as HTMLInputElement).value)}
              />
              <span class="caption">{S.settings.thresholdHint}</span>
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={bom}
                onChange={(e) => setBom((e.target as HTMLInputElement).checked)}
              />
              {S.settings.bom}
            </label>
          </>
        ) : null}
        {msg ? <Banner tone="success">{msg}</Banner> : null}
        <div class="row">
          <button type="submit" class="btn btn-primary" disabled={!valid}>
            {S.common.save}
          </button>
          {!s.basic ? (
            <button
              type="button"
              class="btn"
              onClick={async () => {
                close();
                await chooseFolder();
              }}
            >
              {S.settings.changeFolder}
            </button>
          ) : null}
        </div>
      </form>
      <div class="row">
        <button
          type="button"
          class="btn"
          onClick={() => void exportAllTemplates()}
          disabled={!s.templates.length}
        >
          {S.settings.exportTemplates}
        </button>
        <label class="btn">
          {S.settings.importTemplates}
          <input
            type="file"
            class="sr-only"
            accept=".json,.zip,application/json,application/zip"
            multiple
            onChange={async (e) => {
              const files = [...((e.target as HTMLInputElement).files ?? [])];
              try {
                const n = await importFiles(files);
                setMsg(S.templates.imported(n));
              } catch {
                setMsg(S.templates.importFailed);
              }
            }}
          />
        </label>
      </div>
      <p class="caption">
        {S.settings.version(__APP_VERSION__)}
        {repoUrl() ? (
          <>
            {' · '}
            <a href={repoUrl()!} target="_blank" rel="noreferrer">
              {S.settings.repo}
            </a>
          </>
        ) : null}
      </p>
    </Dialog>
  );
}
