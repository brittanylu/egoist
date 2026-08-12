'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ── A single ticking clock for the whole page, so expiry countdowns and live
// verification stay honest without one interval per card. ──────────────────────
const ClockContext = createContext<number>(0);

export function ClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

export function useNow(): number {
  return useContext(ClockContext) || Date.now();
}

/** An emphasis word inside a heading, set in a real italic. */
export function Em({ children }: { children: ReactNode }) {
  return <span className="em">{children}</span>;
}

// ── Chips ─────────────────────────────────────────────────────────────────────
export function Chip({
  children,
  tone = 'default',
  className,
  title,
}: {
  children: ReactNode;
  tone?: 'default' | 'strong' | 'dim' | 'lost' | 'allow' | 'deny' | 'invert';
  className?: string;
  title?: string;
}) {
  const tones: Record<string, string> = {
    default: 'chip',
    strong: 'chip chip-strong',
    dim: 'chip chip-dim',
    lost: 'chip chip-dim line-through decoration-muted/50 opacity-50',
    allow: 'chip border-allow/25 text-allow',
    deny: 'chip border-deny/25 text-deny',
    invert: 'chip border-white/20 bg-white/[0.07] text-canvas/80',
  };
  return (
    <span className={cx(tones[tone], className)} title={title}>
      {children}
    </span>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-hairline px-3 py-1 text-2xs font-medium uppercase tracking-[0.16em] text-muted">
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: 'allow' | 'deny' | 'muted' }) {
  const colors = { allow: 'bg-allow', deny: 'bg-deny', muted: 'bg-muted' };
  return <span className={cx('inline-block h-[6px] w-[6px] shrink-0 rounded-full', colors[tone])} />;
}

export function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-2xs font-medium',
        ok ? 'border-allow/25 text-allow' : 'border-deny/25 text-deny',
      )}
    >
      <Dot tone={ok ? 'allow' : 'deny'} />
      {label ?? (ok ? 'chain verified' : 'chain broken')}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  hint,
  action,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="label">{eyebrow}</div>
        <h2 className="display mt-2 text-[21px]">{title}</h2>
        {hint && <p className="mt-2 max-w-prose text-[13.5px] leading-relaxed text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function KeyValue({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-baseline gap-3 py-1.5">
      <div className="text-2xs uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className={cx('text-[13px] leading-snug', mono && 'font-mono text-[12px]')}>{children}</div>
    </div>
  );
}

/** Thin authority meter. Shrinks with each hop; turns red when the chain is broken. */
export function AuthorityBar({ percent, broken }: { percent: number; broken?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-hairline">
        <div
          className={cx(
            'h-full rounded-full transition-all duration-700 ease-calm',
            broken ? 'bg-deny/70' : 'bg-ink',
          )}
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">{percent}%</span>
    </div>
  );
}
