'use client';

/**
 * Where authority comes from.
 *
 * A named person on a named team fills in a plain-language form and signs a root
 * Passport. No crypto vocabulary appears anywhere in this view — an operations lead
 * does not think in `allowedDestinations`, they think "can it send things outside?".
 * The translation into claims happens in `lib/seed.ts`, once, and everything the
 * agents inherit is derived from what was ticked here.
 */
import { useState } from 'react';
import { formatTime } from '@/lib/authority';
import {
  DEFAULT_TEMPLATE,
  TASK_TEMPLATES,
  TEMPLATE_BY_ID,
  TaskTemplate,
} from '@/lib/seed';
import { Launch, useDemo } from '@/lib/store';
import {
  AuthorityForm,
  CAPABILITIES,
  Capability,
  DATA_SCOPES,
  DEFAULT_HOLDER_ID,
  DataScope,
  EXPIRY_CHOICES,
  ExpiryHours,
  MAX_HOPS,
  MEMBER_BY_ID,
  MIN_HOPS,
  TEAM_MEMBERS,
  TEAM_NAME,
  TeamMember,
  holderLine,
} from '@/lib/team';
import { Chip, Em, SectionHeading, cx, useNow } from './ui';

// ── Small parts ──────────────────────────────────────────────────────────────

function Avatar({ member, selected }: { member: TeamMember; selected?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-mono text-[12px] tracking-tight transition-all duration-200 ease-calm',
        selected ? 'border-ink bg-ink text-canvas' : 'border-hairline bg-canvas text-muted',
      )}
    >
      {member.initials}
    </span>
  );
}

/**
 * A pill that is on or off. Used wherever the spec calls for a toggle.
 *
 * A `caution` toggle is still filled in ink when on, not in red: on this page red
 * means *refused*, and a permission the human deliberately granted is not a refusal.
 * The sensitivity is carried by a dot instead, which flags it without recolouring it.
 */
function Toggle({
  on,
  onClick,
  children,
  caution,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  caution?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-all duration-200 ease-calm',
        on ? 'border-ink bg-ink text-canvas' : 'border-hairline bg-canvas text-muted hover:border-ink/30',
        caution && !on && 'border-deny/30',
      )}
    >
      {caution && <span className="inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-deny" />}
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-hairline pt-4">
      <div className="text-[14.5px] font-medium text-ink">{label}</div>
      {hint && <p className="mt-1 text-[12px] leading-relaxed text-muted">{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

// ── Launch status ────────────────────────────────────────────────────────────

/** Status in the words the team would use, derived from the chain, never stored. */
function launchStatus(launch: Launch, now: number): { label: string; tone: 'allow' | 'deny' | 'default' } {
  const root = launch.snapshot.registry.passports[launch.snapshot.rootId];
  if (!root) return { label: 'no chain', tone: 'default' };
  if (root.claims.revoked) return { label: 'withdrawn', tone: 'deny' };
  if (now > root.claims.expiresAt) return { label: 'expired', tone: 'deny' };
  const agents = Object.keys(launch.snapshot.registry.passports).length;
  return { label: `running · ${agents} agent${agents === 1 ? '' : 's'}`, tone: 'allow' };
}

// ── The dashboard ────────────────────────────────────────────────────────────

export function TeamDashboard() {
  const now = useNow();
  const { launches, activeLaunchId, launch, openLaunch, registry, rootId, receipts } = useDemo();

  const [holderId, setHolderId] = useState<string>(DEFAULT_HOLDER_ID);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE.id);
  const [form, setForm] = useState<AuthorityForm>({ ...DEFAULT_TEMPLATE.form });

  const holder = MEMBER_BY_ID[holderId] ?? MEMBER_BY_ID[DEFAULT_HOLDER_ID];
  const template = TEMPLATE_BY_ID[templateId] ?? DEFAULT_TEMPLATE;

  const pickTemplate = (next: TaskTemplate) => {
    setTemplateId(next.id);
    setForm({ ...next.form });
  };

  const toggleCapability = (key: Capability) =>
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(key)
        ? f.capabilities.filter((c) => c !== key)
        : [...f.capabilities, key],
    }));

  const toggleScope = (key: DataScope) =>
    setForm((f) => ({
      ...f,
      dataScopes: f.dataScopes.includes(key) ? f.dataScopes.filter((s) => s !== key) : [...f.dataScopes, key],
    }));

  // The live chain's own launch shows live state; the parked ones show their snapshot.
  const withLive: Launch[] = launches.map((l) =>
    l.id === activeLaunchId
      ? { ...l, snapshot: { ...l.snapshot, registry, rootId, receipts } }
      : l,
  );

  return (
    <div className="space-y-6">
      {/* ── The team ──────────────────────────────────────────────────────── */}
      <section className="card p-5 sm:p-7">
        <SectionHeading
          eyebrow="Team"
          title={
            <>
              {TEAM_NAME.replace(' Team', '')} <Em>Team</Em>
            </>
          }
          hint="Four people, one shared backlog, and a lot of work they would rather hand to agents."
        />

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TEAM_MEMBERS.map((member) => (
            <div
              key={member.id}
              className={cx(
                'flex items-center gap-3 rounded-card border p-3',
                member.id === holderId ? 'border-ink/30 bg-surface' : 'border-hairline bg-canvas',
              )}
            >
              <Avatar member={member} selected={member.id === holderId} />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-medium leading-tight">{member.name}</div>
                <div className="truncate text-[11.5px] text-muted">{member.role}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-5 border-t border-hairline pt-4 text-[14px] leading-relaxed text-ink">
          Agents can never create authority. Every action traces back to a person on this team.
        </p>
      </section>

      {/* ── Launch a task ─────────────────────────────────────────────────── */}
      <section className="card p-5 sm:p-7">
        <SectionHeading
          eyebrow="Launch a task"
          title={
            <>
              Hand the work over, on <Em>your</Em> terms.
            </>
          }
          hint="Pick the job, say what the agent may do, and sign it. Everything the agents do afterwards is a narrowed slice of exactly this — never more."
        />

        {/* Who is authorizing */}
        <div className="mt-6">
          <div className="text-[14.5px] font-medium text-ink">Who&rsquo;s authorizing this?</div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Their name goes on the chain. Every agent below inherits from them, and only they can widen it later.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {TEAM_MEMBERS.map((member) => {
              const selected = member.id === holderId;
              return (
                <button
                  key={member.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setHolderId(member.id)}
                  className={cx(
                    'flex items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-3.5 text-left transition-all duration-200 ease-calm',
                    selected ? 'border-ink bg-canvas' : 'border-hairline bg-canvas hover:border-ink/30',
                  )}
                >
                  <Avatar member={member} selected={selected} />
                  <span>
                    <span className="block text-[13px] font-medium leading-tight">{member.name}</span>
                    <span className="block text-[11px] leading-tight text-muted">{member.role}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Task templates */}
        <div className="mt-7">
          <div className="text-[14.5px] font-medium text-ink">What should it work on?</div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Each job comes with a starting set of permissions. Change anything you like before you sign.
          </p>
          <div className="mt-2.5 grid gap-3 lg:grid-cols-3">
            {TASK_TEMPLATES.map((item) => {
              const selected = item.id === templateId;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => pickTemplate(item)}
                  className={cx(
                    'rounded-card border p-3.5 text-left transition-all duration-200 ease-calm',
                    selected ? 'border-ink bg-surface' : 'border-hairline bg-canvas hover:border-ink/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13.5px] font-medium leading-snug">{item.title}</span>
                    <span
                      className={cx(
                        'mt-[3px] h-3 w-3 shrink-0 rounded-full border',
                        selected ? 'border-[4px] border-ink' : 'border-hairline',
                      )}
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{item.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* The authority form — plain language only */}
        <div className="mt-7 space-y-5 rounded-card border border-hairline bg-surface p-4 sm:p-5">
          <div>
            <div className="label">Authority for this task</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              Whatever you leave off here cannot appear anywhere below you — not in the agent you hand this to, and
              not in anything it hands work to.
            </p>
          </div>

          <Field label="What can the agent do?">
            <div className="grid gap-2 sm:grid-cols-2">
              {CAPABILITIES.map((option) => {
                const on = option.bindsToDelegation
                  ? form.canDelegate
                  : form.capabilities.includes(option.key);
                return (
                  <label
                    key={option.key}
                    className={cx(
                      'flex cursor-pointer items-start gap-2.5 rounded-md border bg-canvas p-2.5 transition-all duration-200',
                      on ? 'border-ink/30' : 'border-hairline',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        option.bindsToDelegation
                          ? setForm((f) => ({ ...f, canDelegate: !f.canDelegate }))
                          : toggleCapability(option.key)
                      }
                      className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[#0A0A0A]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium leading-snug">{option.label}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">{option.hint}</span>
                      {option.caution && (
                        <span className="mt-1 block text-[11.5px] leading-relaxed text-deny">
                          {on ? '⚠ ' : ''}
                          {option.caution}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>

          <Field label="What data can it touch?">
            <div className="flex flex-wrap gap-2">
              {DATA_SCOPES.map((option) => (
                <Toggle
                  key={option.key}
                  on={form.dataScopes.includes(option.key)}
                  caution={option.sensitive}
                  onClick={() => toggleScope(option.key)}
                >
                  {option.label}
                  <span className="ml-2 opacity-60">{option.hint}</span>
                </Toggle>
              ))}
            </div>
          </Field>

          <Field label="Spending limit" hint="What this job may cost in total, across every agent that touches it.">
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={form.budgetUsd}
                onChange={(event) => setForm((f) => ({ ...f, budgetUsd: Number(event.target.value) }))}
                aria-label="Spending limit in dollars"
                className="h-1 flex-1 cursor-pointer accent-[#0A0A0A]"
              />
              <span className="w-14 shrink-0 text-right font-mono text-[15px] tabular-nums">
                ${form.budgetUsd}
              </span>
            </div>
          </Field>

          <Field label="Expires after" hint="After this, the agents stop — you do not have to remember to turn them off.">
            <div className="flex flex-wrap gap-2">
              {EXPIRY_CHOICES.map((hours) => (
                <Toggle
                  key={hours}
                  on={form.expiresInHours === hours}
                  onClick={() => setForm((f) => ({ ...f, expiresInHours: hours as ExpiryHours }))}
                >
                  {hours} hours
                </Toggle>
              ))}
            </div>
          </Field>

          <Field
            label="Let it hand work to other agents?"
            hint="Helper agents always get less than the agent that called them, never more."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Toggle on={form.canDelegate} onClick={() => setForm((f) => ({ ...f, canDelegate: !f.canDelegate }))}>
                {form.canDelegate ? 'Yes, it may' : 'No, it works alone'}
              </Toggle>

              {form.canDelegate && (
                <div className="flex animate-fade items-center gap-2 rounded-full border border-hairline bg-canvas px-2 py-1">
                  <span className="pl-1 text-[12px] text-muted">Max hops</span>
                  <button
                    type="button"
                    aria-label="Fewer hops"
                    disabled={form.maxHops <= MIN_HOPS}
                    onClick={() => setForm((f) => ({ ...f, maxHops: Math.max(MIN_HOPS, f.maxHops - 1) }))}
                    className="h-6 w-6 rounded-full border border-hairline text-[13px] leading-none text-ink transition-colors duration-200 hover:border-ink/40 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-4 text-center font-mono text-[13px] tabular-nums">{form.maxHops}</span>
                  <button
                    type="button"
                    aria-label="More hops"
                    disabled={form.maxHops >= MAX_HOPS}
                    onClick={() => setForm((f) => ({ ...f, maxHops: Math.min(MAX_HOPS, f.maxHops + 1) }))}
                    className="h-6 w-6 rounded-full border border-hairline text-[13px] leading-none text-ink transition-colors duration-200 hover:border-ink/40 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </Field>
        </div>

        {/* Sign it */}
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <button
            type="button"
            className="btn-primary"
            onClick={() => launch({ holderId, templateId, form })}
          >
            Issue Passport &amp; launch chain
          </button>
          <p className="max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
            Signed by {holder.name} as {holder.role}, on behalf of the {TEAM_NAME}. You can withdraw it at any time
            from the Agent Chain tab.
          </p>
        </div>
      </section>

      {/* ── Active launches ───────────────────────────────────────────────── */}
      <section className="card p-5 sm:p-7">
        <SectionHeading
          eyebrow="Active launches"
          title={
            <>
              What this team has <Em>started</Em>.
            </>
          }
          hint="Every chain running under someone's name. Open one to see what its agents actually inherited."
        />

        <div className="mt-5 divide-y divide-hairline border-y border-hairline">
          {withLive.map((item) => {
            const status = launchStatus(item, now);
            const active = item.id === activeLaunchId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openLaunch(item.id)}
                className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-1 py-3.5 text-left transition-colors duration-200 hover:bg-surface"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium leading-snug">{item.title}</span>
                    {active && <Chip tone="dim">on screen</Chip>}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    Authorized by {holderLine(item.holderId)} · {formatTime(item.at)}
                  </span>
                </span>
                <Chip tone={status.tone === 'default' ? 'dim' : status.tone} className="chip-mono">
                  {status.label}
                </Chip>
                <span className="text-[12px] text-muted transition-colors duration-200 group-hover:text-ink">
                  Open →
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
          {template.title} is selected above. Launching it again issues a new root Passport — the old chain keeps
          running under whoever signed it, untouched.
        </p>
      </section>
    </div>
  );
}
