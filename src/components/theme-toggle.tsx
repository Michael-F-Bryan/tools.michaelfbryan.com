"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  readThemePreference,
  writeThemePreference,
  type ThemeAttribute,
} from "@/lib/theme";

const OPTIONS: ReadonlyArray<{ value: ThemeAttribute; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const getServerSnapshot = (): ThemeAttribute => "system";
const subscribeHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

function subscribe(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === null || event.key === THEME_STORAGE_KEY) onStoreChange();
  }
  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
}

export function ThemeToggle() {
  // Server snapshots keep hydration consistent; the head script owns first paint.
  const preference = useSyncExternalStore(subscribe, readThemePreference, getServerSnapshot);
  const hydrated = useSyncExternalStore(subscribeHydration, getHydratedSnapshot, getServerHydratedSnapshot);

  useLayoutEffect(() => {
    if (hydrated) document.documentElement.setAttribute("data-theme", preference);
  }, [hydrated, preference]);

  function choose(next: ThemeAttribute) {
    writeThemePreference(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <fieldset disabled={!hydrated} className="flex divide-x divide-rule border border-rule text-xs">
      <legend className="sr-only">Colour theme</legend>
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className={cn(
            "flex min-h-11 cursor-pointer items-center px-2 py-1.5 font-mono uppercase tracking-label transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
            preference === option.value ? "bg-accent text-paper" : "text-secondary hover:text-ink",
          )}
        >
          <input
            type="radio"
            name="theme-preference"
            value={option.value}
            checked={preference === option.value}
            onChange={() => choose(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
