"use client";

import { useMemo } from "react";
import { authClient } from "@/features/auth/auth-client";

/** Turns an actor like `user:abc` or `key:xyz` into a name to show. */
export function usePeople() {
  const { data: org } = authClient.useActiveOrganization();
  return useMemo(() => {
    const names = new Map(
      org?.members.map((member) => [`user:${member.userId}`, member.user.name]),
    );
    return (actor: string) =>
      names.get(actor) ?? (actor.startsWith("key:") ? `key ${actor.slice(4, 12)}` : actor);
  }, [org]);
}
