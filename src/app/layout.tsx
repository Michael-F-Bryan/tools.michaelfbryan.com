import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Atkinson_Hyperlegible } from "next/font/google";
import Link from "next/link";

import { Analytics } from "@/components/analytics";
import { Container } from "@/components/container";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

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
  description: "Tools and experiments by Michael F. Bryan.",
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
    <html lang="en-AU" data-theme="system" suppressHydrationWarning className={sans.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-paper text-ink antialiased">
        <header className="shrink-0 border-b border-rule">
          <Container className="flex flex-wrap items-center justify-between gap-4 py-5">
            <Link
              href="/"
              className="font-bold tracking-title underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              Michael F. Bryan <span className="text-accent">/</span>{" "}
              <span className="text-muted">Tools</span>
            </Link>
            <ThemeToggle />
          </Container>
        </header>

        {children}

        {googleAnalyticsId ? <Analytics gaId={googleAnalyticsId} /> : null}
      </body>
    </html>
  );
}
