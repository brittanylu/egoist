/**
 * Presentation-side derivations: how "wide" a Passport is, and time formatting.
 * Pure functions, no React — the UI reads these but the SDK does not depend on them.
 */
import { ALL_ACTIONS, ALL_DESTINATIONS, PassportClaims, VerificationResult } from './passport';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * The trust loop a Passport moves through, in order.
 *
 *   draft    proposed or not in force — nothing may be done under it
 *   active   signed, every guard passing, traceable to a live human root
 *   revoked  withdrawn or lapsed — it was in force, and no longer is
 *
 * A Passport only ever moves forward. Nothing returns to `active` on its own; the
 * holder has to issue again.
 */
export type Stage = 'draft' | 'active' | 'revoked';

export const STAGES: Stage[] = ['draft', 'active', 'revoked'];

export interface LifecycleState {
  stage: Stage;
  /** Terse cause, in guard/verifier terms. Empty when the stage says it all. */
  note: string;
}

/**
 * Where a Passport sits in the loop, derived — never stored.
 *
 * The split that matters: a Passport that fails a structural guard never reached
 * `active`, so it is still a `draft`. Only authority that was genuinely in force
 * can be `revoked`.
 */
export function lifecycleOf(claims: PassportClaims, verification: VerificationResult): LifecycleState {
  if (verification.allowed) return { stage: 'active', note: '' };

  const broken = verification.brokenAt;
  const self = broken?.passportId === claims.id;

  switch (broken?.kind) {
    case 'revoked':
      return { stage: 'revoked', note: self ? 'withdrawn by holder' : 'ancestor revoked' };
    case 'expired':
      return { stage: 'revoked', note: self ? 'expired' : 'ancestor expired' };
    case 'guard':
      return { stage: 'draft', note: `failed ${verification.violations[0]?.guard ?? 'a guard'}` };
    case 'signature':
      return { stage: 'draft', note: 'signature invalid' };
    default:
      return { stage: 'draft', note: 'no chain to a human root' };
  }
}

/**
 * A rough composite of how much authority a Passport carries: actions and
 * destinations against everything that exists, context/budget/time against the
 * root grant. Deliberately crude — it exists so the shrinking is *visible*, and it
 * is guaranteed non-increasing down a chain because every input is non-increasing.
 */
export function authorityWeight(claims: PassportClaims, root: PassportClaims): number {
  const ratio = (a: number, b: number) => (b <= 0 ? 0 : Math.min(1, a / b));
  const rootWindow = Math.max(1, root.expiresAt - root.issuedAt);

  const parts = [
    ratio(claims.actions.length, ALL_ACTIONS.length),
    ratio(claims.contextScopes.length, root.contextScopes.length),
    ratio(claims.allowedDestinations.length, ALL_DESTINATIONS.length),
    ratio(claims.budgetUsd, root.budgetUsd),
    ratio(claims.expiresAt - claims.issuedAt, rootWindow),
  ];
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/** Authority as a percentage of the root grant, for the bar on each node. */
export function authorityPercent(claims: PassportClaims, root: PassportClaims): number {
  const rootWeight = authorityWeight(root, root);
  if (rootWeight <= 0) return 0;
  return Math.round(Math.min(1, authorityWeight(claims, root) / rootWeight) * 100);
}

export function formatUsd(amount: number): string {
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

/** "6h 00m" / "12m 04s" / "expired" */
export function formatCountdown(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** "+24h" / "+30m" — the granted window, independent of the clock. */
export function formatWindow(claims: PassportClaims): string {
  const ms = claims.expiresAt - claims.issuedAt;
  const hours = ms / 3_600_000;
  if (hours >= 1) return `+${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  return `+${Math.round(ms / 60_000)}m`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Short scope label: ticket.customer.pii → customer.pii */
export function shortScope(scope: string): string {
  return scope.replace(/^ticket\./, '');
}

// ---------------------------------------------------------------------------
// MRZ — the signature, made visible
// ---------------------------------------------------------------------------

/**
 * The machine-readable zone across the bottom of a real passport, built the same way
 * ICAO 9303 builds one: fixed-width fields, `<` as filler, and a mod-10 check digit
 * over weights 7-3-1 so a single mistyped character fails arithmetic.
 *
 * Here the fields carry Passport claims instead of a person's details, and the
 * optional-data field carries the head of the issuer's Ed25519 signature. That is the
 * point of putting it on the card at all: the thing a verifier actually checks is a
 * 128-character hex signature, which is invisible in every other panel. This is the
 * one place it is legible as an object — and because the check digits are computed
 * from it, editing a claim visibly breaks the strip.
 *
 * Presentation only. Nothing verifies against these two lines; `verifyChain` verifies
 * against the real signature.
 */
const MRZ_LINE_LENGTH = 44;

function mrzCharValue(ch: string): number {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55; // A = 10 … Z = 35
  return 0; // '<' and anything else
}

/** ICAO 9303 check digit: weights cycle 7, 3, 1 across the field, mod 10. */
export function mrzCheckDigit(field: string): string {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += mrzCharValue(field[i]) * weights[i % 3];
  return String(sum % 10);
}

/** Uppercase, `<` for anything not A–Z0–9, clipped and padded to an exact width. */
function mrzField(text: string, length: number): string {
  const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '<');
  return cleaned.slice(0, length).padEnd(length, '<');
}

function mrzDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** Three-letter "issuing authority" per tier, in the slot a country code would hold. */
const MRZ_TIER: Record<string, string> = { human: 'HUM', agent: 'AGT', subagent: 'SUB' };

export interface Mrz {
  line1: string;
  line2: string;
}

export function buildMrz(claims: PassportClaims, signature: string, tier: string): Mrz {
  // Line 1: document type, issuing authority, then "granted to << issued by" in the
  // slot a real passport uses for surname << given names.
  const holders = mrzField(`${claims.subject}<<${claims.issuer}`, 39);
  const line1 = `P<${mrzField(MRZ_TIER[tier] ?? 'AGT', 3)}${holders}`;

  // Line 2: the numbered fields, each followed by its own check digit.
  const docNumber = mrzField(claims.id.replace(/^psp_/, ''), 9);
  const docCheck = mrzCheckDigit(docNumber);
  const issued = mrzDate(claims.issuedAt);
  const issuedCheck = mrzCheckDigit(issued);
  const expires = mrzDate(claims.expiresAt);
  const expiresCheck = mrzCheckDigit(expires);
  // Optional data: the head of the Ed25519 signature over these very claims.
  const optional = mrzField(signature.slice(0, 14), 14);
  const optionalCheck = mrzCheckDigit(optional);
  const composite = mrzCheckDigit(
    `${docNumber}${docCheck}${issued}${issuedCheck}${expires}${expiresCheck}${optional}${optionalCheck}`,
  );

  const authority = MRZ_TIER[tier] ?? 'AGT';
  // 9 + 1 + 3 + 6 + 1 + 1 + 6 + 1 + 14 + 1 + 1 = 44, the TD3 line-2 layout exactly.
  // The single character between the two dates is the tier, where a passport puts sex.
  const line2 =
    `${docNumber}${docCheck}` +
    `${authority}` +
    `${issued}${issuedCheck}` +
    `${authority[0]}` +
    `${expires}${expiresCheck}` +
    `${optional}${optionalCheck}${composite}`;

  return { line1: line1.slice(0, MRZ_LINE_LENGTH), line2: line2.slice(0, MRZ_LINE_LENGTH) };
}
