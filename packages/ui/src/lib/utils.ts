import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The theme's type scale, so text-body counts as a size and not a colour.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["display", "title", "subtitle", "body", "caption", "micro"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
