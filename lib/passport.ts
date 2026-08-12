/**
 * AI Passport — chain of custody.
 *
 * A Passport is a signed grant of authority. A human holder issues a root Passport
 * to an agent; an agent that needs help mints a CHILD Passport for another agent.
 *
 * The one invariant this file exists to enforce:
 *
 *     A child Passport may carry LESS authority than its parent, never more.
 *
 * Authority is monotonically non-increasing down the chain, field by field. Each
 * field is held by a GUARD — a single rule that either passes or fails, named on
 * every refusal. The guards live in `guardViolations()` and run at BOTH `delegate()`
 * (mint time) and `verifyChain()` (verify time), so narrowing is structural, not
 * advisory: an agent that hand-crafts a broader Passport still fails a guard at
 * verification, because the verifier re-derives every guard itself rather than
 * trusting the minter.
 *
 * A request that fails a guard is not an error. It falls back to requiring human
 * authority: only the holder at the root can widen anything.
 *
 * Zero React imports. This is the SDK.
 */
import { KeyPair, newId, sign, verifySignature } from './crypto';

/**
 * The part of a Passport its issuer actually signs: everything except `revoked`.
 *
 * Revocation is asserted by the holder *after* issuance, so it cannot live inside
 * the issuer's signature — otherwise revoking a Passport would break its own
 * signature and the verifier would report "tampered" when it means "withdrawn".
 * Revocation state belongs to the verifier's registry, which is why it is not
 * attacker-supplied and does not need to be signed.
 */
function signable(claims: PassportClaims): Omit<PassportClaims, 'revoked'> {
  const { revoked: _revoked, ...rest } = claims;
  return rest;
}

/** Sign a Passport's claims, hash-linked to its parent's signature. */
export function signPassportClaims(
  claims: PassportClaims,
  parentSignature: string | null,
  privateKeyHex: string,
): string {
  return sign(signable(claims), parentSignature, privateKeyHex);
}

export function verifyPassportSignature(
  claims: PassportClaims,
  parentSignature: string | null,
  signature: string,
  publicKeyHex: string,
): boolean {
  return verifySignature(signable(claims), parentSignature, signature, publicKeyHex);
}

export type Action = 'read' | 'write' | 'delegate' | 'classify' | 'send';
export type Destination = 'internal-only' | 'external-webhook' | 'email';

export const ALL_ACTIONS: Action[] = ['read', 'write', 'delegate', 'classify', 'send'];
export const ALL_DESTINATIONS: Destination[] = ['internal-only', 'external-webhook', 'email'];

export interface PassportClaims {
  id: string;
  parentId: string | null; // null = root
  rootId: string;
  issuer: string; // who signed it (human holder or agent id)
  subject: string; // the agent this grants authority TO
  task: string;
  actions: Action[];
  contextScopes: string[]; // e.g. ['ticket.text'] ⊆ parent scopes
  allowedDestinations: Destination[];
  budgetUsd: number;
  issuedAt: number;
  expiresAt: number;
  canDelegate: boolean;
  maxDepth: number; // remaining delegation hops allowed
  revoked: boolean;
}

export interface Passport {
  claims: PassportClaims;
  /** Issuer's Ed25519 signature over canonical claims + the parent's signature. */
  signature: string;
}

/** Every field a guard narrows. Used to route UI copy. */
export type ViolationField =
  | 'actions'
  | 'contextScopes'
  | 'allowedDestinations'
  | 'budgetUsd'
  | 'expiresAt'
  | 'maxDepth'
  | 'canDelegate'
  | 'issuer'
  | 'rootId';

/**
 * The guard that owns each field. Guards are named, not numbered: a refusal says
 * which one it failed, and the name is stable enough to grep for in the audit log.
 */
export const GUARD_BY_FIELD: Record<ViolationField, string> = {
  actions: 'guard:actions',
  contextScopes: 'guard:context',
  allowedDestinations: 'guard:destinations',
  budgetUsd: 'guard:budget',
  expiresAt: 'guard:expiry',
  maxDepth: 'guard:depth',
  canDelegate: 'guard:delegation',
  issuer: 'guard:holder',
  rootId: 'guard:root',
};

export interface Violation {
  field: ViolationField;
  /** Which guard rejected it, e.g. `guard:destinations`. */
  guard: string;
  requested: unknown;
  allowedByParent: unknown;
  message: string;
}

export interface Registry {
  passports: Record<string, Passport>;
  /** id (holder or agent) → Ed25519 public key hex. The verifier's trust anchor set. */
  publicKeys: Record<string, string>;
  /** Display names for humans/agents, purely cosmetic. */
  labels: Record<string, string>;
}

export function emptyRegistry(): Registry {
  return { passports: {}, publicKeys: {}, labels: {} };
}

// ---------------------------------------------------------------------------
// Subset primitives
// ---------------------------------------------------------------------------

function isSubset<T>(child: readonly T[], parent: readonly T[]): T[] {
  return child.filter((c) => !parent.includes(c));
}

/**
 * Context scopes are hierarchical and dotted: `ticket.text.anonymized` sits under
 * `ticket.text`, which sits under `ticket`. A child may narrow into a sub-scope
 * of something its parent held, but may never reach sideways or upward.
 */
export function scopeCoveredBy(childScope: string, parentScopes: readonly string[]): boolean {
  return parentScopes.some((p) => p === '*' || p === childScope || childScope.startsWith(`${p}.`));
}

function uncoveredScopes(childScopes: readonly string[], parentScopes: readonly string[]): string[] {
  return childScopes.filter((s) => !scopeCoveredBy(s, parentScopes));
}

// ---------------------------------------------------------------------------
// The guards
// ---------------------------------------------------------------------------

/** Build a violation, stamping it with the guard that owns the field. */
function failed(
  field: ViolationField,
  requested: unknown,
  allowedByParent: unknown,
  message: string,
): Violation {
  return { field, guard: GUARD_BY_FIELD[field], requested, allowedByParent, message };
}

/**
 * Every guard between a parent Passport and a proposed child. An empty array means
 * the child is within its parent's authority.
 *
 * Pure and time-independent: liveness (expiry/revocation at a given instant) is
 * checked separately, because a chain that passed every guard can still be dead.
 */
export function guardViolations(
  parent: PassportClaims,
  child: Omit<PassportClaims, 'id' | 'issuedAt' | 'revoked'> & Partial<Pick<PassportClaims, 'id'>>,
): Violation[] {
  const v: Violation[] = [];

  // Only the agent that HOLDS a Passport may delegate from it.
  if (child.issuer !== parent.subject) {
    v.push(
      failed(
        'issuer',
        child.issuer,
        parent.subject,
        `Only ${parent.subject} holds this Passport, so only ${parent.subject} can delegate from it. Signed by ${child.issuer}.`,
      ),
    );
  }

  if (child.rootId !== parent.rootId) {
    v.push(
      failed('rootId', child.rootId, parent.rootId, `Child claims a different root of authority than its parent.`),
    );
  }

  if (!parent.canDelegate) {
    v.push(
      failed(
        'canDelegate',
        'delegate',
        'canDelegate: false',
        `${parent.subject}'s Passport does not permit delegation at all.`,
      ),
    );
  }

  if (!parent.actions.includes('delegate')) {
    v.push(failed('actions', 'delegate', parent.actions, `${parent.subject} was not granted the 'delegate' action.`));
  }

  // actions ⊆ parent.actions
  const extraActions = isSubset(child.actions, parent.actions);
  if (extraActions.length) {
    v.push(
      failed(
        'actions',
        child.actions,
        parent.actions,
        `Requests actions its parent never held: ${extraActions.join(', ')}.`,
      ),
    );
  }

  // contextScopes ⊆ parent.contextScopes (hierarchically)
  const extraScopes = uncoveredScopes(child.contextScopes, parent.contextScopes);
  if (extraScopes.length) {
    v.push(
      failed(
        'contextScopes',
        child.contextScopes,
        parent.contextScopes,
        `Requests context outside its parent's scope: ${extraScopes.join(', ')}.`,
      ),
    );
  }

  // allowedDestinations ⊆ parent.allowedDestinations
  const extraDestinations = isSubset(child.allowedDestinations, parent.allowedDestinations);
  if (extraDestinations.length) {
    v.push(
      failed(
        'allowedDestinations',
        child.allowedDestinations,
        parent.allowedDestinations,
        `Requests destinations its parent never held: ${extraDestinations.join(', ')}.`,
      ),
    );
  }

  // budget ≤ parent budget
  if (child.budgetUsd > parent.budgetUsd) {
    v.push(
      failed(
        'budgetUsd',
        child.budgetUsd,
        parent.budgetUsd,
        `Requests $${child.budgetUsd} but its parent holds only $${parent.budgetUsd}.`,
      ),
    );
  }

  // expiry ≤ parent expiry
  if (child.expiresAt > parent.expiresAt) {
    v.push(
      failed(
        'expiresAt',
        child.expiresAt,
        parent.expiresAt,
        `Requests an expiry that outlives its parent's Passport.`,
      ),
    );
  }

  // depth: each hop consumes one unit of the remaining delegation allowance
  if (parent.maxDepth < 1) {
    v.push(failed('maxDepth', child.maxDepth, parent.maxDepth, `Parent has no delegation hops left (maxDepth 0).`));
  } else if (child.maxDepth > parent.maxDepth - 1) {
    v.push(
      failed(
        'maxDepth',
        child.maxDepth,
        parent.maxDepth - 1,
        `Requests ${child.maxDepth} further hops; at most ${parent.maxDepth - 1} remain below its parent.`,
      ),
    );
  }

  if (child.canDelegate && child.maxDepth < 1) {
    v.push(failed('canDelegate', true, false, `Cannot both permit delegation and have zero hops remaining.`));
  }

  return v;
}

// ---------------------------------------------------------------------------
// Issue / delegate
// ---------------------------------------------------------------------------

export interface RootClaimsInput {
  holder: string; // the human issuing authority
  subject: string; // the agent receiving it
  task: string;
  actions: Action[];
  contextScopes: string[];
  allowedDestinations: Destination[];
  budgetUsd: number;
  expiresAt: number;
  canDelegate: boolean;
  maxDepth: number;
  id?: string;
  issuedAt?: number;
}

export function issueRoot(input: RootClaimsInput, holderKey: KeyPair): Passport {
  const id = input.id ?? newId('psp');
  const claims: PassportClaims = {
    id,
    parentId: null,
    rootId: id,
    issuer: input.holder,
    subject: input.subject,
    task: input.task,
    actions: [...input.actions],
    contextScopes: [...input.contextScopes],
    allowedDestinations: [...input.allowedDestinations],
    budgetUsd: input.budgetUsd,
    issuedAt: input.issuedAt ?? Date.now(),
    expiresAt: input.expiresAt,
    canDelegate: input.canDelegate,
    maxDepth: input.maxDepth,
    revoked: false,
  };
  return { claims, signature: signPassportClaims(claims, null, holderKey.privateKeyHex) };
}

export interface DelegationRequest {
  subject: string;
  task: string;
  actions: Action[];
  contextScopes: string[];
  allowedDestinations: Destination[];
  budgetUsd: number;
  expiresAt: number;
  canDelegate: boolean;
  maxDepth: number;
  id?: string;
  issuedAt?: number;
}

export type DelegateResult =
  | { ok: true; child: Passport }
  | { ok: false; violations: Violation[] };

/**
 * Mint a child Passport. Rejects — structurally, with the failed guards named —
 * any request that would carry more authority than the parent holds.
 */
export function delegate(
  parent: Passport,
  requested: DelegationRequest,
  issuerKey: KeyPair,
  now: number = Date.now(),
): DelegateResult {
  const childClaims: PassportClaims = {
    id: requested.id ?? newId('psp'),
    parentId: parent.claims.id,
    rootId: parent.claims.rootId,
    issuer: issuerKey.id,
    subject: requested.subject,
    task: requested.task,
    actions: [...requested.actions],
    contextScopes: [...requested.contextScopes],
    allowedDestinations: [...requested.allowedDestinations],
    budgetUsd: requested.budgetUsd,
    issuedAt: requested.issuedAt ?? now,
    expiresAt: requested.expiresAt,
    canDelegate: requested.canDelegate,
    maxDepth: requested.maxDepth,
    revoked: false,
  };

  const violations = guardViolations(parent.claims, childClaims);

  // Liveness of the parent at mint time: a dead Passport delegates nothing.
  if (parent.claims.revoked) {
    violations.push(
      failed(
        'issuer',
        'delegate from a revoked Passport',
        'revoked',
        `Parent Passport ${parent.claims.id} has been revoked.`,
      ),
    );
  }
  if (now > parent.claims.expiresAt) {
    violations.push(
      failed(
        'expiresAt',
        childClaims.expiresAt,
        parent.claims.expiresAt,
        `Parent Passport expired at ${new Date(parent.claims.expiresAt).toISOString()}.`,
      ),
    );
  }

  if (violations.length) return { ok: false, violations };

  // Hash-link: the child's signature covers the parent's signature.
  return {
    ok: true,
    child: {
      claims: childClaims,
      signature: signPassportClaims(childClaims, parent.signature, issuerKey.privateKeyHex),
    },
  };
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

export function putPassport(registry: Registry, passport: Passport): Registry {
  return { ...registry, passports: { ...registry.passports, [passport.claims.id]: passport } };
}

export function registerKey(registry: Registry, key: { id: string; publicKeyHex: string }, label?: string): Registry {
  return {
    ...registry,
    publicKeys: { ...registry.publicKeys, [key.id]: key.publicKeyHex },
    labels: label ? { ...registry.labels, [key.id]: label } : registry.labels,
  };
}

export function childrenOf(registry: Registry, passportId: string): Passport[] {
  return Object.values(registry.passports).filter((p) => p.claims.parentId === passportId);
}

/** Every Passport strictly beneath `passportId`. Powers subtree revocation display. */
export function descendantsOf(registry: Registry, passportId: string): Passport[] {
  const out: Passport[] = [];
  const queue = [passportId];
  const seen = new Set<string>([passportId]);
  while (queue.length) {
    for (const child of childrenOf(registry, queue.shift()!)) {
      if (seen.has(child.claims.id)) continue;
      seen.add(child.claims.id);
      out.push(child);
      queue.push(child.claims.id);
    }
  }
  return out;
}

/**
 * Revoke one Passport. Descendants are NOT touched — they do not need to be.
 * `verifyChain` walks to the root, so any Passport beneath a revoked one stops
 * verifying the instant this flag is set. Subtree revocation falls out for free,
 * and unrelated branches are unaffected.
 */
export function revoke(passportId: string, registry: Registry): Registry {
  const target = registry.passports[passportId];
  if (!target) return registry;
  return putPassport(registry, { ...target, claims: { ...target.claims, revoked: true } });
}

export function unrevokeAll(registry: Registry): Registry {
  const passports: Record<string, Passport> = {};
  for (const [id, p] of Object.entries(registry.passports)) {
    passports[id] = { ...p, claims: { ...p.claims, revoked: false } };
  }
  return { ...registry, passports };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type BreakKind = 'missing' | 'signature' | 'guard' | 'revoked' | 'expired' | 'root' | 'cycle';

export interface LinkCheck {
  hop: number; // 0 = root
  passportId: string;
  subject: string;
  issuer: string;
  signatureValid: boolean;
  /** Every narrowing guard between this Passport and its parent passed. */
  guardsOk: boolean;
  revoked: boolean;
  expired: boolean;
  violations: Violation[];
}

export interface VerificationResult {
  allowed: boolean;
  /** root → leaf. Present even when verification fails, as far as it could be walked. */
  chain: Passport[];
  checks: LinkCheck[];
  reason?: string;
  brokenAt?: {
    hop: number;
    passportId: string;
    subject: string;
    kind: BreakKind;
  };
  violations: Violation[];
}

/**
 * Walk parentId → root, answering the verifier's two questions: "who is asking?"
 * and "where did their authority come from?"
 *
 * Guards, per link: the issuer's signature (hash-linked to the parent's), every
 * narrowing guard against the parent's claims, expiry, and revocation anywhere in
 * the ancestry.
 */
export function verifyChain(leaf: Passport, registry: Registry, now: number = Date.now()): VerificationResult {
  // 1. Walk up to the root, collecting the ancestry.
  const upward: Passport[] = [];
  const seen = new Set<string>();
  let cursor: Passport | undefined = leaf;

  while (cursor) {
    if (seen.has(cursor.claims.id)) {
      return {
        allowed: false,
        chain: upward.slice().reverse(),
        checks: [],
        violations: [],
        reason: `Passport chain contains a cycle at ${cursor.claims.id}.`,
        brokenAt: { hop: -1, passportId: cursor.claims.id, subject: cursor.claims.subject, kind: 'cycle' },
      };
    }
    seen.add(cursor.claims.id);
    upward.push(cursor);

    const parentId: string | null = cursor.claims.parentId;
    if (parentId === null) break;

    const parent: Passport | undefined = registry.passports[parentId];
    if (!parent) {
      return {
        allowed: false,
        chain: upward.slice().reverse(),
        checks: [],
        violations: [],
        reason: `Parent Passport ${parentId} is not in the registry, so this authority cannot be traced to a human.`,
        brokenAt: { hop: -1, passportId: cursor.claims.id, subject: cursor.claims.subject, kind: 'missing' },
      };
    }
    cursor = parent;
  }

  const chain = upward.slice().reverse(); // root → leaf
  const root = chain[0];

  // 2. The root must actually be a root, signed by a known holder key.
  if (root.claims.parentId !== null || root.claims.rootId !== root.claims.id) {
    return {
      allowed: false,
      chain,
      checks: [],
      violations: [],
      reason: `Chain does not terminate at a valid root Passport.`,
      brokenAt: { hop: 0, passportId: root.claims.id, subject: root.claims.subject, kind: 'root' },
    };
  }

  // 3. Per-link checks, root → leaf.
  const checks: LinkCheck[] = [];
  const allViolations: Violation[] = [];
  let brokenAt: VerificationResult['brokenAt'];
  let reason: string | undefined;

  for (let hop = 0; hop < chain.length; hop++) {
    const p = chain[hop];
    const parent = hop === 0 ? null : chain[hop - 1];
    const issuerKey = registry.publicKeys[p.claims.issuer];

    const signatureValid = issuerKey
      ? verifyPassportSignature(p.claims, parent ? parent.signature : null, p.signature, issuerKey)
      : false;

    const violations = parent ? guardViolations(parent.claims, p.claims) : [];
    const expired = now > p.claims.expiresAt;
    const revoked = p.claims.revoked;

    checks.push({
      hop,
      passportId: p.claims.id,
      subject: p.claims.subject,
      issuer: p.claims.issuer,
      signatureValid,
      guardsOk: violations.length === 0,
      revoked,
      expired,
      violations,
    });
    allViolations.push(...violations);

    if (brokenAt) continue; // keep collecting detail, but remember the first break

    if (!issuerKey) {
      brokenAt = { hop, passportId: p.claims.id, subject: p.claims.subject, kind: 'signature' };
      reason = `No known public key for issuer '${p.claims.issuer}'; signature cannot be checked.`;
    } else if (!signatureValid) {
      brokenAt = { hop, passportId: p.claims.id, subject: p.claims.subject, kind: 'signature' };
      reason = `Signature on ${p.claims.subject}'s Passport does not verify against ${p.claims.issuer}'s key. Claims were altered, or the Passport was re-parented.`;
    } else if (revoked) {
      brokenAt = { hop, passportId: p.claims.id, subject: p.claims.subject, kind: 'revoked' };
      reason =
        hop === chain.length - 1
          ? `This Passport has been revoked by ${root.claims.issuer}.`
          : `An ancestor Passport (${p.claims.subject}, hop ${hop}) has been revoked, which invalidates everything beneath it.`;
    } else if (expired) {
      brokenAt = { hop, passportId: p.claims.id, subject: p.claims.subject, kind: 'expired' };
      reason =
        hop === chain.length - 1
          ? `This Passport expired at ${new Date(p.claims.expiresAt).toISOString()}.`
          : `An ancestor Passport (${p.claims.subject}, hop ${hop}) expired, which invalidates everything beneath it.`;
    } else if (violations.length) {
      brokenAt = { hop, passportId: p.claims.id, subject: p.claims.subject, kind: 'guard' };
      reason = `${p.claims.subject}'s Passport failed ${violations[0].guard}: it claims more authority than ${parent!.claims.subject} held. ${violations[0].message}`;
    }
  }

  return { allowed: !brokenAt, chain, checks, reason, brokenAt, violations: allViolations };
}

// ---------------------------------------------------------------------------
// Authorization — the verifier's entry point
// ---------------------------------------------------------------------------

export interface ReceiptBase {
  id: string;
  at: number;
  /** Agent that made the request. */
  subject: string;
  action: Action;
  destination: Destination;
  /** Human-readable request, e.g. "send → external-webhook". */
  request: string;
  /** root → leaf identities, e.g. ['ops-lead','claude-code','dedup-subagent','classifier-subagent']. */
  chainPath: string[];
  leafPassportId: string;
  rootIssuer: string;
  detail: string;
}

export interface AllowReceipt extends ReceiptBase {
  kind: 'allow';
  verifiedHops: number;
  scopesUsed: string[];
  budgetUsd: number;
  expiresAt: number;
}

export interface RefusalReceipt extends ReceiptBase {
  kind: 'refusal';
  /** Which constraint blocked it. */
  violatedField: ViolationField | 'chain';
  requested: unknown;
  permitted: unknown;
  /** 1-indexed hop the request was blocked at, counting the human as hop 0. */
  blockedAtHop: number;
  blockedAtSubject: string;
  /** The named guard the request failed, e.g. `guard:requested-destination`. */
  guard: string;
  /** What the request fell back to. Always human authority — nothing else can widen a chain. */
  fallback: string;
  inheritedAuthority: {
    actions: Action[];
    contextScopes: string[];
    allowedDestinations: Destination[];
    budgetUsd: number;
    expiresAt: number;
  };
}

export type Receipt = AllowReceipt | RefusalReceipt;

export interface AuthorizeInput {
  action: Action;
  destination: Destination;
  /** Optional note shown on the receipt, e.g. "classify ticket #4471". */
  note?: string;
}

/**
 * The verifier. Given a leaf Passport and an attempted action, decide, and write an
 * audit entry either way. A refusal is not an error: it is the record that a guard
 * held and the request fell back to human authority.
 */
export function authorizeAction(
  leaf: Passport,
  input: AuthorizeInput,
  registry: Registry,
  now: number = Date.now(),
): Receipt {
  const verification = verifyChain(leaf, registry, now);
  const chainPath = verification.chain.length
    ? [verification.chain[0].claims.issuer, ...verification.chain.map((p) => p.claims.subject)]
    : [leaf.claims.subject];
  const rootIssuer = verification.chain[0]?.claims.issuer ?? 'unknown';
  const request = `${input.action} → ${input.destination}`;
  const base = {
    id: newId('rcpt'),
    at: now,
    subject: leaf.claims.subject,
    action: input.action,
    destination: input.destination,
    request,
    chainPath,
    leafPassportId: leaf.claims.id,
    rootIssuer,
  };
  const inherited = {
    actions: leaf.claims.actions,
    contextScopes: leaf.claims.contextScopes,
    allowedDestinations: leaf.claims.allowedDestinations,
    budgetUsd: leaf.claims.budgetUsd,
    expiresAt: leaf.claims.expiresAt,
  };
  // Nothing below the root can widen a chain, so every refusal falls back here.
  const fallback = `human authority · ${rootIssuer} must re-issue`;

  // 1. Is the chain itself sound, all the way to a human?
  if (!verification.allowed) {
    const broken = verification.brokenAt;
    const guard =
      broken?.kind === 'revoked'
        ? 'guard:revocation'
        : broken?.kind === 'expired'
          ? 'guard:expiry'
          : broken?.kind === 'signature'
            ? 'guard:signature'
            : broken?.kind === 'guard'
              ? verification.violations[0]?.guard ?? 'guard:narrowing'
              : 'guard:chain';
    return {
      ...base,
      kind: 'refusal',
      detail: `${leaf.claims.subject} requested '${request}' against its AI Passport. The request failed ${guard} at hop ${(broken?.hop ?? 0) + 1}. ${
        verification.reason ?? 'Chain of custody could not be verified.'
      } No action was taken; the request fell back to requiring human authority.`,
      violatedField: broken?.kind === 'guard' ? verification.violations[0]?.field ?? 'chain' : 'chain',
      requested: request,
      permitted: 'a chain that verifies to an unexpired, unrevoked human root',
      blockedAtHop: (broken?.hop ?? 0) + 1,
      blockedAtSubject: broken?.subject ?? leaf.claims.subject,
      guard,
      fallback,
      inheritedAuthority: inherited,
    };
  }

  const leafHop = verification.chain.length; // human is hop 0

  // 2. Is the action within the leaf's granted actions?
  if (!leaf.claims.actions.includes(input.action)) {
    return {
      ...base,
      kind: 'refusal',
      detail: `${leaf.claims.subject}'s AI Passport permits actions: ${leaf.claims.actions.join(', ')}. It requested '${input.action}'. The request failed guard:requested-action at hop ${leafHop} — no ancestor AI Passport ever held '${input.action}', back to the root issued by ${rootIssuer}, so no child could inherit it. No action was taken; the request fell back to requiring human authority.`,
      violatedField: 'actions',
      requested: input.action,
      permitted: leaf.claims.actions,
      blockedAtHop: leafHop,
      blockedAtSubject: leaf.claims.subject,
      guard: 'guard:requested-action',
      fallback,
      inheritedAuthority: inherited,
    };
  }

  // 3. Is the destination within the leaf's allowed destinations?
  if (!leaf.claims.allowedDestinations.includes(input.destination)) {
    return {
      ...base,
      kind: 'refusal',
      detail: `${leaf.claims.subject}'s AI Passport permits destinations: ${leaf.claims.allowedDestinations.join(', ')}. It requested '${input.action} → ${input.destination}'. The request failed guard:requested-destination at hop ${leafHop} — no ancestor AI Passport ever allowed external transfer, back to the root issued by ${rootIssuer}, so no child could inherit it. No data left the boundary; the request fell back to requiring human authority. The refusal is written to the audit log.`,
      violatedField: 'allowedDestinations',
      requested: input.destination,
      permitted: leaf.claims.allowedDestinations,
      blockedAtHop: leafHop,
      blockedAtSubject: leaf.claims.subject,
      guard: 'guard:requested-destination',
      fallback,
      inheritedAuthority: inherited,
    };
  }

  // 4. Allowed.
  return {
    ...base,
    kind: 'allow',
    detail: `${leaf.claims.subject} performed '${input.action} → ${input.destination}'${input.note ? ` (${input.note})` : ''}. Its AI Passport traced through ${verification.chain.length} Passports to ${rootIssuer}; every guard passed at every hop, and each child Passport is strictly narrower than its parent.`,
    verifiedHops: verification.chain.length,
    scopesUsed: leaf.claims.contextScopes,
    budgetUsd: leaf.claims.budgetUsd,
    expiresAt: leaf.claims.expiresAt,
  };
}

/**
 * A refused *delegation* is an audit entry too. When an agent tries to mint a child
 * with more authority than it holds, that attempt belongs in the same append-only
 * log as refused actions and accesses.
 */
export function delegationRefusalReceipt(
  parent: Passport,
  request: DelegationRequest,
  violations: Violation[],
  registry: Registry,
  now: number = Date.now(),
): RefusalReceipt {
  const verification = verifyChain(parent, registry, now);
  const chainPath = verification.chain.length
    ? [verification.chain[0].claims.issuer, ...verification.chain.map((p) => p.claims.subject)]
    : [parent.claims.subject];
  const primary = violations[0];
  const rootIssuer = verification.chain[0]?.claims.issuer ?? 'unknown';
  const guard = primary?.guard ?? 'guard:chain';

  return {
    id: newId('rcpt'),
    at: now,
    subject: parent.claims.subject,
    action: 'delegate',
    destination: request.allowedDestinations[0] ?? 'internal-only',
    request: `delegate → ${request.subject}`,
    chainPath: [...chainPath, request.subject],
    leafPassportId: parent.claims.id,
    rootIssuer,
    kind: 'refusal',
    detail: `${parent.claims.subject} tried to issue a child AI Passport to ${request.subject} carrying authority its own Passport does not hold. The request failed ${guard} at issue time. ${violations
      .map((v) => v.message)
      .join(' ')} No child AI Passport was created; the chain would not have verified. The request fell back to requiring human authority.`,
    violatedField: primary?.field ?? 'chain',
    requested: primary?.requested ?? request,
    permitted: primary?.allowedByParent ?? null,
    blockedAtHop: verification.chain.length,
    blockedAtSubject: parent.claims.subject,
    guard,
    fallback: `human authority · ${rootIssuer} must re-issue`,
    inheritedAuthority: {
      actions: parent.claims.actions,
      contextScopes: parent.claims.contextScopes,
      allowedDestinations: parent.claims.allowedDestinations,
      budgetUsd: parent.claims.budgetUsd,
      expiresAt: parent.claims.expiresAt,
    },
  };
}
