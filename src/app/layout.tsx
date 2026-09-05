import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Atkinson_Hyperlegible } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const sans = Atkinson_Hyperlegible({
  subsets: ["latin"],
  variable: "--font-atkinson",
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tools.michaelfbryan.com"),
  title: {
    default: "Tools by Michael F. Bryan",
    template: "%s · Tools by Michael F. Bryan",
  },
  description:
    "Small, useful tools and visual explainers that expose the engineering judgement behind them.",
  openGraph: {
    siteName: "Tools by Michael F. Bryan",
    type: "website",
  },
};

const googleAnalyticsId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-AU" className={sans.variable}>
      <body className="min-h-screen bg-paper text-ink antialiased">
        <header className="border-b border-rule">
          <div className="mx-auto flex max-w-[70rem] items-baseline justify-between gap-6 px-5 py-5 sm:px-8">
            <Link
              href="/"
              className="font-bold tracking-[-0.015em] underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              Michael F. Bryan <span className="text-muted">/ Tools</span>
            </Link>
            <span className="hidden font-mono text-xs uppercase tracking-[0.12em] text-muted sm:inline">
              Built to be used
            </span>
          </div>
        </header>

        {children}

        <footer className="mx-auto max-w-[70rem] border-t border-rule px-5 py-8 text-sm text-muted sm:px-8">
          Small tools, concrete explanations, and the decisions behind them.
        </footer>

        {googleAnalyticsId ? (
          <GoogleAnalytics gaId={googleAnalyticsId} />
        ) : null}
      </body>
    </html>
  );
}
