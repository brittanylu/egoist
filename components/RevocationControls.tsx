'use client';

/**
 * Revocation — the last stage of the loop. The holder can retire the whole tree, or
 * one branch of it.
 *
 * Nothing cascades explicitly: `verifyChain` walks to the root, so revoking one
 * Passport moves everything beneath it to `revoked` the instant the flag is set, and
 * touches no sibling branch.
 */
import { childrenOf, descendantsOf } from '@/lib/passport';
import { ACTOR_BY_ID } from '@/lib/seed';
import { holderLine, isTeamMember } from '@/lib/team';
import { useDemo } from '@/lib/store';
import { Chip, SectionHeading, cx } from './ui';
import { useChainStatuses } from './useChainStatus';

export function RevocationControls() {
  const statuses = useChainStatuses();
  const { registry, rootId, revokePassport, reset } = useDemo();

  const root = registry.passports[rootId];
  if (!root) return null;

  // Whichever branch the primary agent spawned first — the chain's shape depends on
  // what the human launched, so this cannot be pinned to one named subagent.
  const branch = childrenOf(registry, rootId)[0];
  const issuer = root.claims.issuer;

  const label = (id: string) => ACTOR_BY_ID[id]?.label ?? id;
  const statusOf = (id: string) => statuses[id]?.allowed ?? false;

  const branchSubtree = branch ? [branch, ...descendantsOf(registry, branch.claims.id)] : [];
  const others = Object.values(registry.passports).filter(
    (p) => !branchSubtree.some((b) => b.claims.id === p.claims.id),
  );

  return (
    <div className="card p-5">
      <SectionHeading
        eyebrow="Revocation"
        title="Withdraw authority."
        hint={
          <>
            Revoking an AI Passport retires it and its whole subtree; downstream Passports stop verifying. Only{' '}
            {isTeamMember(issuer) ? holderLine(issuer) : label(issuer)} can do this — no agent on the chain can
            withdraw anything, including its own Passport. Nothing outside that subtree moves.
          </>
        }
      />

      <div className="mt-4 space-y-2.5">
        <button
          type="button"
          className="btn-deny w-full justify-start"
          disabled={root.claims.revoked}
          onClick={() => revokePassport(root.claims.id)}
        >
          {root.claims.revoked ? 'Root revoked — every Passport below it is dark' : 'Revoke the root AI Passport'}
        </button>

        {branch && (
          <button
            type="button"
            className="btn-deny w-full justify-start"
            disabled={branch.claims.revoked}
            onClick={() => revokePassport(branch.claims.id)}
          >
            {branch.claims.revoked
              ? `${label(branch.claims.subject)}'s branch revoked`
              : `Revoke ${label(branch.claims.subject)}'s branch`}
          </button>
        )}

        <button type="button" className="btn-secondary w-full justify-start" onClick={reset}>
          Reset demo
        </button>
      </div>

      {/* Live effect, so the judge can see exactly which side of the tree died. */}
      {branch && (
        <div className="mt-4 border-t border-hairline pt-3">
          <div className="label">Effect on the tree</div>
          {/* min-w-0 on both columns is load-bearing. A grid item defaults to
              min-width:auto, so a track refuses to shrink below its widest
              unbreakable child — and .chip is whitespace-nowrap. Without it the
              first column sizes to its longest chip and overruns the second
              rather than letting the chips wrap. */}
          <div className="mt-3 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            <div className="min-w-0">
              <div className="text-[11px] uppercase leading-tight tracking-[0.1em] text-muted">
                {label(branch.claims.subject)} subtree
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {branchSubtree.map((p) => (
                  <Chip key={p.claims.id} tone={statusOf(p.claims.id) ? 'allow' : 'deny'} className="chip-mono">
                    {label(p.claims.subject)} · {statusOf(p.claims.id) ? 'active' : 'revoked'}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase leading-tight tracking-[0.1em] text-muted">
                Unrelated branches
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {others.map((p) => (
                  <Chip key={p.claims.id} tone={statusOf(p.claims.id) ? 'allow' : 'deny'} className="chip-mono">
                    {label(p.claims.subject)} · {statusOf(p.claims.id) ? 'active' : 'revoked'}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
          <p className={cx('mt-3 text-[12px] leading-relaxed text-muted')}>
            Revocation is verifier-side state, so it sits outside the issuer&rsquo;s signature: withdrawing an AI
            Passport does not forge it, it retires it.
          </p>
        </div>
      )}
    </div>
  );
}
