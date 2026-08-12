'use client';

/**
 * Let the judge try to cheat.
 *
 * A draft Passport that asks for more authority than its parent holds never leaves
 * `draft`: `delegate()` refuses to mint it, naming the guard it failed. Narrowing is
 * not a rule agents are trusted to follow; the Passport simply cannot be created,
 * and had it been forged, the verifier would re-derive the same guards and reject it.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatCountdown } from '@/lib/authority';
import {
  ALL_ACTIONS,
  ALL_DESTINATIONS,
  Action,
  Destination,
  DelegationRequest,
} from '@/lib/passport';
import { ACTOR_BY_ID, HOUR } from '@/lib/seed';
import { useDemo } from '@/lib/store';
import { Chip, Em, SectionHeading, StatusPill, cx, useNow } from './ui';

interface Preset {
  key: string;
  title: string;
  hint: string;
  apply: (draft: Draft, parentActions: Action[]) => Draft;
}

interface Draft {
  subject: string;
  actions: Action[];
  destinations: Destination[];
  budgetUsd: number;
  hours: number;
  canDelegate: boolean;
}

const PRESETS: Preset[] = [
  {
    key: 'external',
    title: 'Ask for external transfer',
    hint: 'adds external-webhook · trips guard:destinations',
    apply: (d) => ({ ...d, destinations: ['internal-only', 'external-webhook'] }),
  },
  {
    key: 'budget',
    title: 'Ask for a bigger budget',
    hint: 'raises to $500 · trips guard:budget',
    apply: (d) => ({ ...d, budgetUsd: 500 }),
  },
  {
    key: 'expiry',
    title: 'Ask to outlive the parent',
    hint: 'stretches to 48h · trips guard:expiry',
    apply: (d) => ({ ...d, hours: 48 }),
  },
  {
    key: 'send',
    title: 'Ask for the send action',
    hint: 'no one on this chain holds it · trips guard:actions',
    apply: (d) => ({ ...d, actions: Array.from(new Set([...d.actions, 'send' as Action])) }),
  },
];

export function DelegationSandbox() {
  const now = useNow();
  const { registry, passportBySubject, mintFromSandbox, sandbox, clearSandbox, select } = useDemo();

  const delegable = useMemo(
    () => Object.values(registry.passports).sort((a, b) => a.claims.issuedAt - b.claims.issuedAt),
    [registry.passports],
  );

  const [parentId, setParentId] = useState<string>(passportBySubject['dedup-subagent'] ?? delegable[0]?.claims.id ?? '');
  // Reset and openLaunch swap in a whole new chain with new ids, so the id parked in
  // state can name a Passport that no longer exists. Everything below reads the id off
  // the resolved parent rather than the state, or the mint would be addressed to a
  // Passport the store cannot find and would fail silently.
  const parent = registry.passports[parentId] ?? delegable[0];
  const activeParentId = parent?.claims.id ?? '';

  const [draft, setDraft] = useState<Draft>({
    subject: 'new-subagent',
    actions: [],
    destinations: [],
    budgetUsd: 0,
    hours: 1,
    canDelegate: false,
  });

  // Start each parent off with a request that sits comfortably inside its authority,
  // so anything the judge changes is the only reason a mint gets refused.
  useEffect(() => {
    if (!parent) return;
    const remainingHours = Math.max(0, (parent.claims.expiresAt - Date.now()) / HOUR);
    setDraft({
      subject: 'new-subagent',
      actions: parent.claims.actions.filter((a) => a !== 'delegate'),
      destinations: [...parent.claims.allowedDestinations],
      budgetUsd: Math.max(1, Math.floor(parent.claims.budgetUsd / 4)),
      hours: Math.max(1, Math.floor(remainingHours / 2)),
      canDelegate: false,
    });
    clearSandbox();
  }, [activeParentId, parent, clearSandbox]);

  if (!parent) return null;

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const request: DelegationRequest = {
    subject: draft.subject.trim() || 'new-subagent',
    task: 'Sandbox delegation requested by the judge',
    actions: draft.actions,
    contextScopes: [...parent.claims.contextScopes],
    allowedDestinations: draft.destinations,
    budgetUsd: draft.budgetUsd,
    expiresAt: Date.now() + draft.hours * HOUR,
    canDelegate: draft.canDelegate,
    maxDepth: draft.canDelegate ? Math.max(0, parent.claims.maxDepth - 1) : 0,
  };

  const parentLabel = ACTOR_BY_ID[parent.claims.subject]?.label ?? parent.claims.subject;

  return (
    <div className="card p-5">
      <SectionHeading
        eyebrow="Delegation sandbox"
        title={
          <>
            Try to issue a child with <Em>more</Em> authority.
          </>
        }
        hint="Try to issue a child AI Passport with more authority than its parent — the guards won't sign it. Nothing here is enforced by convention: every guard runs at issue time, so a Passport broader than its parent cannot be signed into existence. It stays a draft."
        action={<StatusPill stage="draft" note="unsigned request" />}
      />

      {/* Who is delegating */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label">Issuing agent&rsquo;s AI Passport</span>
          <select
            value={activeParentId}
            onChange={(event) => setParentId(event.target.value)}
            className="rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-[13px]"
          >
            {delegable.map((p) => (
              <option key={p.claims.id} value={p.claims.id}>
                {ACTOR_BY_ID[p.claims.subject]?.label ?? p.claims.subject}
                {p.claims.canDelegate ? '' : ' (cannot delegate)'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">New subagent</span>
          <input
            value={draft.subject}
            onChange={(event) => setDraft((d) => ({ ...d, subject: event.target.value }))}
            className="w-[150px] rounded-md border border-hairline bg-canvas px-2.5 py-1.5 font-mono text-[13px]"
          />
        </label>
        <div className="ml-auto text-right font-mono text-[11px] leading-relaxed text-muted">
          <div>
            parent holds ${parent.claims.budgetUsd} · {formatCountdown(parent.claims.expiresAt, now)} left
          </div>
          <div>
            {parent.claims.canDelegate ? `↳ ${parent.claims.maxDepth} hop(s) available` : '⊣ delegation not permitted'}
          </div>
        </div>
      </div>

      {/* Presets — the fast path */}
      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => setDraft((d) => preset.apply(d, parent.claims.actions))}
            className="rounded-full border border-deny/25 bg-canvas px-3 py-1.5 text-[12px] text-deny transition-all duration-200 ease-calm hover:bg-canvas"
            title={preset.hint}
          >
            {preset.title}
          </button>
        ))}
      </div>

      {/* Manual request */}
      <div className="mt-4 space-y-3 rounded-card border border-hairline bg-surface p-3.5">
        <div>
          <div className="label">Actions requested</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ALL_ACTIONS.map((action) => {
              const on = draft.actions.includes(action);
              const parentHas = parent.claims.actions.includes(action);
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, actions: toggle(d.actions, action) }))}
                  className={cx(
                    'rounded-full border px-2.5 py-1 text-[11.5px] transition-all duration-200',
                    on
                      ? parentHas
                        ? 'border-ink bg-ink text-canvas'
                        : 'border-deny bg-deny text-white'
                      : 'border-hairline bg-canvas text-muted hover:border-ink/30',
                  )}
                >
                  {action}
                  {!parentHas && <span className="ml-1 opacity-70">not held</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="label">Destinations requested</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ALL_DESTINATIONS.map((destination) => {
              const on = draft.destinations.includes(destination);
              const parentHas = parent.claims.allowedDestinations.includes(destination);
              return (
                <button
                  key={destination}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, destinations: toggle(d.destinations, destination) }))}
                  className={cx(
                    'rounded-full border px-2.5 py-1 text-[11.5px] transition-all duration-200',
                    on
                      ? parentHas
                        ? 'border-ink bg-ink text-canvas'
                        : 'border-deny bg-deny text-white'
                      : 'border-hairline bg-canvas text-muted hover:border-ink/30',
                  )}
                >
                  {destination}
                  {!parentHas && <span className="ml-1 opacity-70">not held</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="label">Budget (usd)</span>
            <input
              type="number"
              min={0}
              value={draft.budgetUsd}
              onChange={(event) => setDraft((d) => ({ ...d, budgetUsd: Number(event.target.value) }))}
              className={cx(
                'w-[92px] rounded-md border bg-canvas px-2.5 py-1.5 font-mono text-[13px]',
                draft.budgetUsd > parent.claims.budgetUsd ? 'border-deny text-deny' : 'border-hairline',
              )}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Expires in (hours)</span>
            <input
              type="number"
              min={0}
              value={draft.hours}
              onChange={(event) => setDraft((d) => ({ ...d, hours: Number(event.target.value) }))}
              className={cx(
                'w-[92px] rounded-md border bg-canvas px-2.5 py-1.5 font-mono text-[13px]',
                Date.now() + draft.hours * HOUR > parent.claims.expiresAt ? 'border-deny text-deny' : 'border-hairline',
              )}
            />
          </label>
          <label className="flex items-center gap-2 pb-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={draft.canDelegate}
              onChange={(event) => setDraft((d) => ({ ...d, canDelegate: event.target.checked }))}
              className="h-3.5 w-3.5 accent-[#0A0A0A]"
            />
            may delegate further
          </label>
          <button
            type="button"
            className="btn-primary ml-auto"
            title="Child AI Passport — a delegated Passport that can only narrow its parent's authority."
            onClick={() => mintFromSandbox(activeParentId, request)}
          >
            Issue child AI Passport
          </button>
        </div>
      </div>

      {/* Outcome */}
      {sandbox && (
        <div
          className={cx(
            'mt-4 animate-receipt rounded-card border p-4',
            sandbox.ok ? 'border-allow/25 bg-canvas' : 'border-deny/25 bg-canvas',
          )}
        >
          {sandbox.ok ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 whitespace-nowrap rounded-full bg-allow px-2.5 py-[3px] font-mono text-2xs font-medium uppercase tracking-[0.14em] text-white">
                  draft → active
                </span>
                <span className="text-[13px]">
                  {parentLabel} issued a child AI Passport to{' '}
                  <span className="font-mono">{sandbox.requestedSubject}</span>
                </span>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-ink/90">
                Every guard passed against {parentLabel}&rsquo;s own AI Passport, so the child was signed and added to
                the chain. It is active, and appears in the graph above.
              </p>
              {sandbox.mintedId && (
                <button
                  type="button"
                  className="btn-secondary mt-3"
                  onClick={() => {
                    select(sandbox.mintedId!);
                    // The drawer sits at the top of this tab, well above the sandbox.
                    // Selecting without scrolling looks like the button did nothing.
                    document.getElementById('passport-drawer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  Decode it in the AI Passport panel ↑
                </button>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 whitespace-nowrap rounded-full bg-deny px-2.5 py-[3px] font-mono text-2xs font-medium uppercase tracking-[0.14em] text-white">
                  stays draft
                </span>
                <span className="text-[13px]">
                  No child AI Passport was created for{' '}
                  <span className="font-mono">{sandbox.requestedSubject}</span>
                </span>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-ink/90">
                {parentLabel}&rsquo;s AI Passport cannot grant what it does not hold. The request failed{' '}
                {sandbox.violations.length} guard{sandbox.violations.length === 1 ? '' : 's'} and fell back to
                requiring human authority. The attempt was written to the audit log.
              </p>
              <div className="mt-3 space-y-2">
                {sandbox.violations.map((violation, i) => (
                  <div key={`${violation.field}-${i}`} className="rounded-md border border-deny/15 bg-canvas p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone="deny" className="chip-mono">
                        {violation.guard}
                      </Chip>
                      <span className="font-mono text-[11.5px] text-deny">
                        requested {Array.isArray(violation.requested) ? violation.requested.join(', ') : String(violation.requested)}
                      </span>
                      <span className="text-[11px] text-muted">vs</span>
                      <span className="font-mono text-[11.5px]">
                        parent holds{' '}
                        {Array.isArray(violation.allowedByParent)
                          ? violation.allowedByParent.join(', ')
                          : String(violation.allowedByParent)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{violation.message}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
