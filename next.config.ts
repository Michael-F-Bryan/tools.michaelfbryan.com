import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

import { generateEntryHistory } from "./src/lib/entry-history-generator";

const nextConfig: NextConfig = {};

export default async function config(phase: string): Promise<NextConfig> {
  // Entries import generated history (see `src/lib/entry-history.ts`), so it
  // must exist before the app's module graph compiles.
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD) {
    await generateEntryHistory({ repoRoot: process.cwd() });
  }

  return nextConfig;
}
