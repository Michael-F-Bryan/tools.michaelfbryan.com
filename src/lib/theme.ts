/**
 * The theme preference persisted to `localStorage`. Absence of the key (or
 * an unrecognised value) means "System" — the default — which is resolved
 * live by the `prefers-color-scheme` media query in `globals.css`, not
 * stored explicitly.
 */
export const THEME_STORAGE_KEY = "theme";

/** Same-tab signal: a `storage` event never fires in the tab that wrote it. */
export const THEME_CHANGE_EVENT = "theme-preference-change";

export type ThemePreference = "light" | "dark";

/** What `<html data-theme>` is set to: an explicit preference, or "system". */
export type ThemeAttribute = ThemePreference | "system";

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark";
}

// Retain a choice for this tab when storage is unavailable.
let memoryPreference: ThemeAttribute = "system";
let storageWriteFailed = false;

export function readThemePreference(): ThemeAttribute {
  if (storageWriteFailed) return memoryPreference;
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return memoryPreference;
  }
}

export function writeThemePreference(next: ThemeAttribute): void {
  memoryPreference = next;
  try {
    if (next === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    }
    storageWriteFailed = false;
  } catch {
    storageWriteFailed = true;
  }
}

/**
 * Run from `<head>` via `dangerouslySetInnerHTML` before the browser paints,
 * so a returning visitor's explicit choice applies without a flash. Mirrors
 * {@link readThemePreference}'s storage lookup; kept in sync by hand since
 * the script runs before any module graph loads.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var v=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v)}}catch(e){}})()`;
