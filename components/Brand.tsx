'use client';

import { useState } from 'react';

/** Wordmark: type only. No glyph, no illustration. */
export function Brand() {
  return <span className="text-[15px] font-extrabold tracking-tightest text-ink">Chain of Custody</span>;
}

/**
 * The host's mark, shown as a credit beside the product wordmark.
 *
 * Rendered from /egoist.svg once that file exists. Until it does, the credit falls
 * back to type — which is consistent with a page whose own brand is a wordmark and
 * nothing else. Drop the real mark at public/egoist.svg and it takes over with no
 * code change; `onError` is what makes the swap automatic rather than a second edit.
 *
 * `brightness(0)` flattens whatever colour the supplied file carries to solid black
 * while leaving its alpha intact, so the mark matches the ink around it and colour
 * on this page stays reserved for the tier rails and allow/deny.
 */
/**
 * One size token drives both branches. Passing separate classes for the image and the
 * type would let them drift, and Tailwind cannot resolve two competing `text-*` on the
 * same element by class order anyway.
 */
const MARK_SIZE = {
  header: { image: 'h-4', type: 'text-[13px]' },
  footer: { image: 'h-3.5', type: 'text-[11px]' },
} as const;

/**
 * Letter-spacing is applied *after* every glyph, including the last, so a tracked
 * word's box runs one full space wider than its ink. In a lockup that reads as the
 * mark sitting off-centre against its divider. The negative margin reclaims exactly
 * that trailing space, so the box ends where the "T" ends.
 */
const TRACKING = 'tracking-[0.18em] -mr-[0.18em]';

export function EgoistMark({
  size = 'header',
  className,
}: {
  size?: keyof typeof MARK_SIZE;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);
  const scale = MARK_SIZE[size];

  if (missing) {
    return (
      <span className={`${scale.type} ${TRACKING} shrink-0 font-medium uppercase text-ink ${className ?? ''}`}>
        Egoist
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- the file is optional, and
    // next/image cannot fall back when it is absent.
    <img
      src="/egoist.svg"
      alt="Egoist"
      onError={() => setMissing(true)}
      className={`${scale.image} w-auto shrink-0 [filter:brightness(0)] ${className ?? ''}`}
    />
  );
}
