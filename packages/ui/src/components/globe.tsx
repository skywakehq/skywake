"use client";

import createGlobe, { type COBEOptions } from "cobe";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { cn } from "@skywake/ui/lib/utils";
import { place } from "@skywake/ui/lib/regions";

const TAU = Math.PI * 2;

// Our --signal and --faint colours, as cobe wants them (0 to 1).
const LIGHT = {
  dark: 0,
  diffuse: 0.4,
  mapBrightness: 1.2,
  baseColor: [1, 1, 1],
  glowColor: [0.96, 0.96, 0.94],
  markerColor: [0.9, 0.28, 0.16],
  other: [0.64, 0.64, 0.61],
} as const;
const DARK = {
  dark: 1,
  diffuse: 1.2,
  mapBrightness: 6,
  baseColor: [0.3, 0.3, 0.3],
  glowColor: [0.12, 0.12, 0.12],
  markerColor: [1, 0.42, 0.27],
  other: [0.45, 0.45, 0.45],
} as const;

/**
 * The angles that turn a place on the map toward you. The tilt leaves it
 * above the middle, since the bottom of the globe is cut off.
 */
function facing([lat, lng]: [number, number]) {
  return [Math.PI - ((lng * Math.PI) / 180 - Math.PI / 2), (lat * Math.PI) / 180 - 0.5] as const;
}

/**
 * The Magic UI globe (made with cobe), with a dot for each region. It turns
 * to face `focus`, and spins slowly when `focus` has no place on the map.
 * Dragging turns it by hand until `focus` changes.
 */
export function RegionGlobe({
  regions,
  focus,
  className,
}: {
  regions: string[];
  focus?: string;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // The globe draws every frame; it reads the latest props from here.
  const latest = useRef({ regions, focus });
  useEffect(() => {
    latest.current = { regions, focus };
  });
  const colors = useTheme().resolvedTheme === "dark" ? DARK : LIGHT;

  useEffect(() => {
    const element = canvas.current!;
    let width = element.offsetWidth;
    let phi = 0;
    let theta = 0.3;
    let grab: number | null = null;
    let free = false;
    let followed = latest.current.focus;

    const resize = new ResizeObserver(() => (width = element.offsetWidth));
    resize.observe(element);

    const down = (event: PointerEvent) => {
      grab = event.clientX;
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (grab === null) return;
      phi += (event.clientX - grab) / 160;
      grab = event.clientX;
      free = true;
    };
    const up = () => (grab = null);
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);

    const { other, ...options } = colors;
    const globe = createGlobe(element, {
      ...(options as unknown as Partial<COBEOptions>),
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi,
      theta,
      mapSamples: 16000,
      markers: [],
      onRender: (state) => {
        const { regions, focus } = latest.current;
        if (focus !== followed) {
          followed = focus;
          free = false;
        }
        const target = focus && !free ? place(focus) : undefined;
        if (target && grab === null) {
          // Take the short way round.
          const [to, tilt] = facing(target);
          const ahead = (((to - phi) % TAU) + TAU) % TAU;
          const behind = (((phi - to) % TAU) + TAU) % TAU;
          phi += ahead < behind ? ahead * 0.08 : -behind * 0.08;
          theta += (tilt - theta) * 0.08;
        } else if (grab === null) {
          // Nowhere to face: spin slowly, tilted a little to the north.
          phi += 0.003;
          theta += (0.3 - theta) * 0.05;
        }
        state.phi = phi;
        state.theta = theta;
        state.width = width * 2;
        state.height = width * 2;
        const markers = regions.flatMap((name) => {
          const location = place(name);
          if (!location) return [];
          const on = name === focus;
          return [{ location, size: on ? 0.09 : 0.05, color: on ? options.markerColor : other }];
        });
        // cobe 0.6 draws only the first half of markers set here, so send them twice.
        state.markers = [...markers, ...markers];
      },
    } as COBEOptions);
    element.style.opacity = "1";

    return () => {
      globe.destroy();
      resize.disconnect();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
  }, [colors]);

  return (
    <canvas
      // A new canvas per theme: cobe can't draw again on one it has let go of.
      key={colors.dark}
      ref={canvas}
      aria-hidden
      className={cn(
        "aspect-square cursor-grab touch-pan-y opacity-0 transition-opacity duration-700 active:cursor-grabbing",
        className,
      )}
    />
  );
}
