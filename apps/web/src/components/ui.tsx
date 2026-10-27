import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { S } from '../strings';
import { app } from '../app/store';
import { AlertIcon, CheckIcon, InfoIcon, QuestionIcon, UploadIcon, XIcon } from './Icons';

export type Tone = 'success' | 'warn' | 'danger' | 'neutral' | 'accent';

export function Chip({ tone, children }: { tone: Tone; children: ComponentChildren }) {
  const Icon =
    tone === 'success'
      ? CheckIcon
      : tone === 'danger'
        ? XIcon
        : tone === 'warn'
          ? AlertIcon
          : tone === 'accent'
            ? InfoIcon
            : QuestionIcon;
  return (
    <span class={`chip chip-${tone}`}>
      <Icon size={12} />
      {children}
    </span>
  );
}

export function Banner({
  tone = 'accent',
  children,
  action,
}: {
  tone?: Tone;
  children: ComponentChildren;
  action?: ComponentChildren;
}) {
  const Icon =
    tone === 'success'
      ? CheckIcon
      : tone === 'danger'
        ? XIcon
        : tone === 'warn'
          ? AlertIcon
          : InfoIcon;
  const cls = tone === 'accent' || tone === 'neutral' ? 'banner' : `banner banner-${tone}`;
  return (
    <div class={cls} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon />
      <div class="grow">{children}</div>
      {action}
    </div>
  );
}

/** A small spinning ring. Decorative: pair it with visible text. */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      class="spinner"
      aria-hidden="true"
      ref={(el) => {
        if (el) {
          el.style.width = `${size}px`;
          el.style.height = `${size}px`;
        }
      }}
    />
  );
}

/** Seconds since this component appeared, ticking once a second. */
function useElapsed(): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = window.setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);
  return secs;
}

/**
 * "Something is happening" line: spinner, what is happening, seconds so far, and
 * a note when it runs long, so nobody mistakes a slow step for a stuck one.
 */
export function Working({ label, slowAfter = 10 }: { label: string; slowAfter?: number }) {
  const secs = useElapsed();
  return (
    <div class="working" role="status">
      <Spinner />
      <span>{label}</span>
      {secs >= 2 ? <span class="caption">{S.common.elapsed(secs)}</span> : null}
      {secs >= slowAfter ? <p class="caption working-slow">{S.common.slow}</p> : null}
    </div>
  );
}

let toastId = 0;

/** Shows a short confirmation ("Saved as version 3") for a few seconds, and announces it. */
export function toast(text: string, action?: { label: string; run: () => void }): void {
  const id = ++toastId;
  app.set({ toasts: [...app.get().toasts, { id, text, ...(action ? { action } : {}) }].slice(-3) });
  app.announce(text);
  window.setTimeout(
    () => app.set({ toasts: app.get().toasts.filter((t) => t.id !== id) }),
    action ? 8000 : 4000,
  );
}

export function Toasts() {
  const { toasts } = useAppToasts();
  if (!toasts.length) return null;
  return (
    <div class="toasts">
      {toasts.map((t) => (
        <div class="toast" key={t.id}>
          <span class="toast-icon" aria-hidden="true">
            <CheckIcon size={14} />
          </span>
          <span aria-hidden="true">{t.text}</span>
          {t.action ? (
            <button
              type="button"
              class="toast-action"
              onClick={() => {
                t.action!.run();
                app.set({ toasts: app.get().toasts.filter((x) => x.id !== t.id) });
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function useAppToasts() {
  const [s, set] = useState(app.get());
  useEffect(() => app.subscribe(() => set(app.get())), []);
  return s;
}

/** Reports a failed action at the top of the page instead of failing silently. */
export function reportProblem(what: string, e: unknown): void {
  const err = e as Error;
  // An old copy of the app in this tab: the fix is a reload, not a report.
  if (err?.name === 'WorkerGone') {
    app.set({ updateReady: true });
    return;
  }
  app.set({
    problem: {
      message: S.common.failed(what),
      detail: `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}${
        err?.stack
          ? `
${err.stack}`
          : ''
      }`,
    },
  });
}

/**
 * A button for a slow action. While it runs it shows a spinner and `busyLabel`,
 * and can't be pressed twice. If the action throws, the error is reported at the
 * top of the page and the button comes back.
 */
export function ActionButton({
  onAction,
  busyLabel,
  children,
  class: cls = 'btn',
  disabled,
  ...rest
}: {
  onAction: () => Promise<unknown> | unknown;
  busyLabel?: string;
  children: ComponentChildren;
  class?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  return (
    <button
      type="button"
      {...rest}
      class={cls}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={async () => {
        setBusy(true);
        try {
          await onAction();
        } catch (e) {
          reportProblem(busyLabel?.replace(/…$/, '') ?? S.common.working, e);
        } finally {
          if (alive.current) setBusy(false);
        }
      }}
    >
      {busy ? <Spinner /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div
      class="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={ref}>
        <div class="card-head">
          <h2 id="dialog-title" class="card-title">
            {title}
          </h2>
          <button type="button" class="icon-btn" aria-label={S.common.close} onClick={onClose}>
            <XIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DropZone({
  onFiles,
  multiple = true,
  label,
  compact = false,
}: {
  onFiles: (f: File[]) => void;
  multiple?: boolean;
  label?: string;
  /** A slim one-line drop bar instead of the large drop area. */
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      class={`dropzone${compact ? ' compact' : ''}${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.pdf$/i.test(f.name));
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <UploadIcon />
      <p>
        {label ?? S.common.dropHere}{' '}
        <button type="button" class="btn btn-text" onClick={() => input.current?.click()}>
          {S.common.chooseFiles}
        </button>
      </p>
      <input
        ref={input}
        class="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        multiple={multiple}
        aria-label={S.common.chooseFile}
        tabIndex={-1}
        onChange={(e) => {
          const files = [...((e.target as HTMLInputElement).files ?? [])];
          (e.target as HTMLInputElement).value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

export function ErrorPanel({
  title = S.errors.title,
  message,
  detail,
  onRetry,
}: {
  title?: string;
  message: string;
  detail?: string;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="card stack" role="alert">
      <h2 class="card-title">{title}</h2>
      <p>{message}</p>
      <p class="muted small">{S.errors.what}</p>
      {detail ? <pre class="details">{detail}</pre> : null}
      <div class="row">
        {onRetry ? (
          <button type="button" class="btn btn-primary" onClick={onRetry}>
            {S.errors.reload}
          </button>
        ) : null}
        <button
          type="button"
          class="btn"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(`${message}\n\n${detail ?? ''}`)
              .then(() => setCopied(true));
          }}
        >
          {copied ? S.common.copied : S.common.copyDetails}
        </button>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: JSX.Element;
  hint?: string;
}) {
  return (
    <label class="field">
      {label}
      {children}
      {hint ? <span class="caption">{hint}</span> : null}
    </label>
  );
}

export function downloadBlob(name: string, data: Uint8Array | string, type: string): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function timeHM(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-AU')} ${timeHM(d)}`;
}

export async function fileBytes(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}
