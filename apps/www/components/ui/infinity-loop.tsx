const LOOP =
  "M60 30C50 16 42 10 32 10a20 20 0 0 0 0 40c10 0 18-6 28-20 10-14 18-20 28-20a20 20 0 0 1 0 40c-10 0-18-6-28-20z";

/** An infinity sign in the warm yellow, drawn as one ribbon that crosses over itself. */
export function InfinityLoop({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 60" aria-hidden fill="none" className={className}>
      <path d={LOOP} stroke="#f7b52c" strokeWidth="11" />
      <path
        d={LOOP}
        pathLength="100"
        stroke="var(--background)"
        strokeWidth="19"
        strokeDasharray="9 91"
        strokeDashoffset="-45.5"
      />
      <path
        d={LOOP}
        pathLength="100"
        stroke="#f7b52c"
        strokeWidth="11"
        strokeDasharray="16 84"
        strokeDashoffset="-42"
      />
    </svg>
  );
}
