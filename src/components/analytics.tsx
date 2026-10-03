"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { sanitizePathname, sanitizeReferrer } from "./analytics-sanitize";

const DATA_LAYER_NAME = "dataLayer";

export type AnalyticsProps = Readonly<{ gaId: string }>;

/** Forward the real gtag command shape, an arguments object. */
function gtag(...args: unknown[]): void {
  const w = window as unknown as Record<string, unknown[]>;
  w[DATA_LAYER_NAME] = w[DATA_LAYER_NAME] || [];
  void args;
  // Google's command queue expects an arguments object, not an array.
  // eslint-disable-next-line prefer-rest-params
  w[DATA_LAYER_NAME].push(arguments);
}

function sanitizedDefaults(pathname: string) {
  const path = sanitizePathname(pathname);
  return {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
    page_referrer: sanitizeReferrer(document.referrer),
  };
}

/**
 * A sanitised replacement for `@next/third-parties/google`'s
 * `<GoogleAnalytics>` — see `analytics-sanitize.ts` for why the stock
 * component isn't safe to use directly here, and why route-exclusion alone
 * isn't either. GA's own automatic page_view is disabled
 * (`send_page_view: false`); this fires an explicit one by hand instead,
 * and — on every route, including the tool — refreshes GA's global default
 * `page_location`/`page_path`/`page_referrer` via `gtag('set', ...)` so
 * that any hit GA's Enhanced Measurement builds automatically in between
 * (e.g. reacting to the tool's own `replaceState` calls while editing)
 * still reads sanitised values instead of the live URL.
 */
export function Analytics({ gaId }: AnalyticsProps) {
  const pathname = usePathname();

  useEffect(() => {
    // Defensive: `next/script`'s `beforeInteractive` strategy runs the init
    // script before hydration, but this still initialises the array itself
    // rather than assuming that already happened, so this effect's own
    // `gtag` calls are never lost to ordering.
    const defaults = sanitizedDefaults(pathname);
    gtag("set", defaults);
    gtag("event", "page_view", defaults);
  }, [pathname]);

  return (
    <>
      {/* eslint-disable @next/next/no-before-interactive-script-outside-document --
          This rule predates the App Router: `node_modules/next/dist/docs/.../script.md`
          says `beforeInteractive` scripts belong in the root layout (this component is
          only ever rendered there), not `pages/_document.js`, which doesn't exist here. */}
      <Script
        id="tools-ga-init"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window['${DATA_LAYER_NAME}'] = window['${DATA_LAYER_NAME}'] || [];
            function gtag(){window['${DATA_LAYER_NAME}'].push(arguments);}
            gtag('js', new Date());
            gtag('set', {
              page_location: location.origin + location.pathname,
              page_path: location.pathname,
              page_referrer: ''
            });
            gtag('config', '${gaId}', { send_page_view: false });
          `,
        }}
      />
      <Script id="tools-ga-src" strategy="beforeInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} />
      {/* eslint-enable @next/next/no-before-interactive-script-outside-document */}
    </>
  );
}
