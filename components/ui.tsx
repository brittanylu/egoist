'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { STAGES, Stage } from '@/lib/authority';
import { ActorKind, TIER_LABEL } from '@/lib/seed';

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

/** An emphasis word inside a heading, marked by a thick rule under it. */
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

// ── Tiers ─────────────────────────────────────────────────────────────────────
/**
 * Colour per tier of the chain — human holder, primary agent, subagent.
 *
 * Applied at hairline weight: a 3px rail down the card, a badge outline, and a wash
 * at 4%. Never a filled surface. The card still reads black-on-white; the colour is
 * only there to say which kind of thing you are looking at before you read the name.
 */
export interface TierStyle {
  rail: string;
  text: string;
  border: string;
  wash: string;
}

export const TIER_STYLE: Record<ActorKind, TierStyle> = {
  // The holder gets no wash: its card is the one inverted surface on the page.
  human: { rail: 'bg-ink', text: 'text-ink', border: 'border-ink/25', wash: 'bg-canvas' },
  agent: {
    rail: 'bg-tier-agent',
    text: 'text-tier-agent',
    border: 'border-tier-agent/30',
    wash: 'bg-tier-agent/[0.04]',
  },
  subagent: {
    rail: 'bg-tier-sub',
    text: 'text-tier-sub',
    border: 'border-tier-sub/30',
    wash: 'bg-tier-sub/[0.04]',
  },
};

/** "primary agent" / "subagent", in that tier's colour. */
export function TierBadge({ kind, className }: { kind: ActorKind; className?: string }) {
  const tier = TIER_STYLE[kind];
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-[2px] text-[10px] font-medium leading-none tracking-tight',
        tier.border,
        tier.text,
        className,
      )}
    >
      {TIER_LABEL[kind]}
    </span>
  );
}

/** The three tiers, spelled out once above the graph. */
export function TierLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-muted">
      {(['human', 'agent', 'subagent'] as ActorKind[]).map((kind) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span className={cx('h-[3px] w-4 shrink-0 rounded-full', TIER_STYLE[kind].rail)} />
          {TIER_LABEL[kind]}
        </span>
      ))}
    </div>
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

// ── Lifecycle ─────────────────────────────────────────────────────────────────
const STAGE_TONE: Record<Stage, string> = {
  draft: 'border-hairline text-muted',
  active: 'border-allow/25 text-allow',
  revoked: 'border-deny/25 text-deny',
};

const STAGE_DOT: Record<Stage, 'allow' | 'deny' | 'muted'> = {
  draft: 'muted',
  active: 'allow',
  revoked: 'deny',
};

/**
 * Where a Passport sits in the loop, said in one word.
 *
 * Only the stage goes inside the border — it is one short word, so the pill keeps a
 * steady shape wherever it lands. The cause sits beside it as plain text: notes run
 * long ("ancestor revoked"), and inside a pill they wrap and crowd the shape.
 */
export function StatusPill({ stage, note }: { stage: Stage; note?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={cx(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] font-mono text-2xs leading-none',
          STAGE_TONE[stage],
        )}
      >
        <Dot tone={STAGE_DOT[stage]} />
        {stage}
      </span>
      {note && <span className="font-mono text-2xs leading-none text-muted">{note}</span>}
    </span>
  );
}

/** The whole loop, with the current stage marked. draft → active → revoked. */
export function StatusTrack({ stage }: { stage: Stage }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-2xs text-muted">
      {STAGES.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={cx(s === stage ? 'font-medium text-ink underline underline-offset-4' : 'text-muted/85')}>
            {s}
          </span>
          {i < STAGES.length - 1 && <span className="text-muted/70">→</span>}
        </span>
      ))}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  hint,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="label">{eyebrow}</div>
        <h2 className="display-sm mt-2.5 text-[23px]">{title}</h2>
        {hint && <p className="mt-2.5 max-w-prose text-[13.5px] leading-[1.5] text-muted">{hint}</p>}
      </div>
      {/* shrink-0: the action is a pill or chip, and squeezing it wraps its text. */}
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function KeyValue({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-baseline gap-3 py-1.5">
      <div className="text-[12px] uppercase tracking-[0.1em] text-muted">{label}</div>
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
