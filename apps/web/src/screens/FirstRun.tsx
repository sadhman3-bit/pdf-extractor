import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { S } from '../strings';
import { app, useApp, type Phase } from '../app/store';
import { chooseFolder, confirmFolders, enterBasic, setUser } from '../app/session';
import { navigate } from '../app/router';
import { BOOTSTRAP_DIRS, SETTINGS_FILE } from '../workspace/paths';
import { Banner, Spinner, Working, fileBytes } from '../components/ui';
import { CheckIcon, FolderIcon, InfoIcon } from '../components/Icons';

const STEP_OF: Partial<Record<Phase, number>> = { choose: 0, confirm: 1, name: 2 };

/** "1 Choose folder — 2 Create folders — 3 Your name", with the current step marked. */
function Steps({ current }: { current: number }) {
  return (
    <ol class="steps" aria-label={S.firstRun.stepsLabel}>
      {S.firstRun.steps.map((label, i) => (
        <li
          key={label}
          class={i < current ? 'done' : undefined}
          aria-current={i === current ? 'step' : undefined}
        >
          <span class="step-num">{i < current ? <CheckIcon size={12} /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function Shell({ step, children }: { step?: number; children: ComponentChildren }) {
  return (
    <div class="onboarding">
      {step !== undefined ? <Steps current={step} /> : null}
      <section class="card stack" aria-labelledby="fr-title">
        {children}
      </section>
    </div>
  );
}

function ChooseStep() {
  const s = useApp();
  // Opened from Settings → Change folder: the current folder is set up and can be kept.
  const canKeep = !!s.ws && s.connected && !s.missing.length && !!s.user;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The folder window can fail to appear (some embedded browsers) or open behind
  // this window. After a few seconds, say so and offer a way on.
  const [slow, setSlow] = useState(false);
  const slowTimer = useRef<number | null>(null);

  const choose = async () => {
    setBusy(true);
    setError('');
    setSlow(false);
    slowTimer.current = window.setTimeout(() => setSlow(true), 6000);
    try {
      const r = await chooseFolder();
      if (r === 'cancelled') setError(S.firstRun.pickerCancelled);
      else if (r === 'unsupported') await enterBasic();
      else if (typeof r === 'object') setError(S.firstRun.pickerFailed(r.failed));
    } catch (e) {
      setError(S.firstRun.pickerFailed(String((e as Error)?.message ?? e)));
    } finally {
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
      setSlow(false);
      setBusy(false);
    }
  };

  return (
    <Shell step={0}>
      <h1 id="fr-title" class="page-title">
        {S.firstRun.chooseTitle}
      </h1>
      <p class="lead">{S.firstRun.chooseBody}</p>
      {error ? <Banner tone="warn">{error}</Banner> : null}
      {busy ? <Working label={S.firstRun.waitingForPicker} slowAfter={60} /> : null}
      {slow ? (
        <Banner
          action={
            <button type="button" class="btn" onClick={() => void enterBasic()}>
              {S.firstRun.useBasic}
            </button>
          }
        >
          {S.firstRun.pickerSlow}
        </Banner>
      ) : null}
      <div class="row">
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void choose()}
        >
          {busy ? <Spinner /> : <FolderIcon />}
          {S.firstRun.chooseButton}
        </button>
        {canKeep && !busy ? (
          <button type="button" class="btn" onClick={() => app.set({ phase: 'ready' })}>
            {S.firstRun.keepFolder(s.folderName)}
          </button>
        ) : null}
      </div>
    </Shell>
  );
}

type FolderState = 'todo' | 'now' | 'done';

function ConfirmStep() {
  const s = useApp();
  const items = [...(s.missing.length ? s.missing : BOOTSTRAP_DIRS), SETTINGS_FILE];
  const [states, setStates] = useState<Record<string, FolderState>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setRunning(true);
    setError('');
    const seen: Record<string, FolderState> = {};
    let last = '';
    try {
      await confirmFolders((path) => {
        if (last) seen[last] = 'done';
        seen[path] = 'now';
        last = path;
        setStates({ ...seen });
      });
      if (last) seen[last] = 'done';
      setStates({ ...seen });
    } catch (e) {
      setError(S.firstRun.createFailed(String((e as Error)?.message ?? e)));
      setRunning(false);
    }
  };

  const current = items.find((i) => states[i] === 'now');
  const doneCount = items.filter((i) => states[i] === 'done').length;

  return (
    <Shell step={1}>
      <h1 id="fr-title" class="page-title">
        {S.firstRun.confirmTitle}
      </h1>
      <p class="lead">{S.firstRun.confirmBody(s.folderName)}</p>
      <ul class="folder-list">
        {items.map((d) => {
          const st = states[d] ?? 'todo';
          const name = d === SETTINGS_FILE ? d : `${d}/`;
          return (
            <li key={d} class={st === 'now' ? 'is-now' : undefined}>
              <span class="icon-dir">
                {d === SETTINGS_FILE ? <InfoIcon size={16} /> : <FolderIcon size={16} />}
              </span>
              <span>
                <span class="folder-name">{name}</span>
                <br />
                <span class="folder-what">{S.firstRun.folderWhat[d] ?? ''}</span>
              </span>
              <span
                class={st === 'done' ? 'done' : 'now'}
                aria-label={
                  st === 'done'
                    ? S.firstRun.created
                    : st === 'now'
                      ? S.firstRun.creating
                      : undefined
                }
              >
                {st === 'done' ? (
                  <CheckIcon size={16} />
                ) : st === 'now' ? (
                  <Spinner size={14} />
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {error ? (
        <Banner tone="danger">
          <p>{error}</p>
        </Banner>
      ) : null}
      {running && !error ? (
        <Working
          label={S.firstRun.creatingProgress(current ?? '', doneCount, items.length)}
          slowAfter={8}
        />
      ) : null}
      <div class="row">
        <button
          type="button"
          class="btn btn-primary"
          disabled={running && !error}
          aria-busy={(running && !error) || undefined}
          onClick={() => void create()}
        >
          {running && !error ? <Spinner /> : null}
          {error
            ? S.firstRun.tryAgain
            : running
              ? S.firstRun.creatingButton
              : S.firstRun.confirmButton}
        </button>
        {!running || error ? (
          <button type="button" class="btn" onClick={() => app.set({ phase: 'choose' })}>
            {S.firstRun.chooseAnother}
          </button>
        ) : null}
      </div>
    </Shell>
  );
}

function NameStep() {
  const s = useApp();
  const [name, setName] = useState(s.user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Shell step={2}>
      <h1 id="fr-title" class="page-title">
        {S.firstRun.nameTitle}
      </h1>
      <p class="lead">{S.firstRun.nameBody}</p>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          setError('');
          try {
            await setUser(name);
          } catch (err) {
            setError(
              S.common.failed(S.firstRun.nameButton) + ` ${String((err as Error)?.message ?? err)}`,
            );
            setBusy(false);
          }
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
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div class="row">
          <button
            type="submit"
            class="btn btn-primary"
            disabled={!name.trim() || busy}
            aria-busy={busy || undefined}
          >
            {busy ? <Spinner /> : null}
            {busy ? S.firstRun.loadingWorkspace : S.firstRun.nameButton}
          </button>
          {!busy ? (
            <button type="button" class="btn" onClick={() => app.set({ phase: 'choose' })}>
              {S.firstRun.chooseAnother}
            </button>
          ) : null}
        </div>
      </form>
    </Shell>
  );
}

export function FirstRun() {
  const s = useApp();

  if (s.phase === 'welcome') {
    return (
      <Shell>
        <h1 id="fr-title" class="page-title">
          {S.firstRun.welcomeTitle}
        </h1>
        <p class="lead">{S.firstRun.welcomeBody}</p>
        <p class="privacy-note">
          <InfoIcon size={16} />
          {S.firstRun.privacy}
        </p>
        <div class="row">
          <label class="btn btn-primary">
            {S.firstRun.openPdf}
            <input
              class="sr-only"
              type="file"
              accept="application/pdf,.pdf"
              onChange={async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                const bytes = await fileBytes(file);
                await enterBasic();
                app.set({ pendingSample: { name: file.name, bytes } });
                navigate({ view: 'mapper', template: '' });
              }}
            />
          </label>
          <button type="button" class="btn btn-text" onClick={() => app.set({ phase: 'choose' })}>
            {S.firstRun.start}
          </button>
        </div>
        <p class="caption">{S.firstRun.openHint}</p>
      </Shell>
    );
  }
  if (s.phase === 'choose') return <ChooseStep />;
  if (s.phase === 'confirm') return <ConfirmStep />;
  if (s.phase === 'name') return <NameStep />;

  return (
    <Shell step={STEP_OF.name! + 1}>
      <h1 id="fr-title" class="page-title">
        {S.firstRun.doneTitle}
      </h1>
      <p class="lead">{S.firstRun.doneBody}</p>
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
    </Shell>
  );
}
