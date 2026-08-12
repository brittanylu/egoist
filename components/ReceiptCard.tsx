'use client';

/**
 * A receipt, allow or refusal, rendered as the same first-class object. A refusal
 * is not an error state: it is the record that a boundary a human set actually held.
 */
import { formatTime, formatUsd } from '@/lib/authority';
import { Receipt } from '@/lib/passport';
import { ACTOR_BY_ID } from '@/lib/seed';
import { Chip, cx } from './ui';

function label(id: string) {
  return ACTOR_BY_ID[id]?.label ?? id;
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  if (typeof value === 'number') return String(value);
  if (value === null || value === undefined) return '—';
  return String(value);
}

export function ReceiptCard({ receipt, compact = false }: { receipt: Receipt; compact?: boolean }) {
  const allowed = receipt.kind === 'allow';

  return (
    <div
      className={cx(
        'rounded-card border p-4 animate-receipt',
        allowed ? 'border-allow/25 bg-canvas' : 'border-deny/25 bg-canvas',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cx(
              'rounded-full px-2.5 py-[3px] text-2xs font-medium uppercase tracking-[0.14em]',
              allowed ? 'bg-allow text-white' : 'bg-deny text-white',
            )}
          >
            {allowed ? 'allowed' : 'refused'}
          </span>
          <span className="font-mono text-[12.5px]">
            {label(receipt.subject)} · {receipt.request}
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted">{formatTime(receipt.at)}</span>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-ink/90">{receipt.detail}</p>

      {receipt.kind === 'refusal' && (
        <div className="mt-3 grid gap-x-6 gap-y-2 rounded-md border border-deny/15 bg-surface p-3 sm:grid-cols-2">
          <div>
            <div className="label text-deny/80">Blocked by</div>
            <div className="mt-1 font-mono text-[12px]">
              {receipt.checkName} · {receipt.violatedField}
            </div>
          </div>
          <div>
            <div className="label text-deny/80">At</div>
            <div className="mt-1 font-mono text-[12px]">
              hop {receipt.blockedAtHop} · {label(receipt.blockedAtSubject)}
            </div>
          </div>
          <div>
            <div className="label text-deny/80">Requested</div>
            <div className="mt-1 font-mono text-[12px] text-deny">{renderValue(receipt.requested)}</div>
          </div>
          <div>
            <div className="label text-deny/80">Permitted by inherited authority</div>
            <div className="mt-1 font-mono text-[12px]">{renderValue(receipt.permitted)}</div>
          </div>
          {!compact && (
            <div className="sm:col-span-2">
              <div className="label text-deny/80">Boundary set by</div>
              <div className="mt-1 text-[12.5px]">
                <span className="font-mono">{label(receipt.rootIssuer)}</span>, in the root Passport at the top of
                this chain.
              </div>
            </div>
          )}
        </div>
      )}

      {receipt.kind === 'allow' && !compact && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip tone="allow">{receipt.verifiedHops} hops verified</Chip>
          <Chip tone="allow">{formatUsd(receipt.budgetUsd)} budget</Chip>
          {receipt.scopesUsed.map((scope) => (
            <Chip key={scope} tone="allow">
              {scope}
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2.5 font-mono text-[11px] text-muted">
        {receipt.chainPath.map((id, i) => (
          <span key={`${id}-${i}`} className="flex items-center gap-1.5">
            <span className={i === 0 ? 'text-ink' : undefined}>{label(id)}</span>
            {i < receipt.chainPath.length - 1 && <span className="text-muted/50">→</span>}
          </span>
        ))}
        <span className="ml-auto">{receipt.id.slice(0, 14)}</span>
      </div>
    </div>
  );
}
