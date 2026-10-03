import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { EntryCommit, EntryHistory } from "./entry-history";

/**
 * Only used by `next.config.ts` (never part of the app's own module graph)
 * and the generator's own tests — kept out of `entry-history.ts` so the
 * app's server bundle never reaches this file's dynamic `outputPath`
 * writes, which would otherwise make Turbopack trace (and ship) the whole
 * project as a false-positive "this might read anything" precaution.
 */
export type GenerateEntryHistoryOptions = Readonly<{
  /** The git working tree to read commits from. */
  repoRoot: string;
  /** Defaults to `<repoRoot>/src/entries`. */
  entriesDir?: string;
  /** Defaults to `<repoRoot>/.generated/entry-history.json`. */
  outputPath?: string;
}>;

const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

/**
 * A shallow clone (common for CI/deploy checkouts) silently truncates commit
 * history, which would make "created"/"updated" dates wrong rather than
 * absent. Fail loudly instead of publishing a plausible-looking lie.
 */
function assertUsableGitHistory(repoRoot: string): void {
  let insideWorkTree: string;
  try {
    insideWorkTree = git(repoRoot, ["rev-parse", "--is-inside-work-tree"]).trim();
  } catch {
    throw new Error(
      `Entry development history requires a git working tree, but none was found at "${repoRoot}". ` +
        "Clone the repository (rather than downloading a source archive) before running `pnpm dev` or `pnpm build`.",
    );
  }
  if (insideWorkTree !== "true") {
    throw new Error(`"${repoRoot}" is not inside a git working tree; cannot generate entry development history.`);
  }

  const isShallow = git(repoRoot, ["rev-parse", "--is-shallow-repository"]).trim();
  if (isShallow === "true") {
    throw new Error(
      "This git checkout is shallow, so entry development history would be incomplete or wrong. " +
        "Fetch full history (`git fetch --unshallow`, or `fetch-depth: 0` in CI) before running `pnpm dev` or `pnpm build`.",
    );
  }
}

function discoverEntrySlugs(entriesDir: string): readonly string[] {
  return fs
    .readdirSync(entriesDir, { withFileTypes: true })
    .filter((item) => item.isDirectory() && fs.existsSync(path.join(entriesDir, item.name, "definition.ts")))
    .map((item) => item.name)
    .sort();
}

function toGitPathspec(repoRoot: string, entryDir: string): string {
  return path.relative(repoRoot, entryDir).split(path.sep).join("/");
}

/** Real commits touching the complete entry directory, newest first. */
function loadCommits(repoRoot: string, pathspec: string): readonly EntryCommit[] {
  const format = `tformat:${["%H", "%ct", "%cI", "%s", "%b"].join(FIELD_SEPARATOR)}${RECORD_SEPARATOR}`;
  const slug = path.posix.basename(pathspec);
  // Entries previously lived under tools/ or explainers/. Include those
  // known source directories so the catalogue flattening does not reset
  // their history. Following definition.ts alone is unsafe: Git can mistake
  // similar entry definitions for renames between unrelated tools.
  const sourcePaths = [pathspec, `src/entries/tools/${slug}`, `src/entries/explainers/${slug}`];
  const output = git(repoRoot, ["log", `--format=${format}`, "--", ...sourcePaths]);

  const parsed = output
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha, epochText, committedAt, subject, ...bodyParts] = record.split(FIELD_SEPARATOR);
      return {
        sha,
        epoch: Number(epochText),
        committedAt,
        subject,
        body: bodyParts.join(FIELD_SEPARATOR),
      };
    });

  // Git's own log order mixes topology with time; sort explicitly so
  // "newest first" is guaranteed, with a deterministic tie-break for
  // same-second commits instead of depending on git's internal order.
  parsed.sort((left, right) => right.epoch - left.epoch || left.sha.localeCompare(right.sha));

  return parsed.map(({ sha, committedAt, subject, body }) => ({ sha, committedAt, subject, body }));
}

/**
 * Discovers `src/entries/*` directories and records the real commits that
 * touched each complete directory (so shared infrastructure changes under
 * `src/components` or `src/lib` are never attributed to a tool). Writes the
 * result to `outputPath`, skipping the write when the content is unchanged.
 */
export async function generateEntryHistory(
  options: GenerateEntryHistoryOptions,
): Promise<Record<string, EntryHistory>> {
  const { repoRoot } = options;
  const entriesDir = options.entriesDir ?? path.join(repoRoot, "src", "entries");
  const outputPath = options.outputPath ?? path.join(repoRoot, ".generated", "entry-history.json");

  assertUsableGitHistory(repoRoot);

  const history: Record<string, EntryHistory> = {};
  for (const slug of discoverEntrySlugs(entriesDir)) {
    const pathspec = toGitPathspec(repoRoot, path.join(entriesDir, slug));
    const commits = loadCommits(repoRoot, pathspec);
    history[slug] = commits.length
      ? { status: "available", createdAt: commits[commits.length - 1].committedAt, updatedAt: commits[0].committedAt, commits }
      : { status: "unavailable", reason: `No commits touch ${pathspec} yet.` };
  }

  const serialized = `${JSON.stringify(history, null, 2)}\n`;
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : undefined;
  if (existing !== serialized) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized);
  }

  return history;
}
