'use client';

/**
 * The judge drives Agent C, the leaf of the chain, and watches the verifier decide.
 * One action is inside its inherited authority. One is not, and never was — at any
 * point on the chain, all the way up to the human.
 */
import { Action, Destination } from '@/lib/passport';
import { ACTOR_BY_ID } from '@/lib/seed';
import { useDemo } from '@/lib/store';
import { ReceiptCard } from './ReceiptCard';
import { Chip, SectionHeading, cx } from './ui';
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

const ATTEMPTS: Attempt[] = [
  {
    key: 'classify',
    title: 'Classify ticket internally',
    hint: 'inside inherited authority',
    action: 'classify',
    destination: 'internal-only',
    note: 'ticket #4471',
    tone: 'primary',
  },
  {
    key: 'send',
    title: 'Send data to external service',
    hint: 'never granted by the human',
    action: 'send',
    destination: 'external-webhook',
    tone: 'deny',
  },
];

export function ActionConsole() {
  const statuses = useChainStatuses();
  const { registry, leafId, attempt, receipts, pendingAction, verifierMode } = useDemo();
  const leaf = registry.passports[leafId];
  const latest = receipts[0];

  if (!leaf) return null;

  const actor = ACTOR_BY_ID[leaf.claims.subject];
  const verification = statuses[leafId];

  return (
    <div className="card p-5">
      <SectionHeading
        eyebrow="Action console"
        title={`${actor?.label ?? leaf.claims.subject} requests an action`}
        hint="The verifier walks this chain back to the human root before answering. It takes no agent's word for its own permissions."
        action={
          verifierMode && (
            <Chip tone="dim">
              decided by {verifierMode === 'service' ? '/api/verify' : 'local verifier'}
            </Chip>
          )
        }
      />

      <div className="mt-4 flex flex-wrap gap-2.5">
        {ATTEMPTS.map((item) => {
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
          {actor?.label ?? leaf.claims.subject}&rsquo;s chain is currently broken, so every action it attempts will
          be refused: {verification.reason}
        </p>
      )}

      <div className="mt-4">
        {latest ? (
          <div key={latest.id}>
            <div className="label mb-2">Latest receipt</div>
            <ReceiptCard receipt={latest} />
          </div>
        ) : (
          <div className="rounded-card border border-dashed border-hairline p-5 text-center text-[12.5px] text-muted">
            No receipts yet. Try the allowed action, then the one that was never granted.
          </div>
        )}
      </div>
    </div>
  );
}
