'use client';

/**
 * Decoded Passport for the selected node: its claims, who signed it, what it hangs
 * off, where it sits in the trust loop, and which guards it passes right now.
 * "Trace authority to root" walks the chain and highlights the path in the graph.
 */
import { truncateHex } from '@/lib/crypto';
import { formatCountdown, formatUsd, formatWindow, lifecycleOf } from '@/lib/authority';
import { verifyChain } from '@/lib/passport';
import { ACTOR_BY_ID, TIER_LABEL, shortActorId } from '@/lib/seed';
import { isTeamMember, teamLine } from '@/lib/team';
import { useDemo } from '@/lib/store';
import { Chip, KeyValue, SectionHeading, StatusPill, StatusTrack, TierBadge, cx, useNow } from './ui';
import { useChainStatuses } from './useChainStatus';

export function PassportDrawer() {
  const now = useNow();
  const statuses = useChainStatuses();
  const { registry, selectedId, trace, tracedPath, clearTrace, select } = useDemo();
  const passport = selectedId ? registry.passports[selectedId] : undefined;

  if (!passport) {
    return (
      <div className="card p-5">
        <SectionHeading
          eyebrow="AI Passport"
          title="Nothing selected"
          hint="Pick any node in the chain to decode its AI Passport — the signed authority it inherited."
        />
      </div>
    );
  }

  const claims = passport.claims;
  const verification = statuses[claims.id] ?? verifyChain(passport, registry, now);
  const lifecycle = lifecycleOf(claims, verification);
  const actor = ACTOR_BY_ID[claims.subject];
  const parent = claims.parentId ? registry.passports[claims.parentId] : undefined;
  // Who handed this over: the agent above it, or — at the root — the person who signed it.
  const spawner = ACTOR_BY_ID[parent ? parent.claims.subject : claims.issuer];
  const path = [verification.chain[0]?.claims.issuer, ...verification.chain.map((p) => p.claims.subject)].filter(
    Boolean,
  ) as string[];
  const isTraced = tracedPath?.includes(claims.id) && tracedPath.length === verification.chain.length;

  return (
    <div className="card animate-fade p-5">
      <SectionHeading
        eyebrow="AI Passport"
        title={actor?.label ?? claims.subject}
        hint={
          actor && (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <TierBadge kind={actor.kind} />
                <span>
                  {actor.role}
                  {spawner && (
                    <>
                      {' · '}
                      {spawner.kind === 'human' ? 'authorized by' : 'spawned by'} {spawner.label}
                    </>
                  )}
                </span>
              </span>
              {/* Says what the panel is before it says what is in it: the reader is
                  looking at a credential, not a settings page. */}
              <span
                className="mt-1.5 block"
                title="AI Passport — a signed, scoped grant of authority a holder issues and can revoke."
              >
                This is {actor.label}&rsquo;s AI Passport — the signed authority it inherited.
              </span>
            </>
          )
        }
        action={<StatusPill stage={lifecycle.stage} note={lifecycle.note} />}
      />

      <div className="mt-3 border-y border-hairline py-2">
        <StatusTrack stage={lifecycle.stage} />
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted">{claims.task}</p>

      {!verification.allowed && verification.reason && (
        <p className="mt-3 rounded-md border border-deny/20 bg-canvas p-2.5 text-[12.5px] leading-relaxed text-deny">
          {verification.reason}
        </p>
      )}

      <div className="mt-4 divide-y divide-hairline border-y border-hairline">
        <KeyValue label="Passport id" mono>
          {claims.id}
        </KeyValue>
        <KeyValue label="Issued by" mono>
          {claims.issuer}
          <span className="ml-1.5 text-muted">
            ({TIER_LABEL[ACTOR_BY_ID[claims.issuer]?.kind ?? 'agent']})
          </span>
        </KeyValue>
        <KeyValue label="Granted to" mono>
          {claims.subject}
        </KeyValue>
        <KeyValue label="Parent" mono>
          {parent ? (
            <button
              type="button"
              onClick={() => select(parent.claims.id)}
              className="underline decoration-hairline underline-offset-2 hover:decoration-ink"
            >
              {parent.claims.id}
            </button>
          ) : (
            <span className="text-muted">none · this is the root AI Passport</span>
          )}
        </KeyValue>
        <KeyValue label="Actions">
          <span className="flex flex-wrap gap-1">
            {claims.actions.map((a) => (
              <Chip key={a} className="chip-mono">
                {a}
              </Chip>
            ))}
          </span>
        </KeyValue>
        <KeyValue label="Context">
          <span className="flex flex-wrap gap-1">
            {claims.contextScopes.map((s) => (
              <Chip key={s} tone="strong" className="chip-mono">
                {s}
              </Chip>
            ))}
          </span>
        </KeyValue>
        <KeyValue label="Destinations">
          <span className="flex flex-wrap gap-1">
            {claims.allowedDestinations.map((d) => (
              <Chip key={d} className="chip-mono">
                {d}
              </Chip>
            ))}
          </span>
        </KeyValue>
        <KeyValue label="Budget" mono>
          {formatUsd(claims.budgetUsd)}
        </KeyValue>
        <KeyValue label="Expiry" mono>
          {formatWindow(claims)} from issue ·{' '}
          <span className={cx(claims.expiresAt <= now && 'text-deny')}>
            {formatCountdown(claims.expiresAt, now)} left
          </span>
        </KeyValue>
        <KeyValue label="Delegation" mono>
          {claims.canDelegate ? `permitted · ${claims.maxDepth} hop(s) remaining` : 'not permitted'}
        </KeyValue>
        <KeyValue label="Stage" mono>
          <span className={cx(lifecycle.stage === 'revoked' && 'text-deny')}>{lifecycle.stage}</span>
          {lifecycle.note && <span className="ml-1.5 text-muted">· {lifecycle.note}</span>}
        </KeyValue>
        <KeyValue label="Signature" mono>
          <span className="verbatim" title={passport.signature}>
            {truncateHex(passport.signature, 16, 10)}
          </span>
          <div className="mt-1 text-[11px] text-muted">
            Ed25519 over canonical claims + parent signature
          </div>
        </KeyValue>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => (isTraced ? clearTrace() : trace(claims.id))}
        >
          {isTraced ? 'Clear trace' : 'Trace authority to root'}
        </button>
        <span className="text-[11.5px] text-muted">{verification.chain.length} hop chain</span>
      </div>

      {isTraced && (
        <div className="panel-soft mt-3 animate-fade p-3">
          <div className="label">Authority traced</div>
          <div className="mt-1.5 font-mono text-[12px] leading-relaxed text-ink">
            {path.map((id, i) => (
              <span key={`${id}-${i}`}>
                {/* The trace starts at a person on a named team, not at an abstract
                    root — that is the whole claim this breadcrumb is making. */}
                {isTeamMember(id) ? teamLine(id) : (ACTOR_BY_ID[id]?.label ?? id)}
                {i < path.length - 1 && <span className="mx-1.5 text-muted">→</span>}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            Every guard passed at every hop. Each Passport on this path is a child of the one before it, authority
            never widened, and it began with a person.
          </p>
        </div>
      )}

      {/* Per-hop guard detail: what the verifier actually re-derived. */}
      <div className="mt-4 border-t border-hairline pt-3">
        <div className="label">Guards, per hop</div>
        <div className="mt-2 space-y-1.5">
          {verification.checks.map((check) => {
            const hopOk = check.signatureValid && check.guardsOk && !check.revoked && !check.expired;
            return (
              <div
                key={check.passportId}
                className="flex items-center gap-2 font-mono text-[11px] text-muted"
              >
                <span className="w-4 text-right text-ink">{check.hop}</span>
                <span
                  className={cx('w-[76px] truncate', hopOk ? 'text-ink' : 'text-deny')}
                  title={check.subject}
                >
                  {shortActorId(check.subject)}
                </span>
                <span className={check.signatureValid ? 'text-allow' : 'text-deny'}>sig</span>
                <span className={check.guardsOk ? 'text-allow' : 'text-deny'}>narrow</span>
                <span className={!check.expired ? 'text-allow' : 'text-deny'}>expiry</span>
                <span className={!check.revoked ? 'text-allow' : 'text-deny'}>revocation</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
