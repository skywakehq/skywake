"use client";

import { useEffect, useMemo, useState } from "react";
import { authClient } from "@/features/auth/auth-client";
import { withBase } from "@/lib/zone";

type Key = { id: string; name: string };

let keys: Promise<Key[]> | undefined;

/** Turns an actor like `user:abc` or `key:xyz` into a name to show: the person, or the key's name. */
export function usePeople() {
  const { data: org } = authClient.useActiveOrganization();
  const [named, setNamed] = useState<Key[]>([]);
  useEffect(() => {
    keys ??= fetch(withBase("/api/keys"))
      .then((response) => (response.ok ? response.json() : []))
      .then((body: Key[] | { data?: Key[] }) => (Array.isArray(body) ? body : (body.data ?? [])))
      .catch(() => []);
    let live = true;
    keys.then((list) => live && setNamed(list));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    const names = new Map<string, string>([
      ...(org?.members.map((m) => [`user:${m.userId}`, m.user.name] as const) ?? []),
      ...named.map((key) => [`key:${key.id}`, key.name] as const),
    ]);
    return (actor: string) =>
      names.get(actor) ?? (actor.startsWith("key:") ? `Key ${actor.slice(4, 12)}` : actor);
  }, [org, named]);
}
