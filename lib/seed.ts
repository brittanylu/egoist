/**
 * The chain a launch produces, minted with real Ed25519 signatures so the judge lands
 * on a populated, genuinely-verifying chain rather than an empty state.
 *
 *   Jordan Lee · Business Analytics Team (human holder)
 *     └── Claude Code  triage      read, delegate · full ticket records · $50 · 24h
 *          ├── Dedup subagent      read, delegate · ticket text only    · $20 · 12h
 *          │    └── Classifier subagent · anonymized text only · $5 · 6h · no delegation
 *          └── Summarizer subagent read, delegate · ticket text + metadata · $15 · 12h
 *               └── Digest subagent · anonymized text only · $4 · 6h · no delegation
 *
 * The tiers are named, not lettered: a human holder, one primary agent, and the
 * subagents it spawns. Who is who has to be readable at a glance, because the whole
 * claim of the demo is about which of them held what.
 *
 * The root grant is not hardcoded — it is whatever a person on the team filled into
 * the dashboard form. Every node beneath it is *derived* from its parent rather than
 * written down: each child drops actions, narrows into a sub-scope, halves the budget
 * and halves the remaining life. Derivation is what makes the chain honest under a
 * human's edits — uncheck "Write" at the top and no agent anywhere below can write,
 * because there was nothing to inherit.
 *
 * The classifier subagent is the leaf the action console drives: classifying
 * internally is inside its authority, sending to an external webhook is not — and
 * never was, at any point on the chain.
 */
import { KeyPair, deterministicKeyPair } from './crypto';
import {
  Action,
  Destination,
  Passport,
  PassportClaims,
  Registry,
  delegate,
  emptyRegistry,
  issueRoot,
  putPassport,
  registerKey,
  scopeCoveredBy,
} from './passport';
import {
  AuthorityForm,
  DEFAULT_HOLDER_ID,
  TEAM_MEMBERS,
} from './team';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/**
 * Three tiers, and the difference between them is the point:
 *   human    the holder, the only party who can widen anything
 *   agent    the primary agent the human handed the task to — here, Claude Code
 *   subagent anything Claude Code spawned, and anything those spawned in turn
 */
export type ActorKind = 'human' | 'agent' | 'subagent';

export interface Actor {
  id: string;
  label: string;
  /** What it does. Kept short: it sits under the name on a 248px card. */
  role: string;
  kind: ActorKind;
}

/** The machine half of the cast. The human half comes from the team. */
const AGENT_ACTORS: Actor[] = [
  { id: 'claude-code', label: 'Claude Code', role: 'Triage orchestration', kind: 'agent' },
  { id: 'dedup-subagent', label: 'Dedup subagent', role: 'Near-duplicate clustering', kind: 'subagent' },
  { id: 'classifier-subagent', label: 'Classifier subagent', role: 'Topic labelling', kind: 'subagent' },
  { id: 'summarizer-subagent', label: 'Summarizer subagent', role: 'Theme summaries', kind: 'subagent' },
  { id: 'digest-subagent', label: 'Digest subagent', role: 'Internal digest drafting', kind: 'subagent' },
];

/**
 * Everyone who can hold a key: every person on the team, and every agent. People are
 * first-class actors here, which is what lets a receipt three hops down name a person
 * rather than an abstract "holder".
 */
export const ACTORS: Actor[] = [
  ...TEAM_MEMBERS.map((m): Actor => ({ id: m.id, label: m.name, role: m.role, kind: 'human' })),
  ...AGENT_ACTORS,
];

export const ACTOR_BY_ID: Record<string, Actor> = Object.fromEntries(ACTORS.map((a) => [a.id, a]));

/** What each tier is called wherever a node is badged. */
export const TIER_LABEL: Record<ActorKind, string> = {
  human: 'holder',
  agent: 'primary agent',
  subagent: 'subagent',
};

/**
 * The identifier with the tier suffix dropped, for dense mono rows where the full id
 * would truncate to nothing. Only safe where the tier is already established by the
 * surrounding context.
 */
export function shortActorId(id: string): string {
  return id.replace(/-subagent$/, '');
}

/**
 * What an edge handed down, phrased for a reader rather than a verifier. Derived from
 * the child's actual scopes, so it cannot drift from the Passport it describes when a
 * human changes what the root may touch.
 */
const SCOPE_PHRASES: Record<string, string> = {
  'ticket.customer.pii|ticket.metadata|ticket.text': 'full ticket records',
  'ticket.metadata|ticket.text': 'ticket text + metadata',
  'ticket.text': 'ticket text only — no customer PII',
  'ticket.text.anonymized': 'anonymized text only',
  'ticket.metadata': 'metadata only',
  'ticket.customer.pii': 'customer PII only',
};

export function edgeLabel(claims: PassportClaims): string {
  const key = [...claims.contextScopes].sort().join('|');
  if (SCOPE_PHRASES[key]) return SCOPE_PHRASES[key];
  if (!claims.contextScopes.length) return 'no context at all';
  return claims.contextScopes.map((s) => s.replace(/^ticket\./, '')).join(' + ');
}

// ---------------------------------------------------------------------------
// Templates: the shapes a launch can take
// ---------------------------------------------------------------------------

/**
 * One agent beneath the root, described relative to its parent rather than absolutely.
 * A spec can only ever subtract: `drop` removes actions, `scopes` narrows context,
 * `budgetFraction` takes a slice. Nothing here can widen anything, which is why the
 * seed cannot construct a chain that fails its own guards.
 */
interface NodeSpec {
  subject: string;
  /** Subject of the agent that spawns it. */
  parent: string;
  passportId: string;
  task: string;
  /** Actions given up at this hop. */
  drop: Action[];
  /** Desired context, narrowed against whatever the parent actually holds. */
  scopes: string[];
  budgetFraction: number;
  /** Hops this node may pass on, capped by what remains above it. */
  maxDepth: number;
}

export interface TaskTemplate {
  id: string;
  /** What the card says. Plain language — a person picks this. */
  title: string;
  blurb: string;
  /** The formal task string written onto the root Passport. */
  task: string;
  form: AuthorityForm;
  nodes: NodeSpec[];
  /** The agent the action console drives once this chain exists. */
  leafSubject: string;
}

const DEDUP: NodeSpec = {
  subject: 'dedup-subagent',
  parent: 'claude-code',
  passportId: 'psp_dedup',
  task: 'Cluster near-duplicate tickets by text similarity',
  drop: ['write'],
  scopes: ['ticket.text'],
  budgetFraction: 0.4,
  maxDepth: 1,
};

const CLASSIFIER: NodeSpec = {
  subject: 'classifier-subagent',
  parent: 'dedup-subagent',
  passportId: 'psp_classifier',
  task: 'Assign a topic label to each de-duplicated ticket',
  // Keeps 'send', so its external attempt is blocked by the DESTINATION it inherited,
  // not by the verb — which is the whole point.
  drop: ['write', 'delegate'],
  scopes: ['ticket.text.anonymized'],
  budgetFraction: 0.25,
  maxDepth: 0,
};

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'cleanup',
    title: 'Clean up 3 years of support tickets',
    blurb: 'Deduplicate, re-tag and summarize the whole backlog. Two branches, five agents.',
    task: 'Resolve duplicate and mis-tagged support tickets across 3 years of history',
    form: {
      capabilities: ['read', 'classify', 'write'],
      dataScopes: ['ticket.text', 'ticket.metadata', 'ticket.customer.pii'],
      budgetUsd: 50,
      expiresInHours: 24,
      canDelegate: true,
      maxHops: 3,
    },
    nodes: [
      DEDUP,
      CLASSIFIER,
      {
        subject: 'summarizer-subagent',
        parent: 'claude-code',
        passportId: 'psp_summarizer',
        task: 'Summarize recurring themes for the weekly operations review',
        drop: ['classify', 'send'],
        scopes: ['ticket.text', 'ticket.metadata'],
        budgetFraction: 0.3,
        maxDepth: 1,
      },
      {
        subject: 'digest-subagent',
        parent: 'summarizer-subagent',
        passportId: 'psp_digest',
        task: 'Draft the internal digest from theme summaries',
        drop: ['delegate', 'classify', 'send'],
        scopes: ['ticket.text.anonymized'],
        budgetFraction: 0.25,
        maxDepth: 0,
      },
    ],
    leafSubject: 'classifier-subagent',
  },
  {
    id: 'summarize',
    title: "Summarize this week's tickets",
    blurb: 'One pass over seven days of tickets, ending in an internal digest.',
    task: "Summarize this week's support tickets for the operations review",
    form: {
      capabilities: ['read', 'write'],
      dataScopes: ['ticket.text', 'ticket.metadata'],
      budgetUsd: 25,
      expiresInHours: 12,
      canDelegate: true,
      maxHops: 2,
    },
    nodes: [
      {
        subject: 'summarizer-subagent',
        parent: 'claude-code',
        passportId: 'psp_summarizer',
        task: 'Summarize recurring themes across this week of tickets',
        drop: ['classify'],
        scopes: ['ticket.text', 'ticket.metadata'],
        budgetFraction: 0.5,
        maxDepth: 1,
      },
      {
        subject: 'digest-subagent',
        parent: 'summarizer-subagent',
        passportId: 'psp_digest',
        task: 'Draft the internal digest from theme summaries',
        drop: ['delegate', 'classify'],
        scopes: ['ticket.text.anonymized'],
        budgetFraction: 0.4,
        maxDepth: 0,
      },
    ],
    leafSubject: 'digest-subagent',
  },
  {
    id: 'classify',
    title: 'Classify incoming tickets',
    blurb: 'Label new tickets as they arrive. Text only, no customer PII, short window.',
    task: 'Assign topic labels to incoming support tickets',
    form: {
      capabilities: ['read', 'classify'],
      dataScopes: ['ticket.text'],
      budgetUsd: 10,
      expiresInHours: 6,
      canDelegate: true,
      maxHops: 2,
    },
    nodes: [DEDUP, CLASSIFIER],
    leafSubject: 'classifier-subagent',
  },
];

export const TEMPLATE_BY_ID: Record<string, TaskTemplate> = Object.fromEntries(
  TASK_TEMPLATES.map((t) => [t.id, t]),
);

export const DEFAULT_TEMPLATE = TASK_TEMPLATES[0];

// ---------------------------------------------------------------------------
// Plain language → Passport claims
// ---------------------------------------------------------------------------

/**
 * `send` is always granted at the root. See the note on `Capability` in team.ts: the
 * destination list, not the verb, is what bounds where results may go.
 */
export function formActions(form: AuthorityForm): Action[] {
  const actions: Action[] = [];
  if (form.capabilities.includes('read')) actions.push('read');
  if (form.capabilities.includes('classify')) actions.push('classify');
  if (form.capabilities.includes('write')) actions.push('write');
  if (form.canDelegate) actions.push('delegate');
  actions.push('send');
  return actions;
}

export function formDestinations(form: AuthorityForm): Destination[] {
  return form.capabilities.includes('send-external')
    ? ['internal-only', 'external-webhook']
    : ['internal-only'];
}

// ---------------------------------------------------------------------------
// Building a chain
// ---------------------------------------------------------------------------

export interface LaunchConfig {
  /** Team member issuing the root Passport. Their key signs it. */
  holderId: string;
  templateId: string;
  form: AuthorityForm;
}

export function defaultLaunchConfig(): LaunchConfig {
  return {
    holderId: DEFAULT_HOLDER_ID,
    templateId: DEFAULT_TEMPLATE.id,
    form: { ...DEFAULT_TEMPLATE.form },
  };
}

export interface SeedResult {
  registry: Registry;
  keys: Record<string, KeyPair>;
  /** Passport id per subject, for wiring the UI. */
  passportBySubject: Record<string, string>;
  rootId: string;
  leafId: string;
  seededAt: number;
  holderId: string;
  templateId: string;
  task: string;
}

/**
 * A child request derived from what its parent actually holds. Every field is clamped
 * against the parent, so the request satisfies every guard by construction: this is
 * the seed, not the sandbox — it demonstrates narrowing rather than testing it.
 */
function derivedRequest(parent: PassportClaims, spec: NodeSpec, now: number) {
  const actions = parent.actions.filter((a) => !spec.drop.includes(a));
  // Narrow into the sub-scopes the spec wants, but only those the parent can cover.
  // If the human withheld everything this node wanted, it inherits the parent's scopes
  // unchanged rather than reaching for context nobody above it held.
  const covered = spec.scopes.filter((s) => scopeCoveredBy(s, parent.contextScopes));
  const maxDepth = Math.max(0, Math.min(spec.maxDepth, parent.maxDepth - 1));

  return {
    id: spec.passportId,
    subject: spec.subject,
    task: spec.task,
    actions,
    contextScopes: covered.length ? covered : [...parent.contextScopes],
    allowedDestinations: [...parent.allowedDestinations],
    budgetUsd: Math.min(parent.budgetUsd, Math.round(parent.budgetUsd * spec.budgetFraction)),
    // Half the life left above it, and never past its parent.
    expiresAt: Math.min(parent.expiresAt, now + Math.round((parent.expiresAt - now) / 2)),
    canDelegate: maxDepth >= 1 && actions.includes('delegate'),
    maxDepth,
    issuedAt: now,
  };
}

/** Whether this Passport can mint anything at all. Nothing below it exists if not. */
function canSpawn(claims: PassportClaims): boolean {
  return claims.canDelegate && claims.actions.includes('delegate') && claims.maxDepth >= 1;
}

export function buildSeed(now: number = Date.now(), config: LaunchConfig = defaultLaunchConfig()): SeedResult {
  const template = TEMPLATE_BY_ID[config.templateId] ?? DEFAULT_TEMPLATE;
  const form = config.form;

  const keys: Record<string, KeyPair> = Object.fromEntries(
    ACTORS.map((a) => [a.id, deterministicKeyPair(a.id)]),
  );

  let registry = emptyRegistry();
  for (const actor of ACTORS) {
    registry = registerKey(registry, keys[actor.id], actor.label);
  }

  // ── Human → the primary agent ────────────────────────────────────────────
  // Everything the person filled in on the dashboard, and nothing else. Note what is
  // absent by default, and can therefore never appear anywhere below: any external
  // destination. That is the boundary the classifier runs into three hops later.
  const root = issueRoot(
    {
      id: `psp_root_${config.holderId.replace(/-/g, '_')}`,
      holder: config.holderId,
      subject: 'claude-code',
      task: template.task,
      actions: formActions(form),
      contextScopes: form.dataScopes.slice(),
      allowedDestinations: formDestinations(form),
      budgetUsd: form.budgetUsd,
      expiresAt: now + form.expiresInHours * HOUR,
      canDelegate: form.canDelegate,
      maxDepth: form.canDelegate ? form.maxHops : 0,
      issuedAt: now,
    },
    keys[config.holderId] ?? keys[DEFAULT_HOLDER_ID],
  );
  registry = putPassport(registry, root);

  // ── The agents beneath it, each derived from its parent ──────────────────
  const bySubject: Record<string, Passport> = { 'claude-code': root };

  for (const spec of template.nodes) {
    const parent = bySubject[spec.parent];
    // A parent that was never minted, or that the human forbade from delegating,
    // spawns nothing — and neither does anything that would have hung beneath it.
    if (!parent || !canSpawn(parent.claims)) continue;

    const result = delegate(parent, derivedRequest(parent.claims, spec, now), keys[spec.parent], now);
    if (!result.ok) {
      // Every field above is clamped against the parent, so this is unreachable
      // unless a guard changed. Fail loudly rather than shipping a broken chain.
      throw new Error(
        `Seed delegation to ${spec.subject} failed ${result.violations[0]?.guard}: ${result.violations
          .map((v) => v.message)
          .join(' ')}`,
      );
    }
    registry = putPassport(registry, result.child);
    bySubject[spec.subject] = result.child;
  }

  const passportBySubject = Object.fromEntries(
    Object.values(registry.passports).map((p) => [p.claims.subject, p.claims.id]),
  );

  // The console drives the template's leaf where it exists — but the human may have
  // switched delegation off, in which case the primary agent is the whole chain.
  const spawned = template.nodes.map((n) => n.subject).filter((s) => s in bySubject);
  const leafSubject =
    template.leafSubject in bySubject ? template.leafSubject : (spawned[spawned.length - 1] ?? 'claude-code');

  return {
    registry,
    keys,
    passportBySubject,
    rootId: root.claims.id,
    leafId: bySubject[leafSubject].claims.id,
    seededAt: now,
    holderId: config.holderId,
    templateId: template.id,
    task: template.task,
  };
}
