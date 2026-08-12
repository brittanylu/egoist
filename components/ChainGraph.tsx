'use client';

/**
 * The chain, drawn as a tree. Each node shows the authority its Passport carries,
 * rendered against the ROOT grant so that authority visibly drops away: chips the
 * node no longer holds stay in place, dimmed and struck through, instead of
 * disappearing. The judge sees what was given up at every hop, not just what is left.
 */
import { useEffect, useRef } from 'react';
import { authorityPercent, formatCountdown, formatUsd, formatWindow, shortScope } from '@/lib/authority';
import { ALL_DESTINATIONS, Action, Passport, PassportClaims, Registry, childrenOf } from '@/lib/passport';
import { ACTOR_BY_ID, EDGE_LABELS } from '@/lib/seed';
import { useDemo } from '@/lib/store';
import { AuthorityBar, Chip, Dot, cx, useNow } from './ui';
import { StatusMap, useChainStatuses } from './useChainStatus';

function scopeChips(claims: PassportClaims, root: PassportClaims) {
  return root.contextScopes.map((rootScope) => {
    const own = claims.contextScopes.find((s) => s === rootScope || s.startsWith(`${rootScope}.`));
    return { label: shortScope(own ?? rootScope), held: Boolean(own), narrowed: Boolean(own && own !== rootScope) };
  });
}

function NodeCard({
  passport,
  root,
  statuses,
}: {
  passport: Passport;
  root: PassportClaims;
  statuses: StatusMap;
}) {
  const now = useNow();
  const { selectedId, select, tracedPath, lastRevoked } = useDemo();
  const claims = passport.claims;
  const actor = ACTOR_BY_ID[claims.subject];
  const status = statuses[claims.id];
  const ok = status?.allowed ?? false;
  const selected = selectedId === claims.id;
  const traced = tracedPath?.includes(claims.id) ?? false;
  const justRevoked = lastRevoked.includes(claims.id);

  // Why it is broken, said briefly.
  const brokenLabel = (() => {
    if (ok) return null;
    const kind = status?.brokenAt?.kind;
    if (kind === 'revoked') return claims.revoked ? 'revoked' : 'ancestor revoked';
    if (kind === 'expired') return status?.brokenAt?.passportId === claims.id ? 'expired' : 'ancestor expired';
    if (kind === 'narrowing') return 'exceeds parent';
    if (kind === 'signature') return 'signature invalid';
    return 'chain broken';
  })();

  return (
    <button
      type="button"
      onClick={() => select(claims.id)}
      className={cx(
        'group w-[248px] shrink-0 rounded-card border bg-white p-3.5 text-left transition-all duration-300 ease-calm',
        'hover:border-ink/25',
        selected ? 'border-ink shadow-[0_0_0_3px_rgba(20,22,26,0.06)]' : 'border-hairline',
        traced && !selected && 'border-accent-ink/40 shadow-[0_0_0_3px_rgba(75,63,143,0.08)]',
        !ok && 'border-deny/35 bg-deny/[0.02]',
        justRevoked && !ok && 'animate-fade-in',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className={cx(
              'text-[14px] font-medium leading-tight tracking-tightest',
              !ok && 'text-deny line-through decoration-deny/50',
            )}
          >
            {actor?.label ?? claims.subject}
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted">{actor?.role ?? claims.task}</div>
        </div>
        <span className="mt-0.5 shrink-0" title={ok ? 'chain verified to the human root' : (status?.reason ?? '')}>
          <Dot tone={ok ? 'allow' : 'deny'} />
        </span>
      </div>

      <div className="mt-3">
        <AuthorityBar percent={ok ? authorityPercent(claims, root) : 0} broken={!ok} />
      </div>

      {brokenLabel && (
        <div className="mt-2.5 rounded-md bg-deny/[0.06] px-2 py-1 text-2xs font-medium text-deny">
          {brokenLabel}
        </div>
      )}

      {/* Actions: the root's full set, with everything this node gave up struck through. */}
      <div className="mt-3 flex flex-wrap gap-1">
        {(root.actions as Action[]).map((action) => (
          <Chip key={action} tone={claims.actions.includes(action) ? 'default' : 'lost'}>
            {action}
          </Chip>
        ))}
      </div>

      {/* Context scopes, narrowing into sub-scopes where it happens. */}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {scopeChips(claims, root).map((scope, i) => (
          <Chip
            key={`${scope.label}-${i}`}
            tone={scope.held ? (scope.narrowed ? 'accent' : 'default') : 'lost'}
            title={scope.narrowed ? 'narrowed into a sub-scope of the parent' : undefined}
          >
            {scope.label}
          </Chip>
        ))}
      </div>

      {/* Destinations: all three that exist, so "external was never granted" is visible. */}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {ALL_DESTINATIONS.map((destination) => (
          <Chip key={destination} tone={claims.allowedDestinations.includes(destination) ? 'default' : 'lost'}>
            {destination}
          </Chip>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-2.5 font-mono text-[10.5px] text-muted">
        <span className="text-ink">{formatUsd(claims.budgetUsd)}</span>
        <span className="text-hairline">·</span>
        <span>{formatWindow(claims)}</span>
        <span className="text-hairline">·</span>
        <span className={cx(claims.expiresAt <= now && 'text-deny')} title="time left on this Passport">
          {formatCountdown(claims.expiresAt, now)}
        </span>
        <span className="ml-auto" title="delegation hops still available beneath this Passport">
          {claims.canDelegate ? `↳${claims.maxDepth}` : '⊣'}
        </span>
      </div>
    </button>
  );
}

function TreeNode({
  passport,
  root,
  registry,
  statuses,
  depth,
}: {
  passport: Passport;
  root: PassportClaims;
  registry: Registry;
  statuses: StatusMap;
  depth: number;
}) {
  const children = childrenOf(registry, passport.claims.id);

  return (
    <div className="flex flex-col items-center">
      <div className="animate-fade-up" style={{ animationDelay: `${depth * 70}ms` }}>
        <NodeCard passport={passport} root={root} statuses={statuses} />
      </div>

      {children.length > 0 && (
        <>
          <span className="h-7 w-px bg-hairline" />
          <div className="flex items-start">
            {children.map((child, i) => {
              const childOk = statuses[child.claims.id]?.allowed ?? false;
              const lineColor = childOk ? 'bg-hairline' : 'bg-deny/40';
              return (
                <div key={child.claims.id} className="relative flex flex-col items-center px-3 pt-12">
                  {/* Horizontal rail across siblings: half-width at each end. */}
                  {children.length > 1 && (
                    <span
                      className={cx('absolute top-0 h-px', lineColor)}
                      style={{
                        left: i === 0 ? '50%' : 0,
                        right: i === children.length - 1 ? '50%' : 0,
                      }}
                    />
                  )}
                  {/* Drop into the child card. */}
                  <span className={cx('absolute left-1/2 top-0 h-12 w-px -translate-x-1/2', lineColor)} />
                  {/* What was handed down on this edge. */}
                  <span className="absolute left-1/2 top-[18px] z-10 -translate-x-1/2 whitespace-nowrap bg-canvas px-2 text-[10.5px] text-muted">
                    {EDGE_LABELS[child.claims.subject] ?? `${child.claims.contextScopes.length} scope(s)`}
                  </span>

                  <TreeNode
                    passport={child}
                    root={root}
                    registry={registry}
                    statuses={statuses}
                    depth={depth + 1}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** The human holder. Not a Passport — the place all of this authority comes from. */
function HolderCard({ root }: { root: PassportClaims }) {
  const actor = ACTOR_BY_ID[root.issuer];
  return (
    <div className="w-[248px] shrink-0 animate-fade-up rounded-card bg-ink-panel p-3.5 text-canvas">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-medium leading-tight tracking-tightest">{actor?.label ?? root.issuer}</div>
          <div className="mt-0.5 text-[11.5px] text-canvas/55">{actor?.role ?? 'Human holder'}</div>
        </div>
        <span className="rounded-full bg-accent px-2 py-[3px] text-2xs font-medium text-accent-ink">holder</span>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-canvas/70">
        Issues the root Passport. Everything below inherits from here, and nothing below can exceed it.
      </p>
      <div className="mt-3 flex flex-wrap gap-1 border-t border-white/10 pt-2.5">
        <Chip tone="dark">signing key held by human</Chip>
      </div>
    </div>
  );
}

export function ChainGraph() {
  const { registry, rootId } = useDemo();
  const statuses = useChainStatuses();
  const scroller = useRef<HTMLDivElement>(null);
  const root = registry.passports[rootId];

  // On narrow screens the tree is wider than its container; start centred on the
  // root rather than pinned to the left edge, so the human is what you see first.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  }, []);

  if (!root) return null;

  return (
    <div ref={scroller} className="scroll-thin overflow-x-auto pb-2">
      <div className="flex min-w-max flex-col items-center px-2 pt-1">
        <HolderCard root={root.claims} />
        <span className="h-7 w-px bg-hairline" />
        <div className="relative flex flex-col items-center pt-12">
          <span className="absolute left-1/2 top-0 h-12 w-px -translate-x-1/2 bg-hairline" />
          <span className="absolute left-1/2 top-[18px] z-10 -translate-x-1/2 whitespace-nowrap bg-canvas px-2 text-[10.5px] text-muted">
            {EDGE_LABELS[root.claims.subject]}
          </span>
          <TreeNode passport={root} root={root.claims} registry={registry} statuses={statuses} depth={0} />
        </div>
      </div>
    </div>
  );
}
