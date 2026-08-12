'use client';

/**
 * The Agents-track checklist, said plainly and in one place: holder, agent,
 * verifier, guards, lifecycle, scope, expiry, revocation, audit log, and what
 * happens out of scope.
 */
import { Em, useNow } from './ui';
import { formatCountdown } from '@/lib/authority';
import { useDemo } from '@/lib/store';

export function HowItWorks() {
  const now = useNow();
  const { registry, rootId } = useDemo();
  const root = registry.passports[rootId];

  const items: Array<{ term: string; detail: string }> = [
    {
      term: 'Holder',
      detail:
        'The Ops Lead — a human. They hold the signing key, issue the root Passport, and are the only party who can widen anything.',
    },
    {
      term: 'Agents',
      detail:
        'Agent A orchestrates triage; B de-duplicates; C classifies; D summarizes; E drafts the digest. Each holds its own Passport and its own key.',
    },
    {
      term: 'Verifier',
      detail:
        'The internal ticket service, running at /api/verify. It holds no secrets, trusts no agent’s account of its own permissions, and re-derives every guard from the chain.',
    },
    {
      term: 'Guards',
      detail:
        'The narrowing rules, one per field: guard:actions, guard:context, guard:destinations, guard:budget, guard:expiry, guard:depth. Each runs at mint time and again at verify time. A request that fails a guard falls back to requiring human authority.',
    },
    {
      term: 'Lifecycle',
      detail:
        'draft → active → revoked. A Passport that fails a guard never leaves draft; one that passes is active; one withdrawn or lapsed is revoked. The stage is derived from the chain, never stored.',
    },
    {
      term: 'Permission scope',
      detail:
        'Actions, context scopes, and destinations, shown as chips on every node. Chips a node gave up stay visible, struck through.',
    },
    {
      term: 'Expiry',
      detail: root
        ? `Every Passport carries its own countdown; the root expires in ${formatCountdown(root.claims.expiresAt, now)} and no descendant may outlive it.`
        : 'Every Passport carries its own countdown, and no descendant may outlive its parent.',
    },
    {
      term: 'Revocation',
      detail:
        'The holder can retire the root or any single Passport. Everything beneath a revoked Passport stops verifying immediately; sibling branches are untouched.',
    },
    {
      term: 'Audit log',
      detail:
        'Append-only audit log of actions, accesses, and refusals. Every entry names the agent, the request, the chain it came through, the guard that decided it, and what it fell back to.',
    },
    {
      term: 'Outside scope',
      detail:
        'Agent C’s attempt to send data to an external webhook fails guard:requested-destination and falls back to requiring human authority. The action does not happen; the refusal is written to the audit log.',
    },
  ];

  return (
    <div className="panel-soft p-7 sm:p-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="label">How it works</div>
          <h2 className="display mt-3 max-w-[20ch] text-[30px] sm:text-[38px]">
            Authority should <Em>shrink</Em> as it travels.
          </h2>
        </div>
        <p className="max-w-[46ch] text-[14px] leading-relaxed text-muted">
          Four things hold this together: signatures that link each Passport to its parent, a guard on every field, an
          expiry on every hop, and an audit entry for every decision.
        </p>
      </div>

      <dl className="mt-9 grid gap-x-12 gap-y-6 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.term} className="border-t border-hairline pt-4">
            <dt className="text-[13.5px] font-medium text-ink">{item.term}</dt>
            <dd className="mt-2 text-[13px] leading-relaxed text-muted">{item.detail}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-10 max-w-[70ch] border-t border-hairline pt-6 text-[15px] leading-relaxed text-ink">
        This is for an operations lead, who needs to prove to every downstream service that an agent&rsquo;s
        authority came from them and never grew — so work gets delegated safely without giving away more context than
        necessary.
      </p>
    </div>
  );
}
