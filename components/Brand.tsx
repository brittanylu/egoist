/**
 * Wordmark: a black square holding a looping-knot glyph — a chain that closes on
 * itself, drawn from scratch rather than lifted from anyone's asset library.
 */
export function KnotMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-[7px] bg-ink"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24" fill="none">
        <path
          d="M8.4 8.4c-2.2 0-3.9 1.6-3.9 3.6s1.7 3.6 3.9 3.6c1.5 0 2.6-.8 3.6-1.9l1.6-1.8c1-1.1 2.1-1.9 3.6-1.9 2.2 0 3.9 1.6 3.9 3.6s-1.7 3.6-3.9 3.6c-1.5 0-2.6-.8-3.6-1.9l-1.6-1.8C11 11.4 9.9 10.6 8.4 10.6"
          stroke="#F5F4EF"
          strokeWidth="1.6"
          strokeLinecap="round"
          transform="translate(-1.2 -2)"
        />
      </svg>
    </span>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <KnotMark />
      <span className="text-[15px] font-medium tracking-tightest">Chain of Custody</span>
    </div>
  );
}
