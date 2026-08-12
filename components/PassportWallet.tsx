'use client';

/**
 * The AI Passport, as an object.
 *
 * Every other panel treats a Passport as a record to be checked. Here it is a
 * credential you can pick up: a data page with stamps, numbered fields, an authority
 * meter, and a machine-readable strip along the bottom. Nothing on these cards is
 * invented — every field is read off the same claims the verifier walks, and the MRZ
 * is generated from the real Ed25519 signature.
 *
 * Read left to right and the demo's whole argument is visible without a single word
 * of explanation: the stamps thin out, the meter drops, and the strip changes on every
 * card, because each one was signed by a different holder over narrower claims.
 */
import { useMemo, useState } from 'react';
import {
  authorityPercent,
  buildMrz,
  formatCountdown,
  formatUsd,
  formatWindow,
  lifecycleOf,
  shortScope,
} from '@/lib/authority';
import { Passport, PassportClaims, Registry, childrenOf } from '@/lib/passport';
import { ACTOR_BY_ID, ActorKind, TIER_LABEL } from '@/lib/seed';
import { TEAM_NAME, isTeamMember, teamLine } from '@/lib/team';
import { useDemo } from '@/lib/store';
import {
  AuthorityBar,
  Chip,
  Em,
  SectionHeading,
  StatusPill,
  TIER_STYLE,
  cx,
  useNow,
} from './ui';
import { StatusMap, useChainStatuses } from './useChainStatus';

// ── Ordering ─────────────────────────────────────────────────────────────────

/**
 * The chain flattened depth-first, so the wallet reads the way the story is told:
 * the root, then all the way down one branch, then back up for the next. That gives
 * the familiar A → B → C, then D → E ordering.
 */
function walletOrder(registry: Registry, rootId: string): Passport[] {
  const out: Passport[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    const passport = registry.passports[id];
    if (!passport || seen.has(id)) return;
    seen.add(id);
    out.push(passport);
    for (const child of childrenOf(registry, id)) walk(child.claims.id);
  };
  walk(rootId);
  // Anything minted in the sandbox that hangs off a branch we never reached.
  for (const p of Object.values(registry.passports)) if (!seen.has(p.claims.id)) out.push(p);
  return out;
}

/** A → B → C …, assigned in wallet order. The letters the README already uses. */
function agentLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** "Classifier subagent" → "Classifier". The tier is already badged beside it. */
function shortLabel(subject: string): string {
  const actor = ACTOR_BY_ID[subject];
  if (!actor) return subject;
  return actor.label.replace(/\s+subagent$/i, '');
}

// ── What each hop surrendered ────────────────────────────────────────────────

/**
 * Everything the parent held that this Passport does not. Read off the two claim sets
 * rather than stored, so it stays true for sandbox-minted cards too.
 */
function surrendered(claims: PassportClaims, parent: PassportClaims | undefined): string[] {
  if (!parent) return [];
  const lost: string[] = [];
  for (const action of parent.actions) if (!claims.actions.includes(action)) lost.push(action);
  for (const scope of parent.contextScopes) {
    // A scope narrowed into a sub-scope was not given up; a scope with no descendant
    // on this card was.
    const kept = claims.contextScopes.some((s) => s === scope || s.startsWith(`${scope}.`));
    if (!kept) lost.push(shortScope(scope));
  }
  for (const destination of parent.allowedDestinations) {
    if (!claims.allowedDestinations.includes(destination)) lost.push(destination);
  }
  return lost;
}

// ── Card parts ───────────────────────────────────────────────────────────────

/**
 * The emblem on the top strip. A shield with a downward chevron: authority, pointing
 * one way only. Drawn here rather than imported so it inherits `currentColor` and
 * works on both the inverted strip and the light back face.
 */
function Emblem({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cx('h-[15px] w-[15px]', className)} fill="none">
      <path
        d="M12 2.4 4.6 5.3v6.2c0 4.6 3 8.3 7.4 10.1 4.4-1.8 7.4-5.5 7.4-10.1V5.3L12 2.4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8.4 10.6 12 14.2l3.6-3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A permission, rendered as a stamp in the passport rather than a row in a table.
 *
 * Three kinds have to be told apart at a glance without adding colour: an action is a
 * plain stamp, a context scope is dashed (it is data, not a verb), and a destination
 * carries an arrow, because it is the only one that says where something may go.
 */
function Stamp({
  children,
  kind,
  ok,
}: {
  children: React.ReactNode;
  kind: 'action' | 'scope' | 'destination';
  ok: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-[3px] font-mono text-[10px] leading-none tracking-tight',
        kind === 'scope' ? 'border-dashed' : 'border-solid',
        ok ? 'border-ink/30 text-ink' : 'border-deny/30 text-deny',
      )}
    >
      {kind === 'destination' && <span aria-hidden className="text-muted">→</span>}
      {children}
    </span>
  );
}

/** One numbered field of the data page. */
function DataField({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cx('min-w-0', wide && 'col-span-2')}>
      <div className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-[3px] truncate font-mono text-[11px] leading-tight text-ink">{children}</div>
    </div>
  );
}

/** The strike across a credential that is no longer good. */
function Overprint({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <span className="stamp border-deny/60 text-deny/80">{text}</span>
    </div>
  );
}

// ── The card ─────────────────────────────────────────────────────────────────

interface CardProps {
  passport: Passport;
  parent: PassportClaims | undefined;
  root: PassportClaims;
  index: number;
  statuses: StatusMap;
}

function PassportCard({ passport, parent, root, index, statuses }: CardProps) {
  const now = useNow();
  const [flipped, setFlipped] = useState(false);
  const { selectedId, select, receipts, registry } = useDemo();

  const claims = passport.claims;
  const status = statuses[claims.id];
  const ok = status?.allowed ?? false;
  const lifecycle = status ? lifecycleOf(claims, status) : ({ stage: 'draft', note: 'not yet verified' } as const);
  const selected = selectedId === claims.id;

  const actor = ACTOR_BY_ID[claims.subject];
  const kind: ActorKind = actor?.kind ?? 'subagent';
  const tier = TIER_STYLE[kind];
  const isRoot = claims.parentId === null;
  const issuerIsHuman = isTeamMember(claims.issuer);

  const mrz = useMemo(() => buildMrz(claims, passport.signature, kind), [claims, passport.signature, kind]);
  const lost = surrendered(claims, parent);
  const percent = ok ? authorityPercent(claims, root) : 0;

  // A refusal recorded against this credential. Delegation refusals are logged
  // against the Passport that attempted the mint, which is exactly this one.
  const denied = receipts.some((r) => r.kind === 'refusal' && r.leafPassportId === claims.id);
  const overprint = lifecycle.stage === 'revoked' ? 'revoked' : denied ? 'denied' : null;

  // root → this card, as identities. The human is hop zero.
  const trace: string[] = [];
  {
    let cursor: Passport | undefined = passport;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.claims.id)) {
      guard.add(cursor.claims.id);
      trace.unshift(cursor.claims.subject);
      const parentId: string | null = cursor.claims.parentId;
      if (!parentId) {
        trace.unshift(cursor.claims.issuer);
        break;
      }
      cursor = registry.passports[parentId];
    }
  }

  const checks = status?.checks ?? [];
  const selfCheck = checks.find((c) => c.passportId === claims.id);
  const guards: Array<{ key: string; ok: boolean }> = [
    { key: 'sig', ok: selfCheck?.signatureValid ?? false },
    { key: 'narrow', ok: selfCheck?.guardsOk ?? false },
    { key: 'expiry', ok: !(selfCheck?.expired ?? true) },
    { key: 'revocation', ok: !(selfCheck?.revoked ?? true) },
  ];

  const faceBase =
    'relative flex h-full w-full flex-col overflow-hidden rounded-card border bg-canvas text-left';

  return (
    <div className="flip-scene h-[476px] w-full">
      <button
        type="button"
        aria-pressed={flipped}
        aria-label={`${shortLabel(claims.subject)} AI Passport — tap to flip`}
        onClick={() => {
          setFlipped((f) => !f);
          select(claims.id); // cross-highlights this node on the Agent Chain tab
        }}
        className={cx(
          'flip-inner group cursor-pointer rounded-card outline-none',
          flipped && 'is-flipped',
        )}
      >
        {/* ── Front: the data page ──────────────────────────────────────── */}
        <div
          className={cx(
            faceBase,
            'flip-face transition-colors duration-300 ease-calm',
            selected ? 'border-ink' : 'border-hairline group-hover:border-ink/30',
            !ok && 'border-deny/35',
          )}
        >
          {/* Tier rail, the same one the graph nodes carry. */}
          <span aria-hidden className={cx('absolute inset-y-0 left-0 z-10 w-[3px]', ok ? tier.rail : 'bg-deny/40')} />

          {/* Top strip */}
          <div className="flex items-center justify-between gap-2 bg-ink px-3.5 py-2 text-canvas">
            <span
              className="flex items-center gap-2"
              title={
                isRoot
                  ? 'AI Passport — a signed, scoped grant of authority a holder issues and can revoke.'
                  : "Child AI Passport — a delegated Passport that can only narrow its parent's authority."
              }
            >
              <Emblem />
              <span className="text-[11px] font-medium uppercase tracking-[0.2em]">AI Passport</span>
            </span>
            <span className="shrink-0 rounded-full border border-white/25 px-2 py-[2px] text-[9px] font-medium uppercase tracking-[0.1em] text-canvas/80">
              {isRoot ? 'root' : TIER_LABEL[kind]}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-2.5 pt-3">
            {/* Holder */}
            <div className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-muted">Granted to</div>
            <div
              className={cx(
                'mt-[3px] text-[15px] font-medium leading-tight tracking-tightest',
                !ok && 'text-deny line-through decoration-deny/50',
              )}
            >
              Agent {agentLetter(index)} — {shortLabel(claims.subject)}
            </div>
            <div className="mt-1.5 text-[9.5px] font-medium uppercase tracking-[0.12em] text-muted">Issued by</div>
            <div className="mt-[2px] font-mono text-[11px] leading-tight">
              {issuerIsHuman ? (
                <>
                  {teamLine(claims.issuer).replace(`${TEAM_NAME} · `, '')} · {TEAM_NAME}{' '}
                  <span className="text-muted">(human)</span>
                </>
              ) : (
                claims.issuer
              )}
            </div>

            {/* Stamps */}
            <div className="mt-3 border-t border-hairline pt-2.5">
              <div className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-muted">
                Stamps · {claims.actions.length + claims.contextScopes.length + claims.allowedDestinations.length}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {claims.actions.map((a) => (
                  <Stamp key={`a-${a}`} kind="action" ok={ok}>
                    {a}
                  </Stamp>
                ))}
                {claims.contextScopes.map((s) => (
                  <Stamp key={`s-${s}`} kind="scope" ok={ok}>
                    {shortScope(s)}
                  </Stamp>
                ))}
                {claims.allowedDestinations.map((d) => (
                  <Stamp key={`d-${d}`} kind="destination" ok={ok}>
                    {d}
                  </Stamp>
                ))}
              </div>
              {/* What this hop handed back on the way down. */}
              <div className="mt-1.5 truncate font-mono text-[9.5px] leading-tight text-muted" title={lost.join(', ')}>
                {lost.length ? `gave up: ${lost.join(', ')}` : isRoot ? 'issued whole by a human' : 'gave up: nothing'}
              </div>
            </div>

            {/* Numbered fields, laid out like a data page */}
            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-hairline pt-2.5">
              <DataField label="Passport no." wide>
                {claims.id}
              </DataField>
              <DataField label="Budget">{formatUsd(claims.budgetUsd)}</DataField>
              <DataField label="Expiry">
                <span className={cx(claims.expiresAt <= now && 'text-deny')}>
                  {formatCountdown(claims.expiresAt, now)}
                </span>
                <span className="text-muted"> · {formatWindow(claims)}</span>
              </DataField>
              <DataField label="Delegation">
                {claims.canDelegate ? `Yes · ${claims.maxDepth} hop(s)` : 'No'}
              </DataField>
              <DataField label="Status">
                <span className={cx(lifecycle.stage === 'revoked' && 'text-deny', lifecycle.stage === 'active' && 'text-allow')}>
                  {lifecycle.stage}
                </span>
              </DataField>
            </div>

            {/* Authority meter */}
            <div className="mt-auto pt-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-muted">
                  Authority held of root
                </span>
                <span className="text-[9.5px] text-muted">tap to flip</span>
              </div>
              <div className="mt-1.5">
                <AuthorityBar percent={percent} broken={!ok} />
              </div>
            </div>
          </div>

          {/* MRZ: the signature, made readable */}
          <div className="border-t border-hairline bg-surface px-3 py-1.5">
            <div className="verbatim overflow-hidden font-mono text-[8.5px] leading-[1.5] tracking-[0.06em] text-ink/85">
              <div className="truncate">{mrz.line1}</div>
              <div className="truncate">{mrz.line2}</div>
            </div>
          </div>
        </div>

        {/* ── Back: how it is checked ───────────────────────────────────── */}
        <div
          className={cx(
            faceBase,
            'flip-face flip-face-back',
            selected ? 'border-ink' : 'border-hairline',
            !ok && 'border-deny/35',
          )}
        >
          {overprint && <Overprint text={overprint} />}

          <div className="flex items-center justify-between gap-2 border-b border-hairline px-3.5 py-2">
            <span className="flex items-center gap-2 text-ink">
              <Emblem />
              <span className="text-[11px] font-medium uppercase tracking-[0.2em]">Verification</span>
            </span>
            <span className="font-mono text-[9.5px] text-muted">{claims.id}</span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-3 pt-3">
            <div className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-muted">Guards, this hop</div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {guards.map((guard) => (
                <span
                  key={guard.key}
                  className={cx(
                    'flex items-center gap-1.5 rounded-md border px-2 py-1.5 font-mono text-[10.5px]',
                    guard.ok ? 'border-allow/25 text-allow' : 'border-deny/25 text-deny',
                  )}
                >
                  <span className={cx('h-[5px] w-[5px] shrink-0 rounded-full', guard.ok ? 'bg-allow' : 'bg-deny')} />
                  {guard.key}
                </span>
              ))}
            </div>

            <div className="mt-3.5 border-t border-hairline pt-2.5">
              <div className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-muted">Chain of custody</div>
              <div className="mt-1.5 font-mono text-[10.5px] leading-relaxed">
                {trace.map((id, i) => (
                  <span key={`${id}-${i}`}>
                    <span
                      className={cx(
                        i === trace.length - 1 ? 'text-ink' : 'text-muted',
                        i === 0 && 'text-ink',
                      )}
                    >
                      {isTeamMember(id) ? teamLine(id) : shortLabel(id)}
                    </span>
                    {i < trace.length - 1 && <span className="mx-1 text-muted/70">→</span>}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3.5 border-t border-hairline pt-2.5">
              <div className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-muted">Signature</div>
              <div className="verbatim mt-1 break-all font-mono text-[9.5px] leading-[1.55] text-muted">
                {passport.signature.slice(0, 64)}…
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
                Ed25519 over these claims plus the parent&rsquo;s signature. Change one field and the strip on the
                front no longer checks out.
              </p>
            </div>

            <div className="mt-auto pt-2.5">
              <StatusPill stage={lifecycle.stage} note={lifecycle.note} />
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

// ── The wallet ───────────────────────────────────────────────────────────────

export function PassportWallet() {
  const { registry, rootId, setTab } = useDemo();
  const statuses = useChainStatuses();
  const root = registry.passports[rootId];

  const cards = useMemo(() => walletOrder(registry, rootId), [registry, rootId]);

  if (!root) return null;

  const rootClaims = root.claims;
  const percents = cards.map((p) => (statuses[p.claims.id]?.allowed ? authorityPercent(p.claims, rootClaims) : 0));
  const holder = rootClaims.issuer;

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-7">
        <SectionHeading
          eyebrow="AI Passport"
          title={
            <>
              {cards.length} AI Passports, each <Em>narrower</Em> than the last.
            </>
          }
          hint="Every AI Passport in the chain, shown as the credential it is — one card per Passport, in the order authority travelled. Every field is read off the signed claims: the stamps are the permissions it holds, the meter is how much of the human's root Passport is left, and the strip along the bottom is its Ed25519 signature written the way a passport writes one. Tap any card to turn it over."
          action={
            <Chip tone="dim" className="chip-mono">
              {percents[0] ?? 0}% → {percents[percents.length - 1] ?? 0}%
            </Chip>
          }
        />

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-4 font-mono text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[10px] w-[10px] rounded-[3px] border border-solid border-ink/30" />
            action
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[10px] w-[10px] rounded-[3px] border border-dashed border-ink/30" />
            context scope
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-[10px] w-[10px] items-center justify-center rounded-[3px] border border-solid border-ink/30 text-[7px] leading-none">
              →
            </span>
            destination
          </span>
          <span className="ml-auto">
            issued by {isTeamMember(holder) ? teamLine(holder) : holder}
          </span>
        </div>
      </section>

      {/* The wallet itself. Cards keep a fixed height so a flip never reflows the grid. */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((passport, index) => (
          <div key={passport.claims.id} className="animate-fade" style={{ animationDelay: `${index * 60}ms` }}>
            <PassportCard
              passport={passport}
              parent={passport.claims.parentId ? registry.passports[passport.claims.parentId]?.claims : undefined}
              root={rootClaims}
              index={index}
              statuses={statuses}
            />
          </div>
        ))}
      </div>

      {/* The note used to describe a jump with no way to take it. The card selection
          already crosses tabs; this is the door. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className="btn-secondary" onClick={() => setTab('chain')}>
          See it on the Agent Chain →
        </button>
        <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
          Selecting a card also selects that AI Passport on the Agent Chain tab, so the node and its decoded claims
          are already waiting there.
        </p>
      </div>
    </div>
  );
}
