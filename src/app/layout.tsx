import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import { Atkinson_Hyperlegible } from "next/font/google";
import Link from "next/link";

import { Container } from "@/components/container";

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
  description: "Tools and explainers by Michael F. Bryan.",
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
          <Container className="py-5">
            <Link
              href="/"
              className="font-bold tracking-title underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              Michael F. Bryan <span className="text-accent">/</span>{" "}
              <span className="text-muted">Tools</span>
            </Link>
          </Container>
        </header>

        {children}

        {googleAnalyticsId ? (
          <GoogleAnalytics gaId={googleAnalyticsId} />
        ) : null}
      </body>
    </html>
  );
}
