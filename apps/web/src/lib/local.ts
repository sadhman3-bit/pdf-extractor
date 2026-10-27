// Per-browser preferences in localStorage, always wrapped in try/catch.
const KEY = { user: 'pdfx.user', lastView: 'pdfx.lastView', theme: 'pdfx.theme' };

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export const local = {
  basic: () => get('pdfx.basic') === 'true',
  setBasic: (v: boolean) => set('pdfx.basic', String(v)),
  theme: (): 'light' | 'dark' => (get(KEY.theme) === 'dark' ? 'dark' : 'light'),
  setTheme: (v: 'light' | 'dark') => {
    set(KEY.theme, v);
    document.documentElement.dataset.theme = v;
  },
  user: () => get(KEY.user) ?? '',
  setUser: (v: string) => set(KEY.user, v),
  lastView: () => get(KEY.lastView),
  setLastView: (v: string) => set(KEY.lastView, v),
  clear: () => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  },
};
