'use client';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn.js';

const focus =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

// ---------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  busy?: boolean;
}
const variants: Record<Variant, string> = {
  primary: 'bg-navy text-white hover:bg-navy-2 disabled:bg-navy/50',
  secondary: 'bg-surface text-ink border border-line hover:border-navy/40 disabled:text-muted',
  ghost: 'text-teal-ink hover:bg-teal/10 disabled:text-muted',
  danger: 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/50',
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', busy, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-s font-medium transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variants[variant],
        focus,
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Field + inputs
export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    required?: boolean;
  }) => ReactNode;
  className?: string;
}
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required && <span className="text-muted"> (required)</span>}
      </label>
      {children({
        id,
        'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
        required,
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const control = cn(
  'w-full rounded-s border border-line bg-surface px-3 text-base text-ink placeholder:text-muted/80 aria-[invalid=true]:border-danger',
  focus,
);
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...p }, ref) {
    return <input ref={ref} className={cn(control, 'h-10', className)} {...p} />;
  },
);
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...p }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(control, 'min-h-28 py-2 leading-relaxed', className)}
      {...p}
    />
  );
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...p }, ref) {
    return <select ref={ref} className={cn(control, 'h-10 pr-8', className)} {...p} />;
  },
);

// ---------------------------------------------------------------- feedback
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin motion-reduce:animate-none', className)}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity=".25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-s bg-line/60 motion-reduce:animate-none', className)}
      aria-hidden="true"
    />
  );
}

type Tone = 'info' | 'success' | 'warning' | 'error';
const tones: Record<Tone, string> = {
  info: 'border-navy/20 bg-navy/5',
  success: 'border-ok/30 bg-ok/10',
  warning: 'border-amber/40 bg-amber/10',
  error: 'border-danger/40 bg-danger/10',
};
export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-s border px-4 py-3 text-sm text-ink', tones[tone], className)}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-m border border-dashed border-line px-6 py-10">
      <p className="text-lg font-semibold text-ink">{title}</p>
      {children && <div className="max-w-prose text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- domain badges
const SEV: Record<string, { label: string; cls: string }> = {
  P1: { label: 'P1 Critical', cls: 'bg-danger text-white' },
  P2: { label: 'P2 High', cls: 'bg-amber text-navy' },
  P3: { label: 'P3 Medium', cls: 'bg-navy/10 text-navy dark:bg-white/10 dark:text-ink' },
  P4: { label: 'P4 Low', cls: 'border border-line text-muted' },
};
export function SeverityBadge({ severity, compact }: { severity: string; compact?: boolean }) {
  const s = SEV[severity] ?? SEV.P4!;
  return (
    <span
      className={cn('inline-flex h-6 items-center rounded-s px-2 text-xs font-semibold', s.cls)}
    >
      {compact ? severity : s.label}
    </span>
  );
}

export function StatusPill({ label, open }: { label: string; open: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink">
      <span
        className={cn('h-2 w-2 rounded-full', open ? 'bg-teal' : 'bg-muted')}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/**
 * SLA budget bar: how much of the contractual time has been used. Colour bands follow the
 * warning thresholds (50/75/90/100 %); state is always also given in text, never colour alone.
 */
export function SlaBar({
  label,
  percent,
  remainingSeconds,
  met,
  paused,
  dueAt,
  className,
}: {
  label: string;
  percent: number;
  remainingSeconds: number;
  met: boolean;
  paused: boolean;
  dueAt: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, percent));
  const breached = !met && remainingSeconds < 0;
  const fill = met
    ? 'bg-ok'
    : breached || pct >= 90
      ? 'bg-danger'
      : pct >= 75
        ? 'bg-amber'
        : 'bg-teal';
  const state = met
    ? 'Met'
    : breached
      ? `Overdue by ${fmtDuration(-remainingSeconds)}`
      : paused
        ? `Paused (${fmtDuration(remainingSeconds)} left)`
        : `${fmtDuration(remainingSeconds)} left`;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink">{label}</span>
        <span
          className={cn(
            'tabular-nums',
            breached
              ? 'font-semibold text-danger'
              : met
                ? 'text-ok'
                : pct >= 75
                  ? 'text-amber-ink'
                  : 'text-muted',
          )}
        >
          {state}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-line/70"
        role="meter"
        aria-label={`${label}: ${state}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className={cn('h-full', fill, paused && !met && 'opacity-50')}
          style={{ width: `${met ? 100 : pct}%` }}
        />
      </div>
      <span className="text-xs text-muted">Due {fmtIst(dueAt)} IST</span>
    </div>
  );
}

export function fmtDuration(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
export function fmtIst(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

// ---------------------------------------------------------------- dialog (native, accessible)
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(36rem,calc(100vw-2rem))] rounded-m border border-line bg-surface p-0 text-ink backdrop:bg-navy/50"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="text-xl font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------- brand
export function Wordmark({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-semibold tracking-tight',
        inverted ? 'text-white' : 'text-navy dark:text-ink',
        className,
      )}
    >
      <svg viewBox="0 0 28 28" className="h-7 w-7" aria-hidden="true">
        <rect width="28" height="28" rx="6" fill="rgb(var(--wd-teal))" />
        <path
          d="M6 9l3.2 10L14 11l4.8 8L22 9"
          fill="none"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-lg">
        WatchDog <span className="font-normal opacity-80">Support</span>
      </span>
    </span>
  );
}
