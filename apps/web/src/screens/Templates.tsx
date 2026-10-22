import { useState } from 'preact/hooks';
import { S } from '../strings';
import { app, useApp } from '../app/store';
import { navigate } from '../app/router';
import { now, refresh } from '../app/session';
import { Banner, Dialog, DropZone, dateTime, downloadBlob, fileBytes } from '../components/ui';
import { archiveTemplate, saveVersion, type TemplateInfo } from '../workspace/store';
import { importFiles } from './Settings';
import { lastRuns } from './lastRuns';

export function TemplatesScreen() {
  const s = useApp();
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'warn'; text: string } | null>(null);
  const runs = lastRuns();

  const startNew = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    app.set({ pendingSample: { name: f.name, bytes: await fileBytes(f) } });
    setCreating(false);
    navigate({ view: 'mapper', template: '' });
  };

  const duplicate = async (t: TemplateInfo) => {
    if (!s.ws) return;
    const ids = new Set(s.templates.map((x) => x.id));
    let id = `${t.id}-copy`;
    for (let n = 2; ids.has(id); n++) id = `${t.id}-copy-${n}`;
    await saveVersion(
      s.ws,
      { ...t.latest, id, name: S.templates.copyOf(t.latest.name), version: 0 },
      s.user,
      now(),
    );
    await refresh();
  };

  const archive = async (t: TemplateInfo) => {
    if (!s.ws) return;
    await archiveTemplate(s.ws, t.id, s.user, now());
    await refresh();
    setMsg({ tone: 'success', text: S.templates.archived(t.latest.name) });
    app.announce(S.templates.archived(t.latest.name));
  };

  return (
    <>
      <div class="page-head">
        <div>
          <h1 class="page-title">{S.templates.title}</h1>
          <p class="page-sub">{S.templates.sub}</p>
        </div>
        <div class="row">
          <label class="btn">
            {S.templates.importJson}
            <input
              type="file"
              class="sr-only"
              accept=".json,.zip,application/json"
              multiple
              onChange={async (e) => {
                const files = [...((e.target as HTMLInputElement).files ?? [])];
                (e.target as HTMLInputElement).value = '';
                try {
                  const n = await importFiles(files);
                  setMsg({ tone: 'success', text: S.templates.imported(n) });
                } catch {
                  setMsg({ tone: 'warn', text: S.templates.importFailed });
                }
              }}
            />
          </label>
          <button type="button" class="btn btn-primary" onClick={() => setCreating(true)}>
            {S.templates.newTemplate}
          </button>
        </div>
      </div>
      {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
      {!s.templates.length ? (
        <section class="card stack">
          <p>{S.templates.empty}</p>
          <div class="row">
            <button type="button" class="btn btn-primary" onClick={() => setCreating(true)}>
              {S.templates.emptyButton}
            </button>
          </div>
        </section>
      ) : (
        <section class="card">
          <div class="table-wrap" tabIndex={0}>
            <table class="data">
              <thead>
                <tr>
                  <th scope="col">{S.templates.colName}</th>
                  <th scope="col">{S.templates.colVersion}</th>
                  <th scope="col">{S.templates.colSaved}</th>
                  <th scope="col">{S.templates.colSamples}</th>
                  <th scope="col">{S.templates.colLastRun}</th>
                  <th scope="col">
                    <span class="sr-only">{S.templates.open}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.latest.name}</strong>
                      <div class="caption mono">{t.id}</div>
                      {t.hasDraft ? <div class="caption">{S.templates.draft}</div> : null}
                    </td>
                    <td class="mono">v{t.latest.version}</td>
                    <td>
                      {t.latest.savedAt
                        ? S.templates.savedBy(t.latest.savedBy ?? '', dateTime(t.latest.savedAt))
                        : S.common.none}
                    </td>
                    <td class="num">{t.samples.length}</td>
                    <td>{runs[t.id] ?? S.templates.noRuns}</td>
                    <td>
                      <div class="row">
                        <button
                          type="button"
                          class="btn btn-small"
                          onClick={() => navigate({ view: 'mapper', template: t.id })}
                        >
                          {S.templates.open}
                        </button>
                        <button
                          type="button"
                          class="btn btn-small"
                          onClick={() => navigate({ view: 'test', template: t.id })}
                        >
                          {S.templates.test}
                        </button>
                        <button
                          type="button"
                          class="btn btn-small btn-text"
                          onClick={() => void duplicate(t)}
                        >
                          {S.templates.duplicate}
                        </button>
                        <button
                          type="button"
                          class="btn btn-small btn-text"
                          onClick={() =>
                            downloadBlob(
                              `${t.id}.v${t.latest.version}.json`,
                              `${JSON.stringify(t.latest, null, 2)}\n`,
                              'application/json',
                            )
                          }
                        >
                          {S.templates.exportJson}
                        </button>
                        <button
                          type="button"
                          class="btn btn-small btn-text"
                          onClick={() => void archive(t)}
                        >
                          {S.templates.archive}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {creating ? (
        <Dialog title={S.templates.newTitle} onClose={() => setCreating(false)}>
          <p>{S.templates.newBody}</p>
          <DropZone multiple={false} onFiles={(f) => void startNew(f)} />
        </Dialog>
      ) : null}
    </>
  );
}
