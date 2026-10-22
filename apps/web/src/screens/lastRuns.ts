// The last run result per template, kept per browser (a convenience, not a record).
const KEY = 'pdfx.lastRuns';

export function lastRuns(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function recordRun(id: string, text: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...lastRuns(), [id]: text }));
  } catch {
    /* ignore */
  }
}
