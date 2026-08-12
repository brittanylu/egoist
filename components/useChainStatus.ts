'use client';

/**
 * Live verification for every Passport in the registry, shared by all panels so
 * they can never disagree with each other.
 *
 * Verification is real Ed25519 work, so it is memoized on the registry rather than
 * re-run on every clock tick. The coarse time bucket keeps it eventually fresh
 * (expiry, mainly) without paying for signature checks once a second.
 */
import { useMemo } from 'react';
import { VerificationResult, verifyChain } from '@/lib/passport';
import { useDemo } from '@/lib/store';
import { useNow } from './ui';

export type StatusMap = Record<string, VerificationResult>;

export function useChainStatuses(): StatusMap {
  const registry = useDemo((state) => state.registry);
  const now = useNow();
  const bucket = Math.floor(now / 5000);

  return useMemo(
    () =>
      Object.fromEntries(
        Object.values(registry.passports).map((p) => [p.claims.id, verifyChain(p, registry, Date.now())]),
      ),
    // `bucket` is a cache key, not a value: it lets expiry land without re-verifying
    // every signature on every tick.
    [registry, bucket],
  );
}
