/**
 * The verifier, as a separate service.
 *
 * It holds no secrets and trusts nothing it is told about authority. It receives
 * the public registry (Passports + issuer public keys) and a requested action,
 * then walks the chain backwards to the human root to answer two questions:
 * "who is asking?" and "where did their authority come from?"
 *
 * Note what it does NOT do: take the leaf agent's word for its own permissions.
 * Every hop's signature and every guard is re-derived here.
 */
import { NextResponse } from 'next/server';
import { Action, Destination, Registry, authorizeAction, verifyChain } from '@/lib/passport';

interface VerifyRequest {
  registry: Registry;
  leafPassportId: string;
  action: Action;
  destination: Destination;
  note?: string;
}

export async function POST(request: Request) {
  let body: VerifyRequest;
  try {
    body = (await request.json()) as VerifyRequest;
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const { registry, leafPassportId, action, destination, note } = body ?? {};
  if (!registry?.passports || !leafPassportId || !action || !destination) {
    return NextResponse.json(
      { error: 'Expected { registry, leafPassportId, action, destination }.' },
      { status: 400 },
    );
  }

  const leaf = registry.passports[leafPassportId];
  if (!leaf) {
    return NextResponse.json({ error: `Unknown Passport ${leafPassportId}.` }, { status: 404 });
  }

  const now = Date.now();
  const receipt = authorizeAction(leaf, { action, destination, note }, registry, now);
  const verification = verifyChain(leaf, registry, now);

  return NextResponse.json({
    receipt,
    verification: {
      allowed: verification.allowed,
      reason: verification.reason,
      brokenAt: verification.brokenAt,
      hops: verification.chain.length,
      path: verification.chain.map((p) => p.claims.subject),
    },
    verifiedBy: 'chain-of-custody verifier (/api/verify)',
    at: now,
  });
}

export async function GET() {
  return NextResponse.json({
    service: 'chain-of-custody verifier',
    accepts: 'POST { registry, leafPassportId, action, destination }',
    guards: [
      'guard:signature — Ed25519 on every Passport, hash-linked to its parent',
      'guard:actions, guard:context, guard:destinations, guard:budget, guard:depth — child ⊆ parent, re-derived at every hop',
      'guard:expiry — every Passport in the ancestry',
      'guard:revocation — every Passport in the ancestry',
      'guard:requested-action, guard:requested-destination — the request against the leaf Passport',
    ],
    onFailure: 'refusal written to the append-only audit log; request falls back to requiring human authority',
  });
}
