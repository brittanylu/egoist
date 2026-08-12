'use client';

/**
 * One transient line, for the one moment worth confirming: a human just signed a root
 * Passport. Inverted, like the holder card — the origin of authority reads the same
 * way wherever it appears.
 */
import { useEffect } from 'react';
import { useDemo } from '@/lib/store';

const DISMISS_AFTER = 5000;

export function Toast() {
  const toast = useDemo((state) => state.toast);
  const dismissToast = useDemo((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(dismissToast, DISMISS_AFTER);
    return () => clearTimeout(id);
  }, [toast, dismissToast]);

  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-5">
      <div
        role="status"
        aria-live="polite"
        className="panel-invert pointer-events-auto flex max-w-[92vw] animate-fade items-center gap-3 px-4 py-2.5"
      >
        <span className="inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-canvas" />
        <span className="text-[13px] leading-snug">{toast}</span>
        <button
          type="button"
          onClick={dismissToast}
          className="ml-1 shrink-0 rounded-full border border-white/20 px-2 py-[2px] text-[11px] text-canvas/70 transition-colors duration-200 hover:text-canvas"
        >
          dismiss
        </button>
      </div>
    </div>
  );
}
