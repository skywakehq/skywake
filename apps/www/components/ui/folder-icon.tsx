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

/** The Skywake mark, in the folder's 100×82 units, sized and centred on the front flap. */
function Mark({ fill, dy = 0, opacity }: { fill: string; dy?: number; opacity?: number }) {
  return (
    <g transform={`translate(38 ${38 + dy}) scale(1)`} fill={fill} opacity={opacity}>
      <path d="M6.75 10.1a8 8 0 0 1 16 0Z" />
      <rect x="6.75" y="12.1" width="16" height="2.2" rx="1.1" />
      <rect x="3.75" y="15.9" width="13" height="2.2" rx="1.1" />
      <rect x="1.25" y="19.7" width="9" height="2.2" rx="1.1" />
    </g>
  );
}

/**
 * The Skywake mark pressed into the flap. Light from above leaves the top edge
 * of the cut in shade and catches the lower lip, so the shape reads as sunk in.
 */
function Engraving() {
  return (
    <g aria-hidden>
      <Mark fill="#fff6d6" dy={0.45} opacity={0.9} />
      <Mark fill="#a8650a" dy={-0.35} opacity={0.55} />
      <Mark fill="#eaa627" />
    </g>
  );
}

/** The front flap of a Finder folder, drawn over whatever is inside it, optionally with the mark engraved. */
export function FolderFront({ className, engraved }: { className?: string; engraved?: boolean }) {
  return (
    <svg viewBox="0 0 100 82" aria-hidden className={className}>
      <FrontPaths />
      {engraved && <Engraving />}
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
