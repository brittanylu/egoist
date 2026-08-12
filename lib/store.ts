'use client';

/**
 * In-memory demo state. No database: everything lives here and resets on reload
 * (or on the Reset demo button). Private keys never leave this store — the
 * verifier only ever receives public keys.
 *
 * The state is one live chain plus a shelf of launches. A team can start several
 * chains; only one is on screen at a time, so switching between them means writing
 * the live registry back onto the launch it belongs to and hydrating the other. The
 * live fields stay flat and unprefixed (`registry`, `rootId`, `receipts`, …) because
 * every panel reads them directly and none of them should have to know that more
 * than one chain exists.
 */
import { create } from 'zustand';
import { KeyPair, newId } from './crypto';
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
import { LaunchConfig, SeedResult, TEMPLATE_BY_ID, buildSeed } from './seed';
import { holderLine } from './team';

export type VerifierMode = 'service' | 'local';

/**
 * Three views of one chain: who authorized it, what the agents then did, and the
 * credentials themselves as objects you can pick up and turn over.
 */
export type Tab = 'dashboard' | 'chain' | 'passport';

export interface SandboxOutcome {
  at: number;
  parentId: string;
  requestedSubject: string;
  ok: boolean;
  violations: Violation[];
  mintedId?: string;
}

/** Everything that belongs to one chain, parked while another one is on screen. */
interface ChainSnapshot {
  registry: Registry;
  keys: Record<string, KeyPair>;
  passportBySubject: Record<string, string>;
  rootId: string;
  leafId: string;
  receipts: Receipt[];
}

export interface Launch {
  id: string;
  templateId: string;
  /** The plain-language task name a person picked, e.g. "Classify incoming tickets". */
  title: string;
  /** Who authorized it. A person, always. */
  holderId: string;
  at: number;
  snapshot: ChainSnapshot;
}

interface DemoState {
  seeded: boolean;
  tab: Tab;
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
  /** Chains this team has started, newest first. */
  launches: Launch[];
  activeLaunchId: string;
  /** Transient confirmation line, e.g. after a launch. */
  toast: string | null;

  reset: () => void;
  setTab: (tab: Tab) => void;
  select: (id: string | null) => void;
  trace: (leafPassportId: string) => void;
  clearTrace: () => void;
  attempt: (leafPassportId: string, action: Action, destination: Destination, note?: string) => Promise<void>;
  revokePassport: (id: string) => void;
  mintFromSandbox: (parentId: string, request: DelegationRequest) => void;
  clearSandbox: () => void;
  clearReceipts: () => void;
  /** Issue a root Passport from the dashboard form and put the chain on screen. */
  launch: (config: LaunchConfig) => void;
  openLaunch: (launchId: string) => void;
  dismissToast: () => void;
}

function snapshotOf(seed: SeedResult): ChainSnapshot {
  return {
    registry: seed.registry,
    keys: seed.keys,
    passportBySubject: seed.passportBySubject,
    rootId: seed.rootId,
    leafId: seed.leafId,
    receipts: [],
  };
}

/** The per-chain fields, cleared of anything that belonged to the last one. */
function liveFrom(snapshot: ChainSnapshot) {
  return {
    seeded: true,
    registry: snapshot.registry,
    keys: snapshot.keys,
    passportBySubject: snapshot.passportBySubject,
    rootId: snapshot.rootId,
    leafId: snapshot.leafId,
    receipts: snapshot.receipts,
    selectedId: snapshot.leafId,
    tracedPath: null as string[] | null,
    lastRevoked: [] as string[],
    sandbox: null as SandboxOutcome | null,
    verifierMode: null as VerifierMode | null,
    pendingAction: null as string | null,
  };
}

function launchFromSeed(seed: SeedResult, id: string): Launch {
  return {
    id,
    templateId: seed.templateId,
    title: TEMPLATE_BY_ID[seed.templateId]?.title ?? seed.task,
    holderId: seed.holderId,
    at: seed.seededAt,
    snapshot: snapshotOf(seed),
  };
}

/** Write the live chain back onto the launch it came from, before leaving it. */
function parked(state: DemoState): Launch[] {
  return state.launches.map((l) =>
    l.id === state.activeLaunchId
      ? {
          ...l,
          snapshot: {
            registry: state.registry,
            keys: state.keys,
            passportBySubject: state.passportBySubject,
            rootId: state.rootId,
            leafId: state.leafId,
            receipts: state.receipts,
          },
        }
      : l,
  );
}

/** The demo's opening position: one chain, already launched by the Operations Lead. */
function initialState() {
  const seed = buildSeed();
  const launch = launchFromSeed(seed, 'launch_seed');
  return {
    ...liveFrom(launch.snapshot),
    tab: 'dashboard' as Tab,
    launches: [launch],
    activeLaunchId: launch.id,
    toast: null as string | null,
  };
}

export const useDemo = create<DemoState>((set, get) => ({
  ...initialState(),
  // Seeding mints real signatures, so the pre-hydration value is deliberately marked
  // unseeded and rebuilt on the client by `ensureSeeded`.
  seeded: false,

  reset: () => set({ ...initialState(), tab: get().tab }),

  setTab: (tab) => set({ tab }),

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
        body: JSON.stringify({ registry, leafPassportId, action, destination, note }),
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

  launch: (config) => {
    const seed = buildSeed(Date.now(), config);
    const launch = launchFromSeed(seed, newId('launch'));
    set((state) => ({
      launches: [launch, ...parked(state)],
      activeLaunchId: launch.id,
      ...liveFrom(launch.snapshot),
      // The chain is the payoff — go straight to it.
      tab: 'chain' as Tab,
      toast: `Root Passport issued by ${holderLine(config.holderId)}.`,
    }));
  },

  openLaunch: (launchId) => {
    const state = get();
    if (launchId === state.activeLaunchId) {
      set({ tab: 'chain' });
      return;
    }
    const launches = parked(state);
    const target = launches.find((l) => l.id === launchId);
    if (!target) return;
    set({ launches, activeLaunchId: target.id, ...liveFrom(target.snapshot), tab: 'chain' });
  },

  dismissToast: () => set({ toast: null }),
}));

/** Called once on mount so signing/keygen happens client-side, never during SSR. */
export function ensureSeeded() {
  if (!useDemo.getState().seeded) useDemo.setState({ ...initialState() });
}
