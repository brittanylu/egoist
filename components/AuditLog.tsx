'use client';

/**
 * The append-only audit log. Every action, every access, every refusal, in the
 * order it happened. Refusals are not filtered, collapsed, or styled as errors —
 * they are the entries that prove a guard held.
 */
import { useState } from 'react';
import { useDemo } from '@/lib/store';
import { ReceiptCard } from './ReceiptCard';
import { Em, SectionHeading, cx } from './ui';

type Filter = 'all' | 'allow' | 'refusal';

export function AuditLog() {
  const { receipts, clearReceipts } = useDemo();
  const [filter, setFilter] = useState<Filter>('all');

  const counts = {
    all: receipts.length,
    allow: receipts.filter((r) => r.kind === 'allow').length,
    refusal: receipts.filter((r) => r.kind === 'refusal').length,
  };
  const shown = receipts.filter((r) => filter === 'all' || r.kind === filter);

  return (
    <div className="card flex h-full flex-col p-5">
      <SectionHeading
        eyebrow="Audit log"
        title={
          <>
            Nothing is <Em>omitted</Em>.
          </>
        }
        hint="Every AI Passport check — allow, access, or refusal — is written here, append-only."
        action={
          receipts.length > 0 && (
            <button type="button" className="btn-ghost text-[12px]" onClick={clearReceipts}>
              Clear
            </button>
          )
        }
      />

      <div className="mt-3 flex gap-1.5">
        {(['all', 'allow', 'refusal'] as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={cx(
              'rounded-full border px-2.5 py-1 font-mono text-[11.5px] transition-all duration-200',
              filter === option ? 'border-ink bg-ink text-canvas' : 'border-hairline bg-canvas text-muted hover:border-ink/30',
            )}
          >
            {option} {counts[option]}
          </button>
        ))}
      </div>

      <div className="scroll-thin mt-3 max-h-[560px] flex-1 space-y-3 overflow-y-auto pr-1">
        {shown.length === 0 ? (
          <div className="rounded-card border border-dashed border-hairline p-5 text-center text-[12.5px] text-muted">
            Every AI Passport check lands here — allow or refusal — with the guard that decided it.
          </div>
        ) : (
          shown.map((receipt) => <ReceiptCard key={receipt.id} receipt={receipt} compact />)
        )}
      </div>
    </div>
  );
}
