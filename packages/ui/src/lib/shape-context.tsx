"use client";

/** Corner classes for the shared components. They all come from the radius
 *  tokens in globals.css, so `--radius` there sets every corner. */
interface ShapeClasses {
  item: string;
  bg: string;
  /** The focus ring sits 2px outside the element, so its corners are 2px
   *  larger to stay concentric. */
  focusRing: string;
  /** Popup shells pad their rows by 4px, so their corners are 4px larger. */
  container: string;
  button: string;
  input: string;
  /** `bg` in px, for corners that are animated one by one. */
  bgRadius: number;
}

const classes = {
  item: "rounded-md",
  bg: "rounded-md",
  focusRing: "rounded-[calc(var(--radius-md)+2px)]",
  container: "rounded-[calc(var(--radius-md)+4px)]",
  button: "rounded-md",
  input: "rounded-md",
};

let measured: number | undefined;

/** The value of `--radius-md` in px, measured once on a probe element
 *  because a custom property holds the unresolved `calc()`. 0 on the server,
 *  where nothing is animated. */
function radiusPx(): number {
  if (typeof document === "undefined") return 0;
  if (measured === undefined) {
    const probe = document.createElement("div");
    probe.style.borderRadius = "var(--radius-md)";
    document.body.appendChild(probe);
    measured = parseFloat(getComputedStyle(probe).borderTopLeftRadius) || 0;
    probe.remove();
  }
  return measured;
}

const shape: ShapeClasses = {
  ...classes,
  get bgRadius() {
    return radiusPx();
  },
};

function useShape(): ShapeClasses {
  return shape;
}

/** Menus, select and combobox lists use the same corners. */
const usePopupShape = useShape;

/** A corner radius for a surface `inset` px inside a `bg`-rounded one. */
function nestedRadius(inset: number): string {
  return `max(0px, calc(var(--radius-md) - ${inset}px))`;
}

export { useShape, usePopupShape, nestedRadius };
export type { ShapeClasses };
