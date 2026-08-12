'use client';

/**
 * In-memory demo state. No database: everything lives here and resets on reload
 * (or on the Reset demo button). Private keys never leave this store — the
 * verifier only ever receives public keys.
 */
import { create } from 'zustand';
import { KeyPair } from './crypto';
import {
  Action,
  DelegationRequest,
  Destination,
  Passport,
  Receipt,
  Registry,
  Violation,
  delegate,
  delegationRefusalReceipt,
  descendantsOf,
  putPassport,
  revoke,
} from './passport';
import { SeedResult, buildSeed } from './seed';

export type VerifierMode = 'service' | 'local';

export interface SandboxOutcome {
  at: number;
  parentId: string;
  requestedSubject: string;
  ok: boolean;
  violations: Violation[];
  mintedId?: string;
}

interface DemoState {
  seeded: boolean;
  registry: Registry;
  keys: Record<string, KeyPair>;
  passportBySubject: Record<string, string>;
  rootId: string;
  /** The agent the action console drives. */
  leafId: string;
  receipts: Receipt[];
  selectedId: string | null;
  /** Passport ids on the currently traced root→leaf path. */
  tracedPath: string[] | null;
  /** Which Passports were invalidated by the most recent revoke, for the animation. */
  lastRevoked: string[];
  sandbox: SandboxOutcome | null;
  /** Whether the last authorization was decided by /api/verify or the local fallback. */
  verifierMode: VerifierMode | null;
  pendingAction: string | null;

  reset: () => void;
  select: (id: string | null) => void;
  trace: (leafPassportId: string) => void;
  clearTrace: () => void;
  attempt: (leafPassportId: string, action: Action, destination: Destination, note?: string) => Promise<void>;
  revokePassport: (id: string) => void;
  mintFromSandbox: (parentId: string, request: DelegationRequest) => void;
  clearSandbox: () => void;
  clearReceipts: () => void;
}

function fromSeed(seed: SeedResult) {
  return {
    seeded: true,
    registry: seed.registry,
    keys: seed.keys,
    passportBySubject: seed.passportBySubject,
    rootId: seed.rootId,
    leafId: seed.leafId,
    receipts: [] as Receipt[],
    selectedId: seed.leafId,
    tracedPath: null,
    lastRevoked: [] as string[],
    sandbox: null,
    verifierMode: null as VerifierMode | null,
    pendingAction: null as string | null,
  };
}

/** Only the public half of the registry is ever sent to the verifier service. */
function publicRegistry(registry: Registry): Registry {
  return registry;
}

export const useDemo = create<DemoState>((set, get) => ({
  ...fromSeed(buildSeed()),
  seeded: false,

  reset: () => set({ ...fromSeed(buildSeed()) }),

  select: (id) => set({ selectedId: id }),

  trace: (leafPassportId) => {
    const { registry } = get();
    const path: string[] = [];
    let cursor: Passport | undefined = registry.passports[leafPassportId];
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.claims.id)) {
      guard.add(cursor.claims.id);
      path.unshift(cursor.claims.id);
      cursor = cursor.claims.parentId ? registry.passports[cursor.claims.parentId] : undefined;
    }
    set({ tracedPath: path, selectedId: leafPassportId });
  },

  clearTrace: () => set({ tracedPath: null }),

  attempt: async (leafPassportId, action, destination, note) => {
    const { registry } = get();
    const leaf = registry.passports[leafPassportId];
    if (!leaf) return;

    const key = `${leafPassportId}:${action}:${destination}`;
    set({ pendingAction: key });

    let receipt: Receipt | null = null;
    let mode: VerifierMode = 'service';

    try {
      // The verifier is a separate service: it gets the public registry and the
      // request, and decides on its own by walking the chain to the human root.
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          registry: publicRegistry(registry),
          leafPassportId,
          action,
          destination,
          note,
        }),
      });
      if (!response.ok) throw new Error(`verifier responded ${response.status}`);
      const data = (await response.json()) as { receipt: Receipt };
      receipt = data.receipt;
    } catch {
      // Fall back to deciding in-process so the demo never dead-ends.
      const { authorizeAction } = await import('./passport');
      receipt = authorizeAction(leaf, { action, destination, note }, registry);
      mode = 'local';
    }

    set((state) => ({
      receipts: receipt ? [receipt, ...state.receipts] : state.receipts,
      verifierMode: mode,
      pendingAction: null,
    }));
  },

  revokePassport: (id) => {
    const { registry } = get();
    const affected = [id, ...descendantsOf(registry, id).map((p) => p.claims.id)];
    set({ registry: revoke(id, registry), lastRevoked: affected });
  },

  mintFromSandbox: (parentId, request) => {
    const { registry, keys } = get();
    const parent = registry.passports[parentId];
    if (!parent) return;

    const issuerKey = keys[parent.claims.subject];
    if (!issuerKey) return;

    const result = delegate(parent, request, issuerKey);

    if (result.ok) {
      set({
        registry: putPassport(registry, result.child),
        sandbox: {
          at: Date.now(),
          parentId,
          requestedSubject: request.subject,
          ok: true,
          violations: [],
          mintedId: result.child.claims.id,
        },
        selectedId: result.child.claims.id,
      });
      return;
    }

    // Rejected at mint time. Log it as a first-class refusal receipt.
    const receipt = delegationRefusalReceipt(parent, request, result.violations, registry);
    set((state) => ({
      sandbox: {
        at: Date.now(),
        parentId,
        requestedSubject: request.subject,
        ok: false,
        violations: result.violations,
      },
      receipts: [receipt, ...state.receipts],
    }));
  },

  clearSandbox: () => set({ sandbox: null }),
  clearReceipts: () => set({ receipts: [] }),
}));

/** Called once on mount so signing/keygen happens client-side, never during SSR. */
export function ensureSeeded() {
  if (!useDemo.getState().seeded) useDemo.setState({ ...fromSeed(buildSeed()) });
}
