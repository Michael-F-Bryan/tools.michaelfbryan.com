import { useCallback, useRef, useSyncExternalStore } from "react";

import { parseArrangementFromSearch, type ParseResult } from "./serialization";

/** Read incoming links, not our own debounced replaceState writes. */
export function useUrlHydration(): ParseResult | null {
  const snapshot = useRef<ParseResult | null>(null);
  const getSnapshot = useCallback(() => {
    snapshot.current ??= parseArrangementFromSearch(window.location.search);
    return snapshot.current;
  }, []);
  const subscribe = useCallback((onChange: () => void) => {
    function onPopState() {
      snapshot.current = parseArrangementFromSearch(window.location.search);
      onChange();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return useSyncExternalStore<ParseResult | null>(subscribe, getSnapshot, () => null);
}
