'use client';

/**
 * The judge drives the classifier subagent — the leaf of the chain — and watches the
 * verifier decide.
 * One action passes every guard. One fails a guard, and always would have — at any
 * point on the chain, all the way up to the human.
 */
import { Action, Destination } from '@/lib/passport';
import { ACTOR_BY_ID } from '@/lib/seed';
import { useDemo } from '@/lib/store';
import { ReceiptCard } from './ReceiptCard';
import { Chip, Em, SectionHeading, cx } from './ui';
import { useChainStatuses } from './useChainStatus';

interface Attempt {
  key: string;
  title: string;
  hint: string;
  action: Action;
  destination: Destination;
  note?: string;
  tone: 'primary' | 'deny';
}

/**
 * The internal action to offer, and what to call it. Which one appears depends on
 * what the leaf actually inherited — a human who never ticked "Classify" produces a
 * chain where no agent can classify, and the console should not pretend otherwise.
 */
const INTERNAL_ATTEMPTS: Partial<Record<Action, { title: string; note: string }>> = {
  classify: { title: 'Classify ticket internally', note: 'ticket #4471' },
  write: { title: 'Write the internal digest', note: 'digest draft' },
  read: { title: 'Read ticket text internally', note: 'ticket #4471' },
  send: { title: 'Send results internally', note: 'theme summary' },
};

/** Preference order: the most characteristic thing this agent could do, first. */
const INTERNAL_ORDER: Action[] = ['classify', 'write', 'read', 'send'];

export function ActionConsole() {
  const statuses = useChainStatuses();
  const { registry, leafId, attempt, receipts, pendingAction, verifierMode } = useDemo();
  const leaf = registry.passports[leafId];
  const latest = receipts[0];

  if (!leaf) return null;

  const actor = ACTOR_BY_ID[leaf.claims.subject];
  const verification = statuses[leafId];

  // One action inside what it inherited, one outside. The second is only a refusal
  // because a person left external transfer off the root grant — if they turned it on,
  // it passes, and saying so is more honest than a button that always fails.
  const passAction = INTERNAL_ORDER.find((a) => leaf.claims.actions.includes(a)) ?? 'read';
  const internal = INTERNAL_ATTEMPTS[passAction]!;
  const holdsSend = leaf.claims.actions.includes('send');
  const externalGranted = leaf.claims.allowedDestinations.includes('external-webhook');

  const attempts: Attempt[] = [
    {
      key: 'internal',
      title: internal.title,
      hint: leaf.claims.actions.includes(passAction)
        ? 'passes every guard'
        : 'nothing internal was granted — fails guard:requested-action',
      action: passAction,
      destination: 'internal-only',
      note: internal.note,
      tone: 'primary',
    },
    {
      key: 'external',
      title: 'Send data to external service',
      hint: !holdsSend
        ? 'fails guard:requested-action'
        : externalGranted
          ? 'allowed — a human put external transfer on the root grant'
          : 'fails guard:requested-destination',
      action: 'send',
      destination: 'external-webhook',
      tone: holdsSend && externalGranted ? 'primary' : 'deny',
    },
  ];

  return (
    <div className="card p-5">
      <SectionHeading
        eyebrow="Action console"
        title={
          <>
            {actor?.label ?? leaf.claims.subject} requests an <Em>action</Em>.
          </>
        }
        hint="The verifier walks this chain back to the human root and re-derives every guard. It takes no agent's word for its own permissions. A request that fails a guard falls back to requiring human authority."
        action={
          verifierMode && (
            <Chip tone="dim" className="px-2.5">
              decided by
              <span className="chip-mono text-ink">
                {verifierMode === 'service' ? '/api/verify' : 'local verifier'}
              </span>
            </Chip>
          )
        }
      />

      <div className="mt-4 flex flex-wrap gap-2.5">
        {attempts.map((item) => {
          const key = `${leafId}:${item.action}:${item.destination}`;
          const pending = pendingAction === key;
          return (
            <button
              key={item.key}
              type="button"
              disabled={Boolean(pendingAction)}
              onClick={() => attempt(leafId, item.action, item.destination, item.note)}
              className={cx(
                'flex-1 min-w-[220px] rounded-card border p-3.5 text-left transition-all duration-200 ease-calm disabled:opacity-60',
                item.tone === 'deny'
                  ? 'border-deny/25 bg-canvas hover:border-deny/50 hover:bg-canvas'
                  : 'border-hairline bg-canvas hover:border-ink/35',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-medium">{item.title}</span>
                {pending && <span className="text-2xs text-muted">verifying…</span>}
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted">
                {item.action} → {item.destination}
              </div>
              <div className={cx('mt-2 text-[11.5px]', item.tone === 'deny' ? 'text-deny' : 'text-muted')}>
                {item.hint}
              </div>
            </button>
          );
        })}
      </div>

      {verification && !verification.allowed && (
        <p className="mt-3 rounded-md border border-deny/20 bg-canvas p-2.5 text-[12.5px] leading-relaxed text-deny">
          {actor?.label ?? leaf.claims.subject}&rsquo;s chain fails a guard already, so every action it attempts is
          refused: {verification.reason}
        </p>
      )}

      <div className="mt-4">
        {latest ? (
          <div key={latest.id}>
            <div className="label mb-2">Latest audit entry</div>
            <ReceiptCard receipt={latest} />
          </div>
        ) : (
          <div className="rounded-card border border-dashed border-hairline p-5 text-center text-[12.5px] text-muted">
            The audit log is empty. Try the action that passes, then the one that fails a guard.
          </div>
        )}
      </div>
    </div>
  );
}
