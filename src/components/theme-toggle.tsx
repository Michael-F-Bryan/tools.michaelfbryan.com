"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import { Menu } from "@base-ui/react/menu";
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
    <Menu.Root modal={false}>
      <Menu.Trigger
        disabled={!hydrated}
        aria-label="Colour theme"
        title={`Colour theme: ${preference}`}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" stroke="none" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4} className="z-50">
          <Menu.Popup aria-label="Colour theme" className="w-42 border border-rule-subtle bg-surface p-1 shadow-lg outline-none">
            <Menu.RadioGroup value={preference} onValueChange={choose}>
              {OPTIONS.map((option) => (
                <Menu.RadioItem
                  key={option.value}
                  value={option.value}
                  closeOnClick
                  className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 text-base text-secondary outline-none data-[checked]:bg-panel data-[checked]:text-ink data-[highlighted]:bg-panel data-[highlighted]:text-ink focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <span aria-hidden="true" className="w-4 shrink-0">
                    <Menu.RadioItemIndicator>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="m3 8 3 3 7-7" />
                      </svg>
                    </Menu.RadioItemIndicator>
                  </span>
                  {option.label}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
