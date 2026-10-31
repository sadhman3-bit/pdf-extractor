import { Component, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { S } from '../strings';
import { useRoute, navigate, routeHref, type View } from './router';
import { app, useApp } from './store';
import { reconnect, startup } from './session';
import { installTestApi } from './testing';
import {
  AlertIcon,
  DocIcon,
  DotIcon,
  EyeCheckIcon,
  FlaskIcon,
  FolderIcon,
  GearIcon,
  InboxIcon,
  LayersIcon,
  MenuIcon,
  PointerIcon,
  SwitchIcon,
  XIcon,
} from '../components/Icons';
import { Banner, ErrorPanel, Toasts, reportProblem } from '../components/ui';
import { FirstRun } from '../screens/FirstRun';
import { SettingsDialog } from '../screens/Settings';
import { TemplatesScreen } from '../screens/Templates';
import { MapperScreen } from '../screens/Mapper';
import { TestScreen } from '../screens/TestSamples';
import { ProcessScreen } from '../screens/Process';
import { ReviewScreen } from '../screens/Review';
import { local } from '../lib/local';

const NAV: { view: View; label: string }[] = [
  { view: 'templates', label: S.nav.templates },
  { view: 'mapper', label: S.nav.mapper },
  { view: 'test', label: S.nav.test },
  { view: 'process', label: S.nav.process },
  { view: 'review', label: S.nav.review },
];

class Boundary extends Component<
  { children: ComponentChildren; resetKey: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null };
  static override getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override render() {
    if (this.state.error) {
      return (
        <ErrorPanel
          message={S.errors.body}
          detail={`${this.state.error.message}\n${this.state.error.stack ?? ''}`}
          onRetry={() => location.reload()}
        />
      );
    }
    return this.props.children;
  }
}

const NAV_ICON: Record<View, (p: { size?: number }) => preact.JSX.Element> = {
  templates: LayersIcon,
  mapper: PointerIcon,
  test: FlaskIcon,
  process: InboxIcon,
  review: EyeCheckIcon,
};

function Brand() {
  return (
    <a
      class="brand"
      href={routeHref({ view: 'templates' })}
      onClick={(e) => {
        e.preventDefault();
        navigate({ view: 'templates' });
      }}
    >
      <span class="brand-mark">
        <DocIcon size={16} />
      </span>
      <span class="brand-name">{S.appName}</span>
    </a>
  );
}

/** The working folder, its connection state, and the way to switch it. */
function FolderSwitch() {
  const s = useApp();
  if (s.basic || !s.folderName)
    return (
      <div class="folder-switch">
        <span class="caption">{S.topbar.browser}</span>
        {s.phase === 'basic' ? (
          <button type="button" class="btn-link small" onClick={() => app.set({ phase: 'choose' })}>
            <FolderIcon size={13} />
            {S.topbar.chooseFolder}
          </button>
        ) : null}
      </div>
    );
  return (
    <div class="folder-switch">
      <span class="caption">{S.topbar.workspace}</span>
      <span class="folder-line" title={S.topbar.folderLabel(s.folderName)}>
        <FolderIcon size={15} />
        <span class="folder-name-text">{s.folderName}</span>
      </span>
      {s.connected ? (
        <span class="folder-status">
          <span class="dot-ok">
            <DotIcon size={9} />
          </span>
          {S.topbar.connected}
        </span>
      ) : (
        <button type="button" class="btn btn-small btn-reconnect" onClick={() => void reconnect()}>
          <AlertIcon size={14} />
          {S.topbar.reconnect}
        </button>
      )}
      {s.phase === 'ready' ? (
        <button type="button" class="btn-link small" onClick={() => app.set({ phase: 'choose' })}>
          <SwitchIcon size={13} />
          {S.topbar.changeFolder}
        </button>
      ) : null}
    </div>
  );
}

/** Asked once, after the first download: results can go to a folder instead. */
function FolderOffer() {
  const close = (phase?: 'choose') => {
    local.setFolderOffered();
    app.set({ folderOffer: false, ...(phase ? { phase } : {}) });
  };
  return (
    <Banner
      action={
        <div class="row">
          <button type="button" class="btn btn-small" onClick={() => close('choose')}>
            <FolderIcon size={14} />
            {S.basic.offerChoose}
          </button>
          <button type="button" class="btn btn-small btn-text" onClick={() => close()}>
            {S.basic.offerLater}
          </button>
        </div>
      }
    >
      {S.basic.offer}
    </Banner>
  );
}

function SettingsButton() {
  return (
    <button
      type="button"
      class="side-link"
      title={S.topbar.settings}
      onClick={() => app.set({ settingsOpen: true })}
    >
      <GearIcon size={17} />
      <span class="nav-text">{S.topbar.settings}</span>
    </button>
  );
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const s = useApp();
  const route = useRoute();
  const ready = s.phase === 'ready' || s.phase === 'basic';
  return (
    <aside class={`sidebar${open ? ' open' : ''}`}>
      <Brand />
      <FolderSwitch />
      {ready ? (
        <nav class="nav" aria-label={S.nav.label}>
          {NAV.map((n) => {
            const Icon = NAV_ICON[n.view];
            return (
              <a
                key={n.view}
                href={routeHref({ view: n.view })}
                aria-current={route.view === n.view ? 'page' : undefined}
                title={n.label}
                onClick={(e) => {
                  e.preventDefault();
                  navigate({ view: n.view });
                  onNavigate();
                }}
              >
                <Icon size={17} />
                <span class="nav-text">{n.label}</span>
                {n.view === 'review' && s.exceptionCount > 0 ? (
                  <span class="nav-badge" aria-label={S.nav.reviewCount(s.exceptionCount)}>
                    {s.exceptionCount}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>
      ) : null}
      <div class="sidebar-foot">
        <SettingsButton />
      </div>
    </aside>
  );
}

/** Narrow screens: brand and a menu button; the sidebar slides in over the page. */
function MobileHeader({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <header class="mobile-header">
      <button
        type="button"
        class="icon-btn"
        aria-label={S.topbar.menu}
        aria-expanded={open}
        onClick={onToggle}
      >
        <MenuIcon />
      </button>
      <span class="brand brand-static">
        <span class="brand-mark">
          <DocIcon size={16} />
        </span>
        {S.appName}
      </span>
    </header>
  );
}

function Screen({ view }: { view: View }) {
  switch (view) {
    case 'templates':
      return <TemplatesScreen />;
    case 'mapper':
      return <MapperScreen />;
    case 'test':
      return <TestScreen />;
    case 'process':
      return <ProcessScreen />;
    case 'review':
      return <ReviewScreen />;
  }
}

function ProblemBanner({ problem }: { problem: { message: string; detail: string } }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Banner
      tone="danger"
      action={
        <div class="row">
          <button
            type="button"
            class="btn btn-small"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(
                  `${problem.message}

${problem.detail}`,
                )
                .then(() => setCopied(true))
            }
          >
            {copied ? S.common.copied : S.common.copyDetails}
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label={S.common.dismissProblem}
            onClick={() => app.set({ problem: null })}
          >
            <XIcon size={14} />
          </button>
        </div>
      }
    >
      <p>
        <strong>{problem.message}</strong>
      </p>
      <button
        type="button"
        class="btn-link small"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? S.common.hideDetails : S.common.showDetails}
      </button>
      {open ? <pre class="details">{problem.detail}</pre> : null}
    </Banner>
  );
}

export function App() {
  const s = useApp();
  const route = useRoute();
  const [fatal, setFatal] = useState<Error | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    installTestApi();
    startup().catch((e: Error) => setFatal(e));
    const onError = (e: PromiseRejectionEvent) => {
      if (String(e.reason?.message ?? '').includes('Failed to fetch dynamically imported module'))
        setFatal(e.reason as Error);
      // Anything else that failed in the background is shown, never swallowed.
      else reportProblem(S.update.background, e.reason);
    };
    window.addEventListener('unhandledrejection', onError);
    // A new version took over the offline copy while this tab was open: its old files are gone.
    const sw = navigator.serviceWorker;
    const had = !!sw?.controller;
    const onUpdate = () => {
      if (had) app.set({ updateReady: true });
    };
    sw?.addEventListener('controllerchange', onUpdate);
    return () => {
      window.removeEventListener('unhandledrejection', onError);
      sw?.removeEventListener('controllerchange', onUpdate);
    };
  }, []);

  useEffect(() => {
    local.setLastView(route.view);
    const title = NAV.find((n) => n.view === route.view)?.label;
    document.title = title ? `${title} · ${S.appName}` : S.appName;
  }, [route.view]);

  const firstRun = ['choose', 'confirm', 'name', 'done'].includes(s.phase);

  return (
    // The Mapper needs the width: the sidebar keeps only its icons there.
    <div class={`shell${route.view === 'mapper' ? ' shell-compact' : ''}`}>
      <MobileHeader open={menuOpen} onToggle={() => setMenuOpen(!menuOpen)} />
      {menuOpen ? <div class="scrim" onClick={() => setMenuOpen(false)} /> : null}
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <main class="page" id="main">
        {fatal ? (
          <ErrorPanel
            message={S.errors.body}
            detail={`${fatal.message}\n${fatal.stack ?? ''}`}
            onRetry={() => location.reload()}
          />
        ) : null}
        {s.updateReady ? (
          <Banner
            tone="warn"
            action={
              <button type="button" class="btn btn-primary" onClick={() => location.reload()}>
                {S.update.reload}
              </button>
            }
          >
            <p>
              <strong>{S.update.title}</strong>
            </p>
            <p>{S.update.body}</p>
          </Banner>
        ) : null}
        {s.problem ? <ProblemBanner problem={s.problem} /> : null}
        {s.slowRead ? (
          <Banner>{S.errors.slowRead(s.slowRead.split('/').pop() ?? '')}</Banner>
        ) : null}
        {s.folderOffer && s.phase === 'basic' ? <FolderOffer /> : null}
        {s.phase === 'reconnect' ? (
          <Banner
            tone="warn"
            action={
              <button type="button" class="btn btn-primary" onClick={() => void reconnect()}>
                {S.reconnect.button}
              </button>
            }
          >
            <p>
              <strong>{S.reconnect.title}</strong>
            </p>
            <p>{S.reconnect.body(s.folderName)}</p>
          </Banner>
        ) : null}
        {s.phase === 'loading' ? <p class="muted">{S.common.loading}</p> : null}
        {firstRun ? <FirstRun /> : null}
        {s.phase === 'ready' || s.phase === 'basic' ? (
          <Boundary resetKey={route.view}>
            <Screen view={route.view} />
          </Boundary>
        ) : null}
      </main>
      {s.settingsOpen ? <SettingsDialog /> : null}
      <Toasts />
      <div class="sr-only" aria-live="polite" role="status">
        {s.announce}
      </div>
    </div>
  );
}
