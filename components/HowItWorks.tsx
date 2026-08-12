'use client';

/**
 * The Agents-track checklist, said plainly and in one place: holder, agent,
 * verifier, scope, expiry, revocation, receipts, and what happens out of scope.
 */
import { useNow } from './ui';
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
        'The internal ticket service, running at /api/verify. It holds no secrets, trusts no agent’s account of its own permissions, and re-derives every check from the chain.',
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
      term: 'Action receipts',
      detail:
        'Every decision produces a receipt naming the agent, the request, the chain it came through, and the constraint that decided it.',
    },
    {
      term: 'Outside scope',
      detail:
        'Agent C’s attempt to send data to an external webhook is refused at the destination check and logged as a refusal receipt. The action does not happen.',
    },
  ];

  return (
    <div className="panel-dark p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label text-canvas/45">How it works</div>
          <h2 className="mt-2 max-w-[18ch] text-[26px] font-medium leading-[1.15] tracking-tightest text-canvas sm:text-[30px]">
            Narrow in, narrow out.
          </h2>
        </div>
        <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-canvas/60">
          Four things hold this together: signatures that link each Passport to its parent, a subset check on every
          field, an expiry on every hop, and a receipt for every decision.
        </p>
      </div>

      <dl className="mt-7 grid gap-x-10 gap-y-5 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.term} className="border-t border-white/10 pt-3.5">
            <dt className="text-[13px] font-medium text-canvas">{item.term}</dt>
            <dd className="mt-1.5 text-[12.5px] leading-relaxed text-canvas/60">{item.detail}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-8 max-w-[70ch] border-t border-white/10 pt-5 text-[14px] leading-relaxed text-canvas/85">
        This is for an operations lead, who needs to prove to every downstream service that an agent&rsquo;s
        authority came from them and never grew — so work gets delegated safely without giving away more context than
        necessary.
      </p>
    </div>
  );
}
