import { describe, expect, it } from 'vitest';
import { deterministicKeyPair } from './crypto';
import {
  Passport,
  PassportClaims,
  authorizeAction,
  delegate,
  issueRoot,
  putPassport,
  registerKey,
  revoke,
  signPassportClaims,
  verifyChain,
} from './passport';
import { HOUR, buildSeed } from './seed';

const NOW = 1_700_000_000_000;

describe('the narrowing invariant', () => {
  it('accepts a child that is strictly narrower than its parent', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_agent_b'];

    const result = delegate(
      parent,
      {
        subject: 'agent-x',
        task: 'narrower work',
        actions: ['read'],
        contextScopes: ['ticket.text.anonymized'],
        allowedDestinations: ['internal-only'],
        budgetUsd: 1,
        expiresAt: NOW + HOUR,
        canDelegate: false,
        maxDepth: 0,
      },
      keys['agent-b'],
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects a child asking for a destination its parent never held', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_agent_b'];

    const result = delegate(
      parent,
      {
        subject: 'agent-x',
        task: 'enrich via a third party',
        actions: ['read'],
        contextScopes: ['ticket.text'],
        allowedDestinations: ['internal-only', 'external-webhook'],
        budgetUsd: 1,
        expiresAt: NOW + HOUR,
        canDelegate: false,
        maxDepth: 0,
      },
      keys['agent-b'],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const violation = result.violations.find((v) => v.field === 'allowedDestinations');
    expect(violation).toBeDefined();
    expect(violation!.requested).toContain('external-webhook');
    expect(violation!.allowedByParent).toEqual(['internal-only']);
  });

  it('rejects a child asking for a bigger budget, a later expiry, or extra actions', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_agent_b']; // $20, +12h, no 'write'

    const result = delegate(
      parent,
      {
        subject: 'agent-x',
        task: 'do more',
        actions: ['read', 'write'],
        contextScopes: ['ticket.text'],
        allowedDestinations: ['internal-only'],
        budgetUsd: 500,
        expiresAt: NOW + 48 * HOUR,
        canDelegate: false,
        maxDepth: 0,
      },
      keys['agent-b'],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = result.violations.map((v) => v.field);
    expect(fields).toContain('actions');
    expect(fields).toContain('budgetUsd');
    expect(fields).toContain('expiresAt');
  });

  it('rejects context outside the parent scope but allows narrowing into a sub-scope', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_agent_b']; // holds ['ticket.text']

    const sideways = delegate(
      parent,
      {
        subject: 'agent-x',
        task: 'read PII',
        actions: ['read'],
        contextScopes: ['ticket.customer.pii'],
        allowedDestinations: ['internal-only'],
        budgetUsd: 1,
        expiresAt: NOW + HOUR,
        canDelegate: false,
        maxDepth: 0,
      },
      keys['agent-b'],
      NOW,
    );
    expect(sideways.ok).toBe(false);

    const narrower = delegate(
      parent,
      {
        subject: 'agent-x',
        task: 'read redacted text',
        actions: ['read'],
        contextScopes: ['ticket.text.anonymized'],
        allowedDestinations: ['internal-only'],
        budgetUsd: 1,
        expiresAt: NOW + HOUR,
        canDelegate: false,
        maxDepth: 0,
      },
      keys['agent-b'],
      NOW,
    );
    expect(narrower.ok).toBe(true);
  });

  it('refuses delegation from a Passport that cannot delegate, and enforces depth', () => {
    const { registry, keys } = buildSeed(NOW);
    const leaf = registry.passports['psp_agent_c']; // canDelegate: false, maxDepth: 0

    const result = delegate(
      leaf,
      {
        subject: 'agent-z',
        task: 'sub-sub-work',
        actions: ['read'],
        contextScopes: ['ticket.text.anonymized'],
        allowedDestinations: ['internal-only'],
        budgetUsd: 1,
        expiresAt: NOW + HOUR,
        canDelegate: false,
        maxDepth: 0,
      },
      keys['agent-c'],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((v) => v.field)).toContain('canDelegate');
    expect(result.violations.map((v) => v.field)).toContain('maxDepth');
  });

  it('only lets the agent that holds a Passport delegate from it', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_agent_b'];

    const result = delegate(
      parent,
      {
        subject: 'agent-x',
        task: 'impersonated delegation',
        actions: ['read'],
        contextScopes: ['ticket.text'],
        allowedDestinations: ['internal-only'],
        budgetUsd: 1,
        expiresAt: NOW + HOUR,
        canDelegate: false,
        maxDepth: 0,
      },
      keys['agent-d'], // Agent D does not hold Agent B's Passport
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((v) => v.field)).toContain('issuer');
  });
});

describe('verifyChain', () => {
  it('verifies the seeded chain to the human root', () => {
    const { registry } = buildSeed(NOW);
    const result = verifyChain(registry.passports['psp_agent_c'], registry, NOW);

    expect(result.allowed).toBe(true);
    expect(result.chain.map((p) => p.claims.subject)).toEqual(['agent-a', 'agent-b', 'agent-c']);
    expect(result.chain[0].claims.issuer).toBe('ops-lead');
    expect(result.violations).toHaveLength(0);
  });

  it('catches a hand-crafted Passport that was widened after minting', () => {
    const { registry } = buildSeed(NOW);
    const original = registry.passports['psp_agent_c'];

    // An agent edits its own claims to grant itself external transfer, keeping the
    // signature it was issued. Signature no longer covers these claims.
    const forged: Passport = {
      ...original,
      claims: { ...original.claims, allowedDestinations: ['internal-only', 'external-webhook'] },
    };
    const tampered = putPassport(registry, forged);

    const result = verifyChain(forged, tampered, NOW);
    expect(result.allowed).toBe(false);
    expect(result.brokenAt?.kind).toBe('signature');
  });

  it('catches a validly-signed Passport that exceeds its parent', () => {
    // Agent B mints its own root-less "child" with real signing keys but broader
    // authority, then presents it. Verification re-derives the invariant and fails.
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_agent_b'];
    const forgedClaims: PassportClaims = {
      id: 'psp_forged',
      parentId: parent.claims.id,
      rootId: parent.claims.rootId,
      issuer: 'agent-b',
      subject: 'agent-c',
      task: 'laundered authority',
      actions: ['read', 'send'],
      contextScopes: ['ticket.text'],
      allowedDestinations: ['internal-only', 'external-webhook'],
      budgetUsd: 999,
      issuedAt: NOW,
      expiresAt: NOW + 12 * HOUR,
      canDelegate: false,
      maxDepth: 0,
      revoked: false,
    };
    // Sign it properly — the signature will be valid, the authority will not.
    const forged: Passport = {
      claims: forgedClaims,
      signature: signPassportClaims(forgedClaims, parent.signature, keys['agent-b'].privateKeyHex),
    };

    const withForged = putPassport(registry, forged);
    const result = verifyChain(forged, withForged, NOW);

    expect(result.allowed).toBe(false);
    expect(result.brokenAt?.kind).toBe('narrowing');
    expect(result.violations.map((v) => v.field)).toContain('allowedDestinations');
  });

  it('fails a chain whose Passport has expired', () => {
    const { registry } = buildSeed(NOW);
    const result = verifyChain(registry.passports['psp_agent_c'], registry, NOW + 7 * HOUR);
    expect(result.allowed).toBe(false);
    expect(result.brokenAt?.kind).toBe('expired');
  });

  it('fails a chain that cannot be traced to a root', () => {
    const { registry } = buildSeed(NOW);
    const orphaned = { ...registry, passports: { ...registry.passports } };
    delete orphaned.passports['psp_agent_b'];

    const result = verifyChain(registry.passports['psp_agent_c'], orphaned, NOW);
    expect(result.allowed).toBe(false);
    expect(result.brokenAt?.kind).toBe('missing');
  });

  it('rejects a Passport signed by a key the verifier does not know', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_agent_b'];
    const rogue = deterministicKeyPair('agent-rogue');
    const minted = delegate(
      parent,
      {
        subject: 'agent-rogue-child',
        task: 'work for a stranger',
        actions: ['read'],
        contextScopes: ['ticket.text'],
        allowedDestinations: ['internal-only'],
        budgetUsd: 1,
        expiresAt: NOW + HOUR,
        canDelegate: false,
        maxDepth: 0,
      },
      keys['agent-b'],
      NOW,
    );
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;

    // Strip Agent B's key from the verifier's anchor set.
    const withoutB = { ...registry, publicKeys: { ...registry.publicKeys } };
    delete withoutB.publicKeys['agent-b'];
    const result = verifyChain(minted.child, putPassport(withoutB, minted.child), NOW);

    expect(result.allowed).toBe(false);
    expect(result.brokenAt?.kind).toBe('signature');
    void rogue;
  });
});

describe('revocation cascades to descendants only', () => {
  it('revoking the root kills every branch', () => {
    const { registry } = buildSeed(NOW);
    const after = revoke('psp_root_ops_lead', registry);

    for (const id of ['psp_root_ops_lead', 'psp_agent_b', 'psp_agent_c', 'psp_agent_d', 'psp_agent_e']) {
      expect(verifyChain(after.passports[id], after, NOW).allowed).toBe(false);
    }
  });

  it("revoking Agent B's Passport invalidates B and C but leaves D and E working", () => {
    const { registry } = buildSeed(NOW);
    const after = revoke('psp_agent_b', registry);

    expect(verifyChain(after.passports['psp_agent_b'], after, NOW).allowed).toBe(false);
    expect(verifyChain(after.passports['psp_agent_c'], after, NOW).allowed).toBe(false);

    expect(verifyChain(after.passports['psp_agent_d'], after, NOW).allowed).toBe(true);
    expect(verifyChain(after.passports['psp_agent_e'], after, NOW).allowed).toBe(true);
    expect(verifyChain(after.passports['psp_root_ops_lead'], after, NOW).allowed).toBe(true);
  });

  it("names the revoked ancestor when a descendant is checked", () => {
    const { registry } = buildSeed(NOW);
    const after = revoke('psp_agent_b', registry);
    const result = verifyChain(after.passports['psp_agent_c'], after, NOW);

    expect(result.brokenAt?.subject).toBe('agent-b');
    expect(result.brokenAt?.kind).toBe('revoked');
  });
});

describe('authorizeAction receipts', () => {
  it('allows the internal classification and traces authority to the human', () => {
    const { registry } = buildSeed(NOW);
    const receipt = authorizeAction(
      registry.passports['psp_agent_c'],
      { action: 'classify', destination: 'internal-only', note: 'ticket #4471' },
      registry,
      NOW,
    );

    expect(receipt.kind).toBe('allow');
    expect(receipt.chainPath).toEqual(['ops-lead', 'agent-a', 'agent-b', 'agent-c']);
    expect(receipt.rootIssuer).toBe('ops-lead');
  });

  it('refuses the external send and says exactly which constraint blocked it', () => {
    const { registry } = buildSeed(NOW);
    const receipt = authorizeAction(
      registry.passports['psp_agent_c'],
      { action: 'send', destination: 'external-webhook' },
      registry,
      NOW,
    );

    expect(receipt.kind).toBe('refusal');
    if (receipt.kind !== 'refusal') return;
    // Agent C legitimately holds 'send', so the DESTINATION is what stops it — the
    // human allowed sending, but never externally, and no hop could add that.
    expect(receipt.violatedField).toBe('allowedDestinations');
    expect(receipt.checkName).toBe('destination check');
    expect(receipt.blockedAtHop).toBe(3);
    expect(receipt.blockedAtSubject).toBe('agent-c');
    expect(receipt.permitted).toEqual(['internal-only']);
    expect(receipt.inheritedAuthority.allowedDestinations).toEqual(['internal-only']);
    expect(receipt.rootIssuer).toBe('ops-lead');
    expect(receipt.detail).toContain('never allowed external transfer');
  });

  it('refuses an action the leaf gave up on the way down', () => {
    const { registry } = buildSeed(NOW);
    // Agent D dropped 'classify' when it was delegated to; asking for it now fails
    // the action check even though its parent Agent A held it.
    const receipt = authorizeAction(
      registry.passports['psp_agent_d'],
      { action: 'classify', destination: 'internal-only' },
      registry,
      NOW,
    );

    expect(receipt.kind).toBe('refusal');
    if (receipt.kind !== 'refusal') return;
    expect(receipt.violatedField).toBe('actions');
    expect(receipt.checkName).toBe('action check');
    expect(registry.passports['psp_root_ops_lead'].claims.actions).toContain('classify');
  });

  it('allows the same send action when it stays internal', () => {
    const { registry } = buildSeed(NOW);
    const receipt = authorizeAction(
      registry.passports['psp_agent_c'],
      { action: 'send', destination: 'internal-only' },
      registry,
      NOW,
    );

    // Same verb, same agent, same chain — only the destination differs.
    expect(receipt.kind).toBe('allow');
  });

  it('refuses everything on a revoked branch, naming the revocation', () => {
    const { registry } = buildSeed(NOW);
    const after = revoke('psp_agent_b', registry);
    const receipt = authorizeAction(
      after.passports['psp_agent_c'],
      { action: 'classify', destination: 'internal-only' },
      after,
      NOW,
    );

    expect(receipt.kind).toBe('refusal');
    if (receipt.kind !== 'refusal') return;
    expect(receipt.checkName).toBe('revocation check');
  });
});

describe('seed integrity', () => {
  it('produces five Passports that each verify, and gets narrower every hop', () => {
    const { registry } = buildSeed(NOW);
    expect(Object.keys(registry.passports)).toHaveLength(5);

    const chain = verifyChain(registry.passports['psp_agent_c'], registry, NOW).chain;
    const budgets = chain.map((p) => p.claims.budgetUsd);
    const expiries = chain.map((p) => p.claims.expiresAt);
    const scopeCounts = chain.map((p) => p.claims.contextScopes.length);

    expect(budgets).toEqual([...budgets].sort((a, b) => b - a));
    expect(expiries).toEqual([...expiries].sort((a, b) => b - a));
    expect(scopeCounts[0]).toBeGreaterThan(scopeCounts[scopeCounts.length - 1]);
  });
});
