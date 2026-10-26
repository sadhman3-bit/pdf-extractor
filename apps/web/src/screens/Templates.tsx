import { useState } from 'preact/hooks';
import { S } from '../strings';
import { app, useApp } from '../app/store';
import { navigate } from '../app/router';
import { now, refresh } from '../app/session';
import {
  Banner,
  Dialog,
  DropZone,
  dateTime,
  downloadBlob,
  fileBytes,
  ActionButton,
} from '../components/ui';
import { LayersIcon } from '../components/Icons';
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
        <section class="card empty">
          <span class="empty-icon">
            <LayersIcon size={22} />
          </span>
          <h2 class="card-title">{S.templates.emptyTitle}</h2>
          <p>{S.templates.empty}</p>
          <button type="button" class="btn btn-primary" onClick={() => setCreating(true)}>
            {S.templates.emptyButton}
          </button>
        </section>
      ) : (
        <div class="card-grid">
          {s.templates.map((t) => (
            <article class="card tpl-card" key={t.id} aria-labelledby={`tpl-${t.id}`}>
              <div class="tpl-head">
                <div class="grow">
                  <h2 class="card-title" id={`tpl-${t.id}`}>
                    {t.latest.name}
                  </h2>
                  <div class="caption mono">{t.id}</div>
                </div>
                <span class="chip chip-accent">v{t.latest.version}</span>
              </div>
              <dl class="meta">
                <div>
                  <dt>{S.templates.colSamples}</dt>
                  <dd>{t.samples.length}</dd>
                </div>
                <div>
                  <dt>{S.templates.colSaved}</dt>
                  <dd>
                    {t.latest.savedAt ? dateTime(t.latest.savedAt) : S.common.none}
                    {t.latest.savedBy ? (
                      <span class="caption block">{S.templates.byWhom(t.latest.savedBy)}</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>{S.templates.colLastRun}</dt>
                  <dd>{runs[t.id] ?? S.templates.noRuns}</dd>
                </div>
              </dl>
              {t.hasDraft ? <span class="chip chip-warn">{S.templates.draft}</span> : null}
              <div class="tpl-actions">
                <div class="row">
                  <button
                    type="button"
                    class="btn btn-small btn-primary"
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
                </div>
                <div class="row">
                  <ActionButton
                    busyLabel={S.busy.duplicating}
                    class="btn btn-small btn-text"
                    aria-label={`${S.templates.duplicate} ${t.latest.name}`}
                    onAction={() => duplicate(t)}
                  >
                    {S.templates.duplicate}
                  </ActionButton>
                  <button
                    type="button"
                    class="btn btn-small btn-text"
                    aria-label={`${S.templates.exportJson} ${t.latest.name}`}
                    onClick={() =>
                      downloadBlob(
                        `${t.id}.v${t.latest.version}.json`,
                        `${JSON.stringify(t.latest, null, 2)}
`,
                        'application/json',
                      )
                    }
                  >
                    {S.templates.exportJson}
                  </button>
                  <ActionButton
                    busyLabel={S.busy.archiving}
                    class="btn btn-small btn-text"
                    aria-label={`${S.templates.archive} ${t.latest.name}`}
                    onAction={() => archive(t)}
                  >
                    {S.templates.archive}
                  </ActionButton>
                </div>
              </div>
            </article>
          ))}
        </div>
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
