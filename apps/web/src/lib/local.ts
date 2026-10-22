// Per-browser preferences in localStorage, always wrapped in try/catch.
const KEY = { user: 'pdfx.user', lastView: 'pdfx.lastView' };

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
