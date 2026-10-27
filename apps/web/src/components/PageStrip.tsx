import { useEffect, useRef } from 'preact/hooks';
import { S } from '../strings';

export interface StripPage {
  /** Rows of the table being mapped on this page. */
  rows: number;
  /** The table's header or end is on this page. */
  header?: boolean;
  end?: boolean;
  /** Lines matching the search. */
  found?: number;
}

/**
 * Every page of the sample in a row of small buttons, marked where the table
 * starts, has rows and ends, and where the search found something.
 */
export function PageStrip({
  count,
  current,
  info,
  onPick,
}: {
  count: number;
  current: number;
  info: Map<number, StripPage>;
  onPick: (page: number) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  return (
    <nav class="page-strip" aria-label={S.mapper.strip.label} ref={nav}>
      {Array.from({ length: count }, (_, i) => {
        const n = i + 1;
        const p = info.get(n);
        const cls = [
          'strip-page',
          p?.rows ? 'strip-rows' : '',
          p?.header ? 'strip-start' : '',
          p?.end ? 'strip-end' : '',
          p?.found ? 'strip-found' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={n}
            type="button"
            class={cls}
            aria-current={n === current ? 'page' : undefined}
            aria-label={S.mapper.strip.page(n, p)}
            title={S.mapper.strip.page(n, p)}
            onClick={() => onPick(n)}
          >
            {n}
          </button>
        );
      })}
    </nav>
  );
}
