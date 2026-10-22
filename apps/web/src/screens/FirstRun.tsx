import { useState } from 'preact/hooks';
import { S } from '../strings';
import { app, useApp } from '../app/store';
import { chooseFolder, confirmFolders, enterBasic, setUser } from '../app/session';
import { navigate } from '../app/router';
import { BOOTSTRAP_DIRS } from '../workspace/paths';
import { Banner } from '../components/ui';
import { FolderIcon } from '../components/Icons';

export function FirstRun() {
  const s = useApp();
  const [error, setError] = useState('');
  const [name, setName] = useState(s.user);
  const [busy, setBusy] = useState(false);

  if (s.phase === 'welcome') {
    return (
      <section class="card stack" aria-labelledby="fr-title">
        <h1 id="fr-title" class="page-title">
          {S.firstRun.welcomeTitle}
        </h1>
        <p>{S.firstRun.welcomeBody}</p>
        <p class="muted">{S.firstRun.privacy}</p>
        <div class="row">
          <button
            type="button"
            class="btn btn-primary"
            onClick={() => app.set({ phase: 'choose' })}
          >
            {S.firstRun.start}
          </button>
        </div>
      </section>
    );
  }

  if (s.phase === 'choose') {
    return (
      <section class="card stack" aria-labelledby="fr-title">
        <h1 id="fr-title" class="page-title">
          {S.firstRun.chooseTitle}
        </h1>
        <p>{S.firstRun.chooseBody}</p>
        {error ? <Banner tone="warn">{error}</Banner> : null}
        <div class="row">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              const r = await chooseFolder();
              setBusy(false);
              if (r === 'cancelled') setError(S.firstRun.pickerCancelled);
              if (r === 'unsupported') await enterBasic();
            }}
          >
            <FolderIcon />
            {S.firstRun.chooseButton}
          </button>
        </div>
      </section>
    );
  }

  if (s.phase === 'confirm') {
    return (
      <section class="card stack" aria-labelledby="fr-title">
        <h1 id="fr-title" class="page-title">
          {S.firstRun.confirmTitle}
        </h1>
        <p>{S.firstRun.confirmBody(s.folderName)}</p>
        <ul class="list-plain mono">
          {(s.missing.length ? s.missing : BOOTSTRAP_DIRS).map((d) => (
            <li key={d}>{d}/</li>
          ))}
        </ul>
        <div class="row">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await confirmFolders();
              setBusy(false);
            }}
          >
            {S.firstRun.confirmButton}
          </button>
        </div>
      </section>
    );
  }

  if (s.phase === 'name') {
    return (
      <section class="card stack" aria-labelledby="fr-title">
        <h1 id="fr-title" class="page-title">
          {S.firstRun.nameTitle}
        </h1>
        <p>{S.firstRun.nameBody}</p>
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void setUser(name);
          }}
        >
          <label class="field">
            {S.firstRun.nameLabel}
            <input
              type="text"
              value={name}
              autoComplete="name"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
          <div class="row">
            <button type="submit" class="btn btn-primary" disabled={!name.trim()}>
              {S.firstRun.nameButton}
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section class="card stack" aria-labelledby="fr-title">
      <h1 id="fr-title" class="page-title">
        {S.firstRun.doneTitle}
      </h1>
      <p>{S.firstRun.doneBody}</p>
      <div class="row">
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => {
            app.set({ phase: 'ready' });
            navigate({ view: 'templates' });
          }}
        >
          {S.firstRun.createTemplate}
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            app.set({ phase: 'ready' });
            navigate({ view: 'process' });
          }}
        >
          {S.firstRun.processInbox}
        </button>
      </div>
    </section>
  );
}
