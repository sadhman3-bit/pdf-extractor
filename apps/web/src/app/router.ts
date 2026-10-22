import { useEffect, useState } from 'preact/hooks';

export type View = 'templates' | 'mapper' | 'test' | 'process' | 'review';
export const VIEWS: View[] = ['templates', 'mapper', 'test', 'process', 'review'];

export interface Route {
  view: View;
  template?: string;
  file?: string;
  from?: string;
}

export function parseRoute(search: string): Route {
  const q = new URLSearchParams(search);
  const v = q.get('view') as View | null;
  const route: Route = { view: v && VIEWS.includes(v) ? v : 'templates' };
  const t = q.get('template');
  if (t) route.template = t;
  const f = q.get('file');
  if (f) route.file = f;
  const from = q.get('from');
  if (from) route.from = from;
  return route;
}

export function routeHref(route: Route): string {
  const q = new URLSearchParams();
  q.set('view', route.view);
  if (route.template) q.set('template', route.template);
  if (route.file) q.set('file', route.file);
  if (route.from) q.set('from', route.from);
  return `${location.pathname}?${q.toString()}`;
}

const listeners = new Set<() => void>();

export function navigate(route: Route, replace = false): void {
  const href = routeHref(route);
  if (replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  listeners.forEach((l) => l());
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.search));
  useEffect(() => {
    const update = () => setRoute(parseRoute(location.search));
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return route;
}
