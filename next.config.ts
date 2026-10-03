import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

import { GITHUB_REPO_URL } from "./src/lib/entry";
import { generateEntryHistory } from "./src/lib/entry-history-generator";

const nextConfig: NextConfig = {};

export default async function config(phase: string): Promise<NextConfig> {
  // Entries import generated history (see `src/lib/entry-history.ts`), so it
  // must exist before the app's module graph compiles.
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD) {
    await generateEntryHistory({
      repoRoot: process.cwd(),
      fetchHistory: phase === PHASE_PRODUCTION_BUILD && process.env.VERCEL === "1"
        ? { repositoryUrl: `${GITHUB_REPO_URL}.git`, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "" }
        : undefined,
    });
  }

  return nextConfig;
}
