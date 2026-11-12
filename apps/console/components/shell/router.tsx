"use client";

import { usePathname } from "next/navigation";
import { type ComponentProps, type MouseEvent, useSyncExternalStore } from "react";
import { parse } from "@/lib/routes";
import { withBase } from "@/lib/zone";

// After the first load, moving between console pages never asks the server:
// the address changes with the History API, which Next follows, and the page
// is drawn from data Zero already holds in the browser.

export const useRoute = () => parse(usePathname());

export function navigate(href: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", withBase(href));
  else history.pushState(null, "", withBase(href));
  // Like a normal link, an address with #section scrolls to it once drawn.
  const id = new URL(href, location.href).hash.slice(1);
  if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView());
  // The History API is silent about #section; tell whoever follows it.
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** The address's #section, without the #. */
export function useHash() {
  return useSyncExternalStore(
    (changed) => {
      window.addEventListener("hashchange", changed);
      window.addEventListener("popstate", changed);
      return () => {
        window.removeEventListener("hashchange", changed);
        window.removeEventListener("popstate", changed);
      };
    },
    () => location.hash.slice(1),
    () => "",
  );
}

export function Link({ href, onClick, ...props }: ComponentProps<"a"> & { href: string }) {
  function open(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    // New tabs, downloads and other windows work like any link.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }
  return <a href={withBase(href)} onClick={open} {...props} />;
}
