'use client';

/**
 * The Agents-track checklist, said plainly and in one place: holder, agent,
 * verifier, guards, lifecycle, scope, expiry, revocation, audit log, and what
 * happens out of scope.
 */
import { Em, useNow } from './ui';
import { formatCountdown } from '@/lib/authority';
import { ACTOR_BY_ID } from '@/lib/seed';
import { TEAM_NAME, isTeamMember } from '@/lib/team';
import { useDemo } from '@/lib/store';

export function HowItWorks() {
  const now = useNow();
  const { registry, rootId } = useDemo();
  const root = registry.passports[rootId];

  const issuer = root?.claims.issuer ?? '';
  const holder = ACTOR_BY_ID[issuer];
  const holderPhrase = holder
    ? `${holder.label}, ${holder.role}${isTeamMember(issuer) ? ` on the ${TEAM_NAME}` : ''}`
    : 'the human holder';

  const items: Array<{ term: string; detail: string }> = [
    {
      term: 'Holder',
      detail: `${holderPhrase} — a person, not a role account. They hold the signing key, issue the root Passport from the team dashboard, and are the only party who can widen anything. No agent can create authority; it can only inherit a narrower slice of someone else's.`,
    },
    {
      term: 'Agents and subagents',
      detail:
        'Claude Code is the primary agent — the one the human handed the task to. It spawns a dedup subagent and a summarizer subagent; those spawn a classifier and a digest subagent in turn. Every node is badged with its tier and railed in that tier’s colour, so a subagent is never mistaken for the agent that spawned it. Each holds its own Passport and its own signing key.',
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
        'The classifier subagent’s attempt to send data to an external webhook fails guard:requested-destination and falls back to requiring human authority. The action does not happen; the refusal is written to the audit log.',
    },
  ];

  return (
    <div className="panel-soft p-7 sm:p-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="label">How it works</div>
          <h2 className="display mt-4 max-w-[20ch] text-[34px] sm:text-[44px]">
            Authority should <Em>shrink</Em> as it travels.
          </h2>
        </div>
        <p className="max-w-[46ch] text-[15px] leading-[1.45] text-muted">
          Four things hold this together: signatures that link each Passport to its parent, a guard on every field, an
          expiry on every hop, and an audit entry for every decision.
        </p>
      </div>

      <dl className="mt-9 grid gap-x-12 gap-y-6 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.term} className="border-t border-hairline pt-4">
            <dt className="text-[14.5px] font-bold tracking-tight text-ink">{item.term}</dt>
            <dd className="mt-2 text-[13px] leading-[1.5] text-muted">{item.detail}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-10 max-w-[70ch] border-t border-hairline pt-6 text-[15px] leading-relaxed text-ink">
        This is for an operations lead on a real team, who needs to prove to every downstream service that an
        agent&rsquo;s authority came from a named person and never grew — so work gets delegated safely without giving
        away more context than necessary.
      </p>
    </div>
  );
}
