/**
 * Pure helpers for `analytics.tsx`, kept separate so they're testable
 * without a DOM.
 *
 * `@next/third-parties/google`'s `<GoogleAnalytics>` calls
 * `gtag('config', gaId)` with no options, which makes GA4 send an automatic
 * page_view using the *current* `document.location.href` — query string
 * included. Since the root layout mounts it once for the whole site, a
 * visitor who lands directly on a tool whose state lives in the query
 * string (e.g. a shared `/timezone-clock?tz=...` link) would have that
 * state sent to Google on the very first paint.
 *
 * Simply not loading the GA script on that route isn't enough: GA4's
 * Enhanced Measurement installs a listener on `history.pushState` /
 * `replaceState` once it has loaded anywhere in the page's lifetime, and
 * that listener survives client-side navigation into the tool and can react
 * to the tool's own `replaceState` calls (used to keep the URL in sync
 * while editing) by building a hit from whatever `document.location` is at
 * that moment. Once GA has loaded once in a session, there's no way from
 * this code to "unload" that listener.
 *
 * Instead, `analytics.tsx` keeps GA's own global default parameters
 * (`page_location`, `page_path`, `page_referrer`) sanitised via
 * `gtag('set', ...)` on *every* route, including the tool, and updates them
 * on every real route change (not on the tool's own in-page edits). Any hit
 * Enhanced Measurement builds automatically — including one triggered by an
 * in-tool edit's `replaceState` — reads those same global defaults rather
 * than the live, possibly-sensitive URL.
 */

/** Strips any query string or fragment a caller might still pass in. */
export function sanitizePathname(pathname: string): string {
  const withoutQueryOrHash = pathname.split(/[?#]/, 1)[0];
  return withoutQueryOrHash || "/";
}

/** The origin + path only, dropping query/hash from a referrer URL (or "" if it can't be parsed). */
export function sanitizeReferrer(referrer: string): string {
  if (!referrer) return "";
  try {
    const url = new URL(referrer);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}
