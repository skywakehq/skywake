import { useId } from "react";

function BackPath() {
  return (
    <path
      d="M6 14c0-4.4 3.6-8 8-8h22.5c2.7 0 5.2 1.2 6.9 3.3l2.5 3.1c1.1 1.4 2.8 2.2 4.6 2.2H86c4.4 0 8 3.6 8 8V68c0 4.4-3.6 8-8 8H14c-4.4 0-8-3.6-8-8V14z"
      fill="#e59a12"
    />
  );
}

function FrontPaths() {
  const front = useId();
  return (
    <>
      <defs>
        <linearGradient id={front} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffdf6e" />
          <stop offset="1" stopColor="#f7b52c" />
        </linearGradient>
      </defs>
      <path
        d="M6 31c0-3.9 3.1-7 7-7h74c3.9 0 7 3.1 7 7v37c0 4.4-3.6 8-8 8H14c-4.4 0-8-3.6-8-8V31z"
        fill={`url(#${front})`}
      />
    </>
  );
}

/** The back of a Finder folder, drawn behind whatever is inside it. */
export function FolderBack({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 82" aria-hidden className={className}>
      <BackPath />
    </svg>
  );
}

/** The front flap of a Finder folder, drawn over whatever is inside it. */
export function FolderFront({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 82" aria-hidden className={className}>
      <FrontPaths />
    </svg>
  );
}

/** A Finder folder in the warm yellow. */
export function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 82" aria-hidden className={className}>
      <BackPath />
      <FrontPaths />
    </svg>
  );
}
