/**
 * Real Ed25519 signing for AI Passports. Zero React imports — this is SDK code.
 *
 * Keys live in memory only (they die on reload, like a demo should). Each Passport
 * is signed by its ISSUER over a canonical serialization of its claims *plus the
 * parent's signature*, which hash-links every child to its parent: you cannot
 * re-parent a Passport, and you cannot edit a claim, without invalidating the
 * signature. That is what makes the chain tamper-evident rather than merely
 * self-described.
 */
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';

// @noble/ed25519 v2 keeps hashing pluggable so it stays dependency-free.
// Wiring sha512 lets us sign/verify synchronously, which keeps verification
// callable straight from a React render pass.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export interface KeyPair {
  /** Agent or holder identifier this key belongs to, e.g. 'classifier-subagent'. */
  id: string;
  privateKeyHex: string;
  publicKeyHex: string;
}

export const bytesToHex = ed.etc.bytesToHex;
export const hexToBytes = ed.etc.hexToBytes;

export function generateKeyPair(id: string): KeyPair {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return { id, privateKeyHex: bytesToHex(priv), publicKeyHex: bytesToHex(pub) };
}

/**
 * Deterministic key material derived from a label. Used by the seed so the demo
 * is reproducible and so unit tests do not depend on randomness.
 */
export function deterministicKeyPair(id: string, salt = 'chain-of-custody/v1'): KeyPair {
  const priv = sha256(new TextEncoder().encode(`${salt}:${id}`));
  const pub = ed.getPublicKey(priv);
  return { id, privateKeyHex: bytesToHex(priv), publicKeyHex: bytesToHex(pub) };
}

/**
 * Stable JSON: object keys sorted recursively, so the exact same claims always
 * produce the exact same signing input regardless of property insertion order.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}

/** The bytes an issuer actually signs: canonical claims, hash-linked to the parent signature. */
export function signingInput(claims: unknown, parentSignature: string | null): Uint8Array {
  const message = `aipassport/v1\n${canonicalize(claims)}\n${parentSignature ?? 'ROOT'}`;
  return sha256(new TextEncoder().encode(message));
}

export function sign(claims: unknown, parentSignature: string | null, privateKeyHex: string): string {
  return bytesToHex(ed.sign(signingInput(claims, parentSignature), hexToBytes(privateKeyHex)));
}

export function verifySignature(
  claims: unknown,
  parentSignature: string | null,
  signature: string,
  publicKeyHex: string,
): boolean {
  try {
    return ed.verify(hexToBytes(signature), signingInput(claims, parentSignature), hexToBytes(publicKeyHex));
  } catch {
    // Malformed hex, wrong length, non-canonical point: all just "does not verify".
    return false;
  }
}

/** Short display form for signatures and keys: 3f9a1c…7b2e */
export function truncateHex(hex: string, head = 8, tail = 6): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** Small, dependency-free id generator. crypto.randomUUID where available. */
export function newId(prefix = 'psp'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid =
    g.crypto?.randomUUID?.() ??
    bytesToHex(ed.utils.randomPrivateKey()).slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  return `${prefix}_${uuid}`;
}
