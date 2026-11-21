"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

import { useLoop } from "@/components/art/use-loop";

const PlayContext = createContext(false);

/** A card whose picture stays still until the pointer is over it. */
export function PlayCard({ className, children }: { className?: string; children: ReactNode }) {
  const [play, setPlay] = useState(false);
  return (
    <li
      className={className}
      onPointerEnter={() => setPlay(true)}
      onPointerLeave={() => setPlay(false)}
    >
      <PlayContext value={play}>{children}</PlayContext>
    </li>
  );
}

/** A loop that only runs inside a hovered PlayCard; otherwise it rests on its finished frame. */
export function usePlayLoop<T extends HTMLElement>(ms: number, rest: number) {
  const play = useContext(PlayContext);
  const { ref, step, still } = useLoop<T>(ms, rest, play);
  const idle = still || !play;
  return { ref, step: idle ? rest : step, idle };
}
