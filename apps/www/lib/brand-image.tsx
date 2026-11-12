export const INK = "#1a1a18";
export const PAPER = "#f6f5f1";
export const MUTED = "#6b6a65";
export const SIGNAL = "#2f5bea";

export function LogoMark({ size, color = INK }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M6.75 10.1a8 8 0 0 1 16 0Z" />
      <rect x="6.75" y="12.1" width="16" height="2.2" rx="1.1" />
      <rect x="3.75" y="15.9" width="13" height="2.2" rx="1.1" />
      <rect x="1.25" y="19.7" width="9" height="2.2" rx="1.1" />
    </svg>
  );
}
