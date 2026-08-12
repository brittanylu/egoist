'use client';

import { useEffect } from 'react';
import { Brand, EgoistMark } from '@/components/Brand';
import { ActionConsole } from '@/components/ActionConsole';
import { AuditLog } from '@/components/AuditLog';
import { ChainGraph } from '@/components/ChainGraph';
import { DelegationSandbox } from '@/components/DelegationSandbox';
import { HowItWorks } from '@/components/HowItWorks';
import { PassportDrawer } from '@/components/PassportDrawer';
import { PassportWallet } from '@/components/PassportWallet';
import { RevocationControls } from '@/components/RevocationControls';
import { Tabs } from '@/components/Tabs';
import { TeamDashboard } from '@/components/TeamDashboard';
import { Toast } from '@/components/Toast';
import { ClockProvider, Em, Pill, SectionHeading } from '@/components/ui';
import { ACTOR_BY_ID } from '@/lib/seed';
import { TEAM_NAME, isTeamMember } from '@/lib/team';
import { ensureSeeded, useDemo } from '@/lib/store';

export default function Page() {
  // Seeding mints real signatures with in-memory keys, so it happens on the client.
  const seeded = useDemo((state) => state.seeded);
  const tab = useDemo((state) => state.tab);
  const reset = useDemo((state) => state.reset);
  const issuer = useDemo((state) => state.registry.passports[state.rootId]?.claims.issuer ?? '');
  useEffect(() => {
    ensureSeeded();
  }, []);

  const holder = ACTOR_BY_ID[issuer];
  const holderName = holder?.label ?? 'an operations lead';

  return (
    <ClockProvider>
      <div className="mx-auto w-full max-w-[1200px] px-5 pb-24 pt-8 sm:px-8">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          {/* Product wordmark, hairline, host mark. The divider is what keeps the two
              from reading as one lockup.

              items-baseline, not items-center: the two marks are set at different
              sizes, and centring their line boxes leaves their baselines a pixel
              apart. Type in a lockup aligns on the baseline. The rule is sized to the
              wordmark's ascender and sits on that same baseline, so it spans the
              letters rather than overshooting them. */}
          <div className="flex items-baseline gap-3">
            <Brand />
            <span aria-hidden className="h-[11px] w-px shrink-0 bg-hairline" />
            <EgoistMark />
          </div>
          <div className="flex items-center gap-3">
            <Pill>Agents track</Pill>
            <button type="button" className="btn-secondary" onClick={reset}>
              Reset demo
            </button>
          </div>
        </header>

        {/* Hero */}
        <section className="mt-20 max-w-[62ch] sm:mt-28">
          <h1 className="display text-[52px] sm:text-[80px]">
            Stop permission <Em>laundering</Em>.
          </h1>
          <p className="mt-8 max-w-[54ch] text-[17px] leading-[1.45] text-muted sm:text-[19px]">
            {holderName}
            {holder && isTeamMember(issuer) ? `, ${holder.role} on the ${TEAM_NAME},` : ''} authorizes Claude Code to
            clean up three years of support tickets. Claude Code spawns subagents, and those spawn subagents of their
            own. Watch the authority get strictly narrower at every hop — then watch the last subagent try to exceed
            it.
          </p>
        </section>

        <div className="mt-12">
          <Tabs />
        </div>

        {!seeded ? (
          <div className="card mt-20 p-16 text-center text-[13px] text-muted">Minting the seed chain…</div>
        ) : tab === 'dashboard' ? (
          <section className="mt-8">
            <TeamDashboard />
          </section>
        ) : tab === 'passport' ? (
          <section className="mt-8">
            <PassportWallet />
          </section>
        ) : (
          <>
            {/* Chain + Passport detail */}
            <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_368px]">
              {/* min-w-0: the graph scrolls horizontally, and without this its
                  min-content width would stretch the whole page. */}
              <div className="card min-w-0 p-5">
                <SectionHeading
                  eyebrow="Chain of custody"
                  title={
                    <>
                      One human permission, five <Em>Passports</Em>.
                    </>
                  }
                  hint="Each card shows the authority its Passport carries, against what the human granted, and where it sits in the loop: draft → active → revoked. Struck-through chips were given up on the way down. Click any node to decode it."
                />
                <div className="mt-6">
                  <ChainGraph />
                </div>
              </div>

              <div className="lg:sticky lg:top-6 lg:self-start">
                <PassportDrawer />
              </div>
            </section>

            {/* The four moments */}
            <section className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="min-w-0 lg:col-span-2">
                <ActionConsole />
              </div>
              <RevocationControls />
              <div className="min-w-0 lg:col-span-2">
                <DelegationSandbox />
              </div>
              <AuditLog />
            </section>

            <section className="mt-20">
              <HowItWorks />
            </section>
          </>
        )}

        <footer className="mt-20 border-t border-hairline pt-5 text-[12px] text-muted">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Same lockup rule as the header: baseline-aligned, rule sized to the ascender. */}
            <span className="flex items-baseline gap-2.5">
              <EgoistMark size="footer" />
              <span aria-hidden className="h-[9px] w-px shrink-0 bg-hairline" />
              AI Passport Ideathon · Agents track
            </span>
            <span className="font-mono">
              Ed25519 signatures · guards enforced in lib/passport.ts · verified at /api/verify
            </span>
          </div>

          {/* The four people who built it. Set in the page voice like every other
              name here, including the ones on the chain. */}
          <div className="mt-3.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t border-hairline pt-3.5 text-[11.5px]">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted/70">Built by</span>
            <span className="text-muted">Brittany Lu · Sriya Vintha · Phillip Zeng · Michael Liu</span>
          </div>
        </footer>
      </div>

      <Toast />
    </ClockProvider>
  );
}
