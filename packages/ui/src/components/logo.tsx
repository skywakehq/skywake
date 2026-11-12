export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M6.75 10.1a8 8 0 0 1 16 0Z" />
      <rect x="6.75" y="12.1" width="16" height="2.2" rx="1.1" />
      <rect x="3.75" y="15.9" width="13" height="2.2" rx="1.1" />
      <rect x="1.25" y="19.7" width="9" height="2.2" rx="1.1" />
    </svg>
  );
}
