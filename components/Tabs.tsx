'use client';

/**
 * The demo in the order it actually happens: a person authorizes the work, the agents
 * carry it out, and each one carries a credential that says what it may do. The
 * dashboard leads because that is where authority comes from — there is no other door
 * into this system.
 */
import { Tab, useDemo } from '@/lib/store';
import { cx } from './ui';

/**
 * `tip` is where the vocabulary is defined. The two terms the whole page turns on —
 * an AI Passport and a child AI Passport — are spelled out on hover rather than in a
 * glossary nobody scrolls to.
 */
const TABS: Array<{ key: Tab; label: string; hint: string; tip: string }> = [
  {
    key: 'dashboard',
    label: 'Team Dashboard',
    hint: 'who issues the root AI Passport',
    tip: 'AI Passport — a signed, scoped grant of authority a holder issues and can revoke.',
  },
  {
    key: 'chain',
    label: 'Agent Chain',
    hint: 'the child AI Passports it issued',
    tip: "Child AI Passport — a delegated Passport that can only narrow its parent's authority.",
  },
  {
    key: 'passport',
    label: 'AI Passport',
    hint: 'the credentials themselves',
    tip: 'AI Passport — a signed, scoped grant of authority a holder issues and can revoke.',
  },
];

export function Tabs() {
  const tab = useDemo((state) => state.tab);
  const setTab = useDemo((state) => state.setTab);

  return (
    <div
      role="tablist"
      aria-label="Chain of custody views"
      className="flex flex-wrap items-center gap-1.5 border-b border-hairline pb-3"
    >
      {TABS.map((item) => {
        const active = tab === item.key;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            title={item.tip}
            onClick={() => setTab(item.key)}
            className={cx(
              'group rounded-full border px-4 py-2 text-left transition-all duration-200 ease-calm',
              active ? 'border-ink bg-ink text-canvas' : 'border-hairline bg-canvas text-muted hover:border-ink/30',
            )}
          >
            <span className="text-[13px] font-medium">{item.label}</span>
            <span className={cx('ml-2 text-[11.5px]', active ? 'text-canvas/60' : 'text-muted/80')}>
              {item.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
