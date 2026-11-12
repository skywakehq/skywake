import * as React from "react";

const MOBILE = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(MOBILE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE).matches,
    () => false,
  );
}
