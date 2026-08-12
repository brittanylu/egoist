import { describe, expect, it } from 'vitest';
import { buildMrz, lifecycleOf, mrzCheckDigit } from './authority';
import { deterministicKeyPair } from './crypto';
import {
  Passport,
  PassportClaims,
  RefusalReceipt,
  authorizeAction,
  delegate,
  issueRoot,
  putPassport,
  registerKey,
  revoke,
  signPassportClaims,
  verifyChain,
} from './passport';
import { ACTOR_BY_ID, DEFAULT_TEMPLATE, HOUR, TASK_TEMPLATES, buildSeed } from './seed';
import { AuthorityForm } from './team';

const NOW = 1_700_000_000_000;

describe('the narrowing guards', () => {
  it('accepts a child that is strictly narrower than its parent', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_dedup'];

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
      keys['dedup-subagent'],
      NOW,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects a child asking for a destination its parent never held', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_dedup'];

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
      keys['dedup-subagent'],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const violation = result.violations.find((v) => v.field === 'allowedDestinations');
    expect(violation).toBeDefined();
    expect(violation!.guard).toBe('guard:destinations');
    expect(violation!.requested).toContain('external-webhook');
    expect(violation!.allowedByParent).toEqual(['internal-only']);
  });

  it('rejects a child asking for a bigger budget, a later expiry, or extra actions', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_dedup']; // $20, +12h, no 'write'

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
      keys['dedup-subagent'],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = result.violations.map((v) => v.field);
    expect(fields).toContain('actions');
    expect(fields).toContain('budgetUsd');
    expect(fields).toContain('expiresAt');
    expect(result.violations.map((v) => v.guard)).toEqual(
      expect.arrayContaining(['guard:actions', 'guard:budget', 'guard:expiry']),
    );
  });

  it('rejects context outside the parent scope but allows narrowing into a sub-scope', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_dedup']; // holds ['ticket.text']

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
      keys['dedup-subagent'],
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
      keys['dedup-subagent'],
      NOW,
    );
    expect(narrower.ok).toBe(true);
  });

  it('refuses delegation from a Passport that cannot delegate, and enforces depth', () => {
    const { registry, keys } = buildSeed(NOW);
    const leaf = registry.passports['psp_classifier']; // canDelegate: false, maxDepth: 0

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
      keys['classifier-subagent'],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.map((v) => v.field)).toContain('canDelegate');
    expect(result.violations.map((v) => v.field)).toContain('maxDepth');
  });

  it('only lets the agent that holds a Passport delegate from it', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_dedup'];

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
      keys['summarizer-subagent'], // the summarizer subagent does not hold the dedup subagent's Passport
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
    const result = verifyChain(registry.passports['psp_classifier'], registry, NOW);

    expect(result.allowed).toBe(true);
    expect(result.chain.map((p) => p.claims.subject)).toEqual(['claude-code', 'dedup-subagent', 'classifier-subagent']);
    expect(result.chain[0].claims.issuer).toBe('jordan-lee');
    expect(result.violations).toHaveLength(0);
  });

  it('catches a hand-crafted Passport that was widened after minting', () => {
    const { registry } = buildSeed(NOW);
    const original = registry.passports['psp_classifier'];

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

  it('catches a validly-signed Passport that exceeds its parent, naming the guard', () => {
    // the dedup subagent mints its own root-less "child" with real signing keys but broader
    // authority, then presents it. Verification re-derives the invariant and fails.
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_dedup'];
    const forgedClaims: PassportClaims = {
      id: 'psp_forged',
      parentId: parent.claims.id,
      rootId: parent.claims.rootId,
      issuer: 'dedup-subagent',
      subject: 'classifier-subagent',
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
      signature: signPassportClaims(forgedClaims, parent.signature, keys['dedup-subagent'].privateKeyHex),
    };

    const withForged = putPassport(registry, forged);
    const result = verifyChain(forged, withForged, NOW);

    expect(result.allowed).toBe(false);
    expect(result.brokenAt?.kind).toBe('guard');
    expect(result.violations.map((v) => v.field)).toContain('allowedDestinations');
    expect(result.violations.map((v) => v.guard)).toContain('guard:destinations');
  });

  it('fails a chain whose Passport has expired', () => {
    const { registry } = buildSeed(NOW);
    const result = verifyChain(registry.passports['psp_classifier'], registry, NOW + 7 * HOUR);
    expect(result.allowed).toBe(false);
    expect(result.brokenAt?.kind).toBe('expired');
  });

  it('fails a chain that cannot be traced to a root', () => {
    const { registry } = buildSeed(NOW);
    const orphaned = { ...registry, passports: { ...registry.passports } };
    delete orphaned.passports['psp_dedup'];

    const result = verifyChain(registry.passports['psp_classifier'], orphaned, NOW);
    expect(result.allowed).toBe(false);
    expect(result.brokenAt?.kind).toBe('missing');
  });

  it('rejects a Passport signed by a key the verifier does not know', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_dedup'];
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
      keys['dedup-subagent'],
      NOW,
    );
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;

    // Strip the dedup subagent's key from the verifier's anchor set.
    const withoutB = { ...registry, publicKeys: { ...registry.publicKeys } };
    delete withoutB.publicKeys['dedup-subagent'];
    const result = verifyChain(minted.child, putPassport(withoutB, minted.child), NOW);

    expect(result.allowed).toBe(false);
    expect(result.brokenAt?.kind).toBe('signature');
    void rogue;
  });
});

describe('revocation cascades to descendants only', () => {
  it('revoking the root kills every branch', () => {
    const { registry } = buildSeed(NOW);
    const after = revoke('psp_root_jordan_lee', registry);

    for (const id of ['psp_root_jordan_lee', 'psp_dedup', 'psp_classifier', 'psp_summarizer', 'psp_digest']) {
      expect(verifyChain(after.passports[id], after, NOW).allowed).toBe(false);
    }
  });

  it("revoking the dedup subagent's Passport invalidates B and C but leaves D and E working", () => {
    const { registry } = buildSeed(NOW);
    const after = revoke('psp_dedup', registry);

    expect(verifyChain(after.passports['psp_dedup'], after, NOW).allowed).toBe(false);
    expect(verifyChain(after.passports['psp_classifier'], after, NOW).allowed).toBe(false);

    expect(verifyChain(after.passports['psp_summarizer'], after, NOW).allowed).toBe(true);
    expect(verifyChain(after.passports['psp_digest'], after, NOW).allowed).toBe(true);
    expect(verifyChain(after.passports['psp_root_jordan_lee'], after, NOW).allowed).toBe(true);
  });

  it("names the revoked ancestor when a descendant is checked", () => {
    const { registry } = buildSeed(NOW);
    const after = revoke('psp_dedup', registry);
    const result = verifyChain(after.passports['psp_classifier'], after, NOW);

    expect(result.brokenAt?.subject).toBe('dedup-subagent');
    expect(result.brokenAt?.kind).toBe('revoked');
  });
});

describe('authorizeAction audit entries', () => {
  it('allows the internal classification and traces authority to the human', () => {
    const { registry } = buildSeed(NOW);
    const receipt = authorizeAction(
      registry.passports['psp_classifier'],
      { action: 'classify', destination: 'internal-only', note: 'ticket #4471' },
      registry,
      NOW,
    );

    expect(receipt.kind).toBe('allow');
    expect(receipt.chainPath).toEqual(['jordan-lee', 'claude-code', 'dedup-subagent', 'classifier-subagent']);
    expect(receipt.rootIssuer).toBe('jordan-lee');
  });

  it('refuses the external send, naming the guard it failed and what it fell back to', () => {
    const { registry } = buildSeed(NOW);
    const receipt = authorizeAction(
      registry.passports['psp_classifier'],
      { action: 'send', destination: 'external-webhook' },
      registry,
      NOW,
    );

    expect(receipt.kind).toBe('refusal');
    if (receipt.kind !== 'refusal') return;
    // the classifier subagent legitimately holds 'send', so the DESTINATION is what stops it — the
    // human allowed sending, but never externally, and no hop could add that.
    expect(receipt.violatedField).toBe('allowedDestinations');
    expect(receipt.guard).toBe('guard:requested-destination');
    expect(receipt.blockedAtHop).toBe(3);
    expect(receipt.blockedAtSubject).toBe('classifier-subagent');
    expect(receipt.permitted).toEqual(['internal-only']);
    expect(receipt.inheritedAuthority.allowedDestinations).toEqual(['internal-only']);
    expect(receipt.rootIssuer).toBe('jordan-lee');
    expect(receipt.detail).toContain('failed guard:requested-destination');
    expect(receipt.detail).toContain('fell back to requiring human authority');
    expect(receipt.fallback).toBe('human authority · jordan-lee must re-issue');
  });

  it('refuses an action the leaf gave up on the way down', () => {
    const { registry } = buildSeed(NOW);
    // the summarizer subagent dropped 'classify' when it was delegated to; asking for it now fails
    // the action check even though its parent Claude Code held it.
    const receipt = authorizeAction(
      registry.passports['psp_summarizer'],
      { action: 'classify', destination: 'internal-only' },
      registry,
      NOW,
    );

    expect(receipt.kind).toBe('refusal');
    if (receipt.kind !== 'refusal') return;
    expect(receipt.violatedField).toBe('actions');
    expect(receipt.guard).toBe('guard:requested-action');
    expect(registry.passports['psp_root_jordan_lee'].claims.actions).toContain('classify');
  });

  it('allows the same send action when it stays internal', () => {
    const { registry } = buildSeed(NOW);
    const receipt = authorizeAction(
      registry.passports['psp_classifier'],
      { action: 'send', destination: 'internal-only' },
      registry,
      NOW,
    );

    // Same verb, same agent, same chain — only the destination differs.
    expect(receipt.kind).toBe('allow');
  });

  it('refuses everything on a revoked branch, naming the revocation', () => {
    const { registry } = buildSeed(NOW);
    const after = revoke('psp_dedup', registry);
    const receipt = authorizeAction(
      after.passports['psp_classifier'],
      { action: 'classify', destination: 'internal-only' },
      after,
      NOW,
    );

    expect(receipt.kind).toBe('refusal');
    if (receipt.kind !== 'refusal') return;
    expect(receipt.guard).toBe('guard:revocation');
    expect(receipt.detail).toContain('fell back to requiring human authority');
  });
});

describe('the lifecycle loop', () => {
  it('reads draft → active → revoked off the chain, never off stored state', () => {
    const { registry } = buildSeed(NOW);
    const live = registry.passports['psp_classifier'];

    expect(lifecycleOf(live.claims, verifyChain(live, registry, NOW)).stage).toBe('active');

    // Withdrawn by the holder, one hop up.
    const after = revoke('psp_dedup', registry);
    const c = after.passports['psp_classifier'];
    expect(lifecycleOf(c.claims, verifyChain(c, after, NOW))).toEqual({
      stage: 'revoked',
      note: 'ancestor revoked',
    });

    // Lapsed rather than withdrawn — same terminal stage, different cause.
    expect(lifecycleOf(live.claims, verifyChain(live, registry, NOW + 7 * HOUR))).toEqual({
      stage: 'revoked',
      note: 'expired',
    });
  });

  it('leaves a Passport that fails a guard in draft — it was never in force', () => {
    const { registry, keys } = buildSeed(NOW);
    const parent = registry.passports['psp_dedup'];
    const forgedClaims: PassportClaims = {
      ...registry.passports['psp_classifier'].claims,
      id: 'psp_forged',
      allowedDestinations: ['internal-only', 'external-webhook'],
    };
    const forged: Passport = {
      claims: forgedClaims,
      signature: signPassportClaims(forgedClaims, parent.signature, keys['dedup-subagent'].privateKeyHex),
    };
    const withForged = putPassport(registry, forged);

    expect(lifecycleOf(forgedClaims, verifyChain(forged, withForged, NOW))).toEqual({
      stage: 'draft',
      note: 'failed guard:destinations',
    });
  });
});

describe('seed integrity', () => {
  it('produces five Passports that each verify, and gets narrower every hop', () => {
    const { registry } = buildSeed(NOW);
    expect(Object.keys(registry.passports)).toHaveLength(5);

    const chain = verifyChain(registry.passports['psp_classifier'], registry, NOW).chain;
    const budgets = chain.map((p) => p.claims.budgetUsd);
    const expiries = chain.map((p) => p.claims.expiresAt);
    const scopeCounts = chain.map((p) => p.claims.contextScopes.length);

    expect(budgets).toEqual([...budgets].sort((a, b) => b - a));
    expect(expiries).toEqual([...expiries].sort((a, b) => b - a));
    expect(scopeCounts[0]).toBeGreaterThan(scopeCounts[scopeCounts.length - 1]);
  });
});

/**
 * The dashboard's promise, checked at the SDK level: whatever a person leaves off the
 * form cannot appear anywhere below them. Every chain here is built from a form, so
 * these are the tests that the human layer is load-bearing rather than decorative.
 */
describe('launching from the team dashboard', () => {
  const launch = (overrides: Partial<AuthorityForm>, holderId = 'priya-nair') =>
    buildSeed(NOW, {
      holderId,
      templateId: 'cleanup',
      form: { ...DEFAULT_TEMPLATE.form, ...overrides },
    });

  it('roots the chain at the person who authorized it, and signs it with their key', () => {
    const { registry, rootId } = launch({});
    const root = registry.passports[rootId];

    expect(root.claims.issuer).toBe('priya-nair');
    expect(verifyChain(registry.passports['psp_classifier'], registry, NOW).allowed).toBe(true);
    // Signed by Priya's key specifically — not by whoever the demo defaults to.
    expect(registry.publicKeys['priya-nair']).toBe(deterministicKeyPair('priya-nair').publicKeyHex);
  });

  it('withholds from every descendant what the human withheld at the root', () => {
    const { registry } = launch({ capabilities: ['read', 'classify'] }); // no 'write'
    for (const passport of Object.values(registry.passports)) {
      expect(passport.claims.actions).not.toContain('write');
    }
  });

  it('keeps customer PII out of the whole chain when the human toggles it off', () => {
    const { registry } = launch({ dataScopes: ['ticket.text', 'ticket.metadata'] });
    for (const passport of Object.values(registry.passports)) {
      for (const scope of passport.claims.contextScopes) {
        expect(scope.startsWith('ticket.customer')).toBe(false);
      }
    }
  });

  it('spawns nothing at all when the human refuses delegation', () => {
    const { registry, leafId } = launch({ canDelegate: false });
    expect(Object.keys(registry.passports)).toHaveLength(1);
    expect(registry.passports[leafId].claims.subject).toBe('claude-code');
  });

  it('caps the chain at the hops the human allowed', () => {
    const { registry } = launch({ maxHops: 1 });
    // One hop of delegation: the primary agent's children, and nothing beneath them.
    expect(registry.passports['psp_dedup']).toBeDefined();
    expect(registry.passports['psp_classifier']).toBeUndefined();
    expect(registry.passports['psp_digest']).toBeUndefined();
  });

  it('lets external transfer reach the leaf only because a human put it on the root', () => {
    const withheld = launch({});
    const granted = launch({ capabilities: [...DEFAULT_TEMPLATE.form.capabilities, 'send-external'] });

    const attempt = (seed: ReturnType<typeof buildSeed>) =>
      authorizeAction(
        seed.registry.passports['psp_classifier'],
        { action: 'send', destination: 'external-webhook' },
        seed.registry,
        NOW,
      );

    const refused = attempt(withheld);
    expect(refused.kind).toBe('refusal');
    expect((refused as RefusalReceipt).guard).toBe('guard:requested-destination');
    expect((refused as RefusalReceipt).violatedField).toBe('allowedDestinations');
    expect(refused.rootIssuer).toBe('priya-nair');

    // Same chain, same guards, opposite outcome — decided three hops up by a person.
    expect(attempt(granted).kind).toBe('allow');
  });

  it('narrows every template it offers, whichever one is launched', () => {
    for (const template of TASK_TEMPLATES) {
      const seed = buildSeed(NOW, {
        holderId: 'jordan-lee',
        templateId: template.id,
        form: template.form,
      });
      const leaf = seed.registry.passports[seed.leafId];
      const result = verifyChain(leaf, seed.registry, NOW);

      expect(result.allowed).toBe(true);
      expect(result.chain[0].claims.issuer).toBe('jordan-lee');
      expect(leaf.claims.budgetUsd).toBeLessThan(template.form.budgetUsd);
      // The console's failing attempt must fail on the destination, not the verb.
      expect(leaf.claims.actions).toContain('send');
      expect(leaf.claims.allowedDestinations).not.toContain('external-webhook');
    }
  });
});

/**
 * The MRZ is presentation, but it is presentation *of* the signature — so the thing
 * worth testing is that it stays welded to the claims it describes.
 */
describe('the machine-readable strip', () => {
  it('lays out two lines of exactly 44 characters for every Passport on the chain', () => {
    const { registry } = buildSeed(NOW);
    for (const passport of Object.values(registry.passports)) {
      const kind = ACTOR_BY_ID[passport.claims.subject]?.kind ?? 'subagent';
      const mrz = buildMrz(passport.claims, passport.signature, kind);
      expect(mrz.line1).toHaveLength(44);
      expect(mrz.line2).toHaveLength(44);
      expect(mrz.line1).toMatch(/^[A-Z0-9<]+$/);
      expect(mrz.line2).toMatch(/^[A-Z0-9<]+$/);
    }
  });

  it('encodes granted-to << issued-by, the way a passport encodes surname << given names', () => {
    const { registry } = buildSeed(NOW);
    const mrz = buildMrz(
      registry.passports['psp_classifier'].claims,
      registry.passports['psp_classifier'].signature,
      'subagent',
    );
    expect(mrz.line1).toContain('CLASSIFIER<SUBAGENT<<DEDUP<SUBAGENT');
    expect(mrz.line1.startsWith('P<SUB')).toBe(true);
  });

  it('computes ICAO check digits that actually check out', () => {
    // Worked example from ICAO 9303 itself.
    expect(mrzCheckDigit('D23145890734')).toBe('9');
    expect(mrzCheckDigit('340712')).toBe('7');

    const { registry } = buildSeed(NOW);
    const p = registry.passports['psp_dedup'];
    const line2 = buildMrz(p.claims, p.signature, 'subagent').line2;
    // Document number occupies 1–9, its check digit sits at position 10.
    expect(mrzCheckDigit(line2.slice(0, 9))).toBe(line2[9]);
  });

  it('changes when a claim changes, so an edited card is visibly not the signed one', () => {
    const { registry } = buildSeed(NOW);
    const original = registry.passports['psp_classifier'];
    const widened = {
      ...original.claims,
      expiresAt: original.claims.expiresAt + 48 * HOUR,
    };

    const before = buildMrz(original.claims, original.signature, 'subagent');
    const after = buildMrz(widened, original.signature, 'subagent');
    expect(after.line2).not.toBe(before.line2);
  });

  it('differs per card, because each one carries its own issuer signature', () => {
    const { registry } = buildSeed(NOW);
    const strips = Object.values(registry.passports).map(
      (p) => buildMrz(p.claims, p.signature, 'subagent').line2,
    );
    expect(new Set(strips).size).toBe(strips.length);
  });
});
