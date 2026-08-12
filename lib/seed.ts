/**
 * The canonical demo scenario, minted with real Ed25519 signatures so the judge
 * lands on a populated, genuinely-verifying chain rather than an empty state.
 *
 *   Ops Lead (human holder)
 *     └── Agent A   triage        read, delegate · full ticket records · $50 · 24h
 *          ├── Agent B  dedup     read, delegate · ticket text only   · $20 · 12h
 *          │    └── Agent C  classify · anonymized text only · $5 · 6h · no delegation
 *          └── Agent D  summarize read, delegate · ticket text + metadata · $15 · 12h
 *               └── Agent E  digest · anonymized text only · $4 · 6h · no delegation
 *
 * Agent C is the leaf the action console drives: classifying internally is inside
 * its authority, sending to an external webhook is not — and never was, at any
 * point on the chain.
 */
import { KeyPair, deterministicKeyPair } from './crypto';
import { Passport, Registry, delegate, emptyRegistry, issueRoot, putPassport, registerKey } from './passport';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export interface Actor {
  id: string;
  label: string;
  role: string;
  kind: 'human' | 'agent';
}

export const ACTORS: Actor[] = [
  { id: 'ops-lead', label: 'Ops Lead', role: 'Human holder · support operations', kind: 'human' },
  { id: 'agent-a', label: 'Agent A', role: 'Triage orchestrator', kind: 'agent' },
  { id: 'agent-b', label: 'Agent B', role: 'Deduplication', kind: 'agent' },
  { id: 'agent-c', label: 'Agent C', role: 'Classifier', kind: 'agent' },
  { id: 'agent-d', label: 'Agent D', role: 'Summarizer', kind: 'agent' },
  { id: 'agent-e', label: 'Agent E', role: 'Digest writer', kind: 'agent' },
];

export const ACTOR_BY_ID: Record<string, Actor> = Object.fromEntries(ACTORS.map((a) => [a.id, a]));

/** Human-readable label for what each edge handed down. */
export const EDGE_LABELS: Record<string, string> = {
  'agent-a': 'full ticket records, 3 years',
  'agent-b': 'ticket text only — no customer PII',
  'agent-c': 'anonymized text only',
  'agent-d': 'ticket text + metadata',
  'agent-e': 'anonymized text only',
};

export interface SeedResult {
  registry: Registry;
  keys: Record<string, KeyPair>;
  /** Passport id per subject, for wiring the UI. */
  passportBySubject: Record<string, string>;
  rootId: string;
  leafId: string;
  seededAt: number;
}

export function buildSeed(now: number = Date.now()): SeedResult {
  const keys: Record<string, KeyPair> = Object.fromEntries(
    ACTORS.map((a) => [a.id, deterministicKeyPair(a.id)]),
  );

  let registry = emptyRegistry();
  for (const actor of ACTORS) {
    registry = registerKey(registry, keys[actor.id], actor.label);
  }

  // ── Human → Agent A ──────────────────────────────────────────────────────
  const root = issueRoot(
    {
      id: 'psp_root_ops_lead',
      holder: 'ops-lead',
      subject: 'agent-a',
      task: 'Resolve duplicate and mis-tagged support tickets across 3 years of history',
      actions: ['read', 'classify', 'write', 'delegate', 'send'],
      contextScopes: ['ticket.text', 'ticket.metadata', 'ticket.customer.pii'],
      // The Ops Lead allows sending results — but only inside the company. Note what
      // is absent, and can therefore never appear anywhere below: any external
      // destination. This is the boundary Agent C runs into three hops later.
      allowedDestinations: ['internal-only'],
      budgetUsd: 50,
      expiresAt: now + 24 * HOUR,
      canDelegate: true,
      maxDepth: 3,
      issuedAt: now,
    },
    keys['ops-lead'],
  );
  registry = putPassport(registry, root);

  const mint = (parent: Passport, issuer: string, req: Parameters<typeof delegate>[1]): Passport => {
    const result = delegate(parent, req, keys[issuer], now);
    if (!result.ok) {
      // The seed is by construction valid; if this ever fires the invariant changed.
      throw new Error(
        `Seed delegation to ${req.subject} violated the narrowing invariant: ${result.violations
          .map((v) => v.message)
          .join(' ')}`,
      );
    }
    registry = putPassport(registry, result.child);
    return result.child;
  };

  // ── Agent A → Agent B (dedup): ticket text only, no PII ──────────────────
  const bPassport = mint(root, 'agent-a', {
    id: 'psp_agent_b',
    subject: 'agent-b',
    task: 'Cluster near-duplicate tickets by text similarity',
    actions: ['read', 'classify', 'delegate', 'send'], // 'write' dropped here
    contextScopes: ['ticket.text'],
    allowedDestinations: ['internal-only'],
    budgetUsd: 20,
    expiresAt: now + 12 * HOUR,
    canDelegate: true,
    maxDepth: 1,
    issuedAt: now,
  });

  // ── Agent B → Agent C (classifier): anonymized text, cannot delegate ─────
  mint(bPassport, 'agent-b', {
    id: 'psp_agent_c',
    subject: 'agent-c',
    task: 'Assign a topic label to each de-duplicated ticket',
    // Holds 'send', so its external attempt is blocked by the DESTINATION it
    // inherited, not by the verb — which is the whole point.
    actions: ['read', 'classify', 'send'],
    contextScopes: ['ticket.text.anonymized'],
    allowedDestinations: ['internal-only'],
    budgetUsd: 5,
    expiresAt: now + 6 * HOUR,
    canDelegate: false,
    maxDepth: 0,
    issuedAt: now,
  });

  // ── Agent A → Agent D (summarizer) ───────────────────────────────────────
  const dPassport = mint(root, 'agent-a', {
    id: 'psp_agent_d',
    subject: 'agent-d',
    task: 'Summarize recurring themes for the weekly operations review',
    actions: ['read', 'write', 'delegate'], // 'classify' dropped here
    contextScopes: ['ticket.text', 'ticket.metadata'],
    allowedDestinations: ['internal-only'],
    budgetUsd: 15,
    expiresAt: now + 12 * HOUR,
    canDelegate: true,
    maxDepth: 1,
    issuedAt: now,
  });

  // ── Agent D → Agent E (digest writer) ────────────────────────────────────
  mint(dPassport, 'agent-d', {
    id: 'psp_agent_e',
    subject: 'agent-e',
    task: 'Draft the internal digest from theme summaries',
    actions: ['read', 'write'],
    contextScopes: ['ticket.text.anonymized'],
    allowedDestinations: ['internal-only'],
    budgetUsd: 4,
    expiresAt: now + 6 * HOUR,
    canDelegate: false,
    maxDepth: 0,
    issuedAt: now,
  });

  const passportBySubject = Object.fromEntries(
    Object.values(registry.passports).map((p) => [p.claims.subject, p.claims.id]),
  );

  return {
    registry,
    keys,
    passportBySubject,
    rootId: root.claims.id,
    leafId: 'psp_agent_c',
    seededAt: now,
  };
}
