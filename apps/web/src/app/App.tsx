import { S } from '../strings';
import { useRoute, navigate, routeHref, type View } from './router';
import { DocIcon, GearIcon } from '../components/Icons';

const NAV: { view: View; label: string }[] = [
  { view: 'templates', label: S.nav.templates },
  { view: 'mapper', label: S.nav.mapper },
  { view: 'test', label: S.nav.test },
  { view: 'process', label: S.nav.process },
  { view: 'review', label: S.nav.review },
];

export function App() {
  const route = useRoute();
  return (
    <>
      <header class="topbar">
        <a class="brand" href={routeHref({ view: 'templates' })}>
          <DocIcon size={22} />
          {S.appName}
        </a>
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
            </a>
          ))}
        </nav>
        <div class="topbar-right">
          <span>{S.topbar.noFolder}</span>
          <button type="button" class="icon-btn" aria-label={S.topbar.settings}>
            <GearIcon />
          </button>
        </div>
      </header>
      <main class="page">
        <h1 class="page-title">{NAV.find((n) => n.view === route.view)?.label}</h1>
      </main>
    </>
  );
}
