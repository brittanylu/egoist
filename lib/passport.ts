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
 * Authority is monotonically non-increasing down the chain, field by field. The
 * check lives in `narrowingViolations()` and is called from BOTH `delegate()`
 * (mint time) and `verifyChain()` (verify time), so narrowing is structural, not
 * advisory: an agent that hand-crafts a broader Passport still fails verification,
 * because the verifier re-derives the invariant itself rather than trusting the
 * minter.
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

/** Every field the narrowing invariant guards. Used to route UI copy. */
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

export interface Violation {
  field: ViolationField;
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
// The invariant
// ---------------------------------------------------------------------------

/**
 * The single source of truth for "is this child within its parent's authority?"
 * Pure and time-independent: liveness (expiry/revocation at a given instant) is
 * checked separately, because a chain that was validly narrowed can still be dead.
 */
export function narrowingViolations(
  parent: PassportClaims,
  child: Omit<PassportClaims, 'id' | 'issuedAt' | 'revoked'> & Partial<Pick<PassportClaims, 'id'>>,
): Violation[] {
  const v: Violation[] = [];

  // Only the agent that HOLDS a Passport may delegate from it.
  if (child.issuer !== parent.subject) {
    v.push({
      field: 'issuer',
      requested: child.issuer,
      allowedByParent: parent.subject,
      message: `Only ${parent.subject} holds this Passport, so only ${parent.subject} can delegate from it. Signed by ${child.issuer}.`,
    });
  }

  if (child.rootId !== parent.rootId) {
    v.push({
      field: 'rootId',
      requested: child.rootId,
      allowedByParent: parent.rootId,
      message: `Child claims a different root of authority than its parent.`,
    });
  }

  if (!parent.canDelegate) {
    v.push({
      field: 'canDelegate',
      requested: 'delegate',
      allowedByParent: 'canDelegate: false',
      message: `${parent.subject}'s Passport does not permit delegation at all.`,
    });
  }

  if (!parent.actions.includes('delegate')) {
    v.push({
      field: 'actions',
      requested: 'delegate',
      allowedByParent: parent.actions,
      message: `${parent.subject} was not granted the 'delegate' action.`,
    });
  }

  // actions ⊆ parent.actions
  const extraActions = isSubset(child.actions, parent.actions);
  if (extraActions.length) {
    v.push({
      field: 'actions',
      requested: child.actions,
      allowedByParent: parent.actions,
      message: `Requests actions its parent never held: ${extraActions.join(', ')}.`,
    });
  }

  // contextScopes ⊆ parent.contextScopes (hierarchically)
  const extraScopes = uncoveredScopes(child.contextScopes, parent.contextScopes);
  if (extraScopes.length) {
    v.push({
      field: 'contextScopes',
      requested: child.contextScopes,
      allowedByParent: parent.contextScopes,
      message: `Requests context outside its parent's scope: ${extraScopes.join(', ')}.`,
    });
  }

  // allowedDestinations ⊆ parent.allowedDestinations
  const extraDestinations = isSubset(child.allowedDestinations, parent.allowedDestinations);
  if (extraDestinations.length) {
    v.push({
      field: 'allowedDestinations',
      requested: child.allowedDestinations,
      allowedByParent: parent.allowedDestinations,
      message: `Requests destinations its parent never held: ${extraDestinations.join(', ')}.`,
    });
  }

  // budget ≤ parent budget
  if (child.budgetUsd > parent.budgetUsd) {
    v.push({
      field: 'budgetUsd',
      requested: child.budgetUsd,
      allowedByParent: parent.budgetUsd,
      message: `Requests $${child.budgetUsd} but its parent holds only $${parent.budgetUsd}.`,
    });
  }

  // expiry ≤ parent expiry
  if (child.expiresAt > parent.expiresAt) {
    v.push({
      field: 'expiresAt',
      requested: child.expiresAt,
      allowedByParent: parent.expiresAt,
      message: `Requests an expiry that outlives its parent's Passport.`,
    });
  }

  // depth: each hop consumes one unit of the remaining delegation allowance
  if (parent.maxDepth < 1) {
    v.push({
      field: 'maxDepth',
      requested: child.maxDepth,
      allowedByParent: parent.maxDepth,
      message: `Parent has no delegation hops left (maxDepth 0).`,
    });
  } else if (child.maxDepth > parent.maxDepth - 1) {
    v.push({
      field: 'maxDepth',
      requested: child.maxDepth,
      allowedByParent: parent.maxDepth - 1,
      message: `Requests ${child.maxDepth} further hops; at most ${parent.maxDepth - 1} remain below its parent.`,
    });
  }

  if (child.canDelegate && child.maxDepth < 1) {
    v.push({
      field: 'canDelegate',
      requested: true,
      allowedByParent: false,
      message: `Cannot both permit delegation and have zero hops remaining.`,
    });
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
 * Mint a child Passport. Rejects — structurally, with itemised violations — any
 * request that would carry more authority than the parent holds.
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

  const violations = narrowingViolations(parent.claims, childClaims);

  // Liveness of the parent at mint time: a dead Passport delegates nothing.
  if (parent.claims.revoked) {
    violations.push({
      field: 'issuer',
      requested: 'delegate from a revoked Passport',
      allowedByParent: 'revoked',
      message: `Parent Passport ${parent.claims.id} has been revoked.`,
    });
  }
  if (now > parent.claims.expiresAt) {
    violations.push({
      field: 'expiresAt',
      requested: childClaims.expiresAt,
      allowedByParent: parent.claims.expiresAt,
      message: `Parent Passport expired at ${new Date(parent.claims.expiresAt).toISOString()}.`,
    });
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

export type BreakKind = 'missing' | 'signature' | 'narrowing' | 'revoked' | 'expired' | 'root' | 'cycle';

export interface LinkCheck {
  hop: number; // 0 = root
  passportId: string;
  subject: string;
  issuer: string;
  signatureValid: boolean;
  narrowingOk: boolean;
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
 * Checks, per link: the issuer's signature (hash-linked to the parent's), the
 * narrowing invariant against the parent's claims, expiry, and revocation
 * anywhere in the ancestry.
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

    const violations = parent ? narrowingViolations(parent.claims, p.claims) : [];
    const expired = now > p.claims.expiresAt;
    const revoked = p.claims.revoked;

    checks.push({
      hop,
      passportId: p.claims.id,
      subject: p.claims.subject,
      issuer: p.claims.issuer,
      signatureValid,
      narrowingOk: violations.length === 0,
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
      brokenAt = { hop, passportId: p.claims.id, subject: p.claims.subject, kind: 'narrowing' };
      reason = `${p.claims.subject}'s Passport claims more authority than ${parent!.claims.subject} held: ${violations[0].message}`;
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
  /** root → leaf identities, e.g. ['ops-lead','agent-a','agent-b','agent-c']. */
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
  checkName: string;
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
 * The verifier. Given a leaf Passport and an attempted action, decide, and emit a
 * receipt either way. A refusal is not an error: it is a signed-off record that a
 * boundary set by a human held.
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

  // 1. Is the chain itself sound, all the way to a human?
  if (!verification.allowed) {
    const broken = verification.brokenAt;
    return {
      ...base,
      kind: 'refusal',
      detail: verification.reason ?? 'Chain of custody could not be verified.',
      violatedField: broken?.kind === 'narrowing' ? verification.violations[0]?.field ?? 'chain' : 'chain',
      requested: request,
      permitted: 'a chain that verifies to an unexpired, unrevoked human root',
      blockedAtHop: (broken?.hop ?? 0) + 1,
      blockedAtSubject: broken?.subject ?? leaf.claims.subject,
      checkName:
        broken?.kind === 'revoked'
          ? 'revocation check'
          : broken?.kind === 'expired'
            ? 'expiry check'
            : broken?.kind === 'signature'
              ? 'signature check'
              : broken?.kind === 'narrowing'
                ? 'narrowing check'
                : 'chain integrity check',
      inheritedAuthority: inherited,
    };
  }

  const leafHop = verification.chain.length; // human is hop 0

  // 2. Is the action within the leaf's granted actions?
  if (!leaf.claims.actions.includes(input.action)) {
    return {
      ...base,
      kind: 'refusal',
      detail: `${leaf.claims.subject} attempted '${input.action}'. Inherited authority permits actions: ${leaf.claims.actions.join(', ')}. The Passport issued by ${rootIssuer} never granted '${input.action}' on this chain. Request blocked at hop ${leafHop} (action check).`,
      violatedField: 'actions',
      requested: input.action,
      permitted: leaf.claims.actions,
      blockedAtHop: leafHop,
      blockedAtSubject: leaf.claims.subject,
      checkName: 'action check',
      inheritedAuthority: inherited,
    };
  }

  // 3. Is the destination within the leaf's allowed destinations?
  if (!leaf.claims.allowedDestinations.includes(input.destination)) {
    return {
      ...base,
      kind: 'refusal',
      detail: `${leaf.claims.subject} attempted '${input.action} → ${input.destination}'. Inherited authority permits destinations: ${leaf.claims.allowedDestinations.join(', ')}. The root Passport issued by ${rootIssuer} never allowed external transfer, so no descendant could acquire it. Request blocked at hop ${leafHop} (destination check). This refusal is logged as a receipt.`,
      violatedField: 'allowedDestinations',
      requested: input.destination,
      permitted: leaf.claims.allowedDestinations,
      blockedAtHop: leafHop,
      blockedAtSubject: leaf.claims.subject,
      checkName: 'destination check',
      inheritedAuthority: inherited,
    };
  }

  // 4. Allowed.
  return {
    ...base,
    kind: 'allow',
    detail: `${leaf.claims.subject} performed '${input.action} → ${input.destination}'${input.note ? ` (${input.note})` : ''}. Authority traced through ${verification.chain.length} Passports to ${rootIssuer}; every hop verified and strictly narrower than its parent.`,
    verifiedHops: verification.chain.length,
    scopesUsed: leaf.claims.contextScopes,
    budgetUsd: leaf.claims.budgetUsd,
    expiresAt: leaf.claims.expiresAt,
  };
}

/**
 * A refused *delegation* is a receipt too. When an agent tries to mint a child
 * with more authority than it holds, that attempt is worth recording in the same
 * append-only log as refused actions.
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

  return {
    id: newId('rcpt'),
    at: now,
    subject: parent.claims.subject,
    action: 'delegate',
    destination: request.allowedDestinations[0] ?? 'internal-only',
    request: `delegate → ${request.subject}`,
    chainPath: [...chainPath, request.subject],
    leafPassportId: parent.claims.id,
    rootIssuer: verification.chain[0]?.claims.issuer ?? 'unknown',
    kind: 'refusal',
    detail: `${parent.claims.subject} tried to mint a Passport for ${request.subject} carrying authority it does not hold. ${violations
      .map((v) => v.message)
      .join(' ')} No Passport was created; the chain would not have verified.`,
    violatedField: primary?.field ?? 'chain',
    requested: primary?.requested ?? request,
    permitted: primary?.allowedByParent ?? null,
    blockedAtHop: verification.chain.length,
    blockedAtSubject: parent.claims.subject,
    checkName: 'narrowing check (at mint time)',
    inheritedAuthority: {
      actions: parent.claims.actions,
      contextScopes: parent.claims.contextScopes,
      allowedDestinations: parent.claims.allowedDestinations,
      budgetUsd: parent.claims.budgetUsd,
      expiresAt: parent.claims.expiresAt,
    },
  };
}
