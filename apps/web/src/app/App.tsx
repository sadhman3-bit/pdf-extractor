import { Component, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { S } from '../strings';
import { useRoute, navigate, routeHref, type View } from './router';
import { app, useApp } from './store';
import { reconnect, startup } from './session';
import { installTestApi } from './testing';
import { DocIcon, FolderIcon, GearIcon, DotIcon, AlertIcon } from '../components/Icons';
import { Banner, ErrorPanel } from '../components/ui';
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

function TopBar() {
  const s = useApp();
  const route = useRoute();
  const ready = s.phase === 'ready' || s.phase === 'basic';
  return (
    <header class="topbar">
      <a
        class="brand"
        href={routeHref({ view: 'templates' })}
        onClick={(e) => {
          e.preventDefault();
          navigate({ view: 'templates' });
        }}
      >
        <DocIcon size={22} />
        {S.appName}
      </a>
      {ready ? (
        <nav class="nav" aria-label={S.nav.label}>
          {NAV.map((n) => (
            <a
              key={n.view}
              href={routeHref({ view: n.view })}
              aria-current={route.view === n.view ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate({ view: n.view });
              }}
            >
              {n.label}
              {n.view === 'review' && s.exceptionCount > 0 ? (
                <span class="nav-badge" aria-label={S.nav.reviewCount(s.exceptionCount)}>
                  {s.exceptionCount}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
      ) : null}
      <div class="topbar-right">
        {s.basic ? (
          <span class="folder-state">{S.topbar.basicMode}</span>
        ) : s.folderName ? (
          <span class="folder-state" title={S.topbar.folderLabel(s.folderName)}>
            <FolderIcon size={16} />
            <span>{s.folderName}</span>
            {s.connected ? (
              <span class="folder-state">
                <span class="dot-ok">
                  <DotIcon size={10} />
                </span>
                {S.topbar.connected}
              </span>
            ) : (
              <button
                type="button"
                class="btn btn-small btn-reconnect"
                onClick={() => void reconnect()}
              >
                <AlertIcon size={14} />
                {S.topbar.reconnect}
              </button>
            )}
          </span>
        ) : (
          <span>{S.topbar.noFolder}</span>
        )}
        <button
          type="button"
          class="icon-btn"
          aria-label={S.topbar.settings}
          onClick={() => app.set({ settingsOpen: true })}
          disabled={!ready}
        >
          <GearIcon />
        </button>
      </div>
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

export function App() {
  const s = useApp();
  const route = useRoute();
  const [fatal, setFatal] = useState<Error | null>(null);

  useEffect(() => {
    installTestApi();
    startup().catch((e: Error) => setFatal(e));
    const onError = (e: PromiseRejectionEvent) => {
      if (String(e.reason?.message ?? '').includes('Failed to fetch dynamically imported module'))
        setFatal(e.reason as Error);
    };
    window.addEventListener('unhandledrejection', onError);
    return () => window.removeEventListener('unhandledrejection', onError);
  }, []);

  useEffect(() => {
    local.setLastView(route.view);
    const title = NAV.find((n) => n.view === route.view)?.label;
    document.title = title ? `${title} · ${S.appName}` : S.appName;
  }, [route.view]);

  const firstRun = ['welcome', 'choose', 'confirm', 'name', 'done'].includes(s.phase);

  return (
    <>
      <TopBar />
      <main class="page" id="main">
        {fatal ? (
          <ErrorPanel
            message={S.errors.body}
            detail={`${fatal.message}\n${fatal.stack ?? ''}`}
            onRetry={() => location.reload()}
          />
        ) : null}
        {s.slowRead ? (
          <Banner>{S.errors.slowRead(s.slowRead.split('/').pop() ?? '')}</Banner>
        ) : null}
        {s.basic ? <Banner tone="warn">{S.basic.notice}</Banner> : null}
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
      <div class="sr-only" aria-live="polite" role="status">
        {s.announce}
      </div>
    </>
  );
}
