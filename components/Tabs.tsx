'use client';

/**
 * The demo in the order it actually happens: a person authorizes the work, the agents
 * carry it out, and each one carries a credential that says what it may do. The
 * dashboard leads because that is where authority comes from — there is no other door
 * into this system.
 */
import { Tab, useDemo } from '@/lib/store';
import { cx } from './ui';

const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  { key: 'dashboard', label: 'Team Dashboard', hint: 'the people who authorize' },
  { key: 'chain', label: 'Agent Chain', hint: 'what the agents inherited' },
  { key: 'passport', label: 'AI Passport', hint: 'the credentials themselves' },
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
