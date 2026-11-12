import type { SimpleIcon } from "simple-icons";

export function BrandIcon({
  icon,
  className = "size-4",
}: {
  icon: SimpleIcon;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`${className} fill-current`}>
      <path d={icon.path} />
    </svg>
  );
}
