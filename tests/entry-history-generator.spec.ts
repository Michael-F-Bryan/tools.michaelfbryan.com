import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { generateEntryHistory } from "../src/lib/entry-history-generator";

function run(repo: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function initRepo(repo: string) {
  run(repo, ["init", "-q"]);
  run(repo, ["config", "user.name", "Test"]);
  run(repo, ["config", "user.email", "test@example.com"]);
  run(repo, ["config", "commit.gpgsign", "false"]);
}

function writeEntryFile(repo: string, slug: string, filename: string, content: string) {
  const dir = path.join(repo, "src", "entries", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

function writeSharedFile(repo: string, filename: string, content: string) {
  const dir = path.join(repo, "src", "components");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

function commitAll(repo: string, message: string, options: Readonly<{ date?: string; body?: string }> = {}) {
  run(repo, ["add", "-A"]);
  const fullMessage = options.body ? `${message}\n\n${options.body}` : message;
  const env = { ...process.env };
  if (options.date) {
    env.GIT_AUTHOR_DATE = options.date;
    env.GIT_COMMITTER_DATE = options.date;
  }
  execFileSync("git", ["commit", "-q", "-m", fullMessage], { cwd: repo, env, stdio: ["ignore", "pipe", "ignore"] });
  return run(repo, ["rev-parse", "HEAD"]).trim();
}

function makeTempRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "entry-history-"));
  initRepo(repo);
  return repo;
}

test("records real commits per entry, newest first, excluding shared infrastructure", async () => {
  const repo = makeTempRepo();

  writeEntryFile(repo, "alpha", "definition.ts", "export const definition = {};\n");
  const first = commitAll(repo, "feat: add alpha", { date: "2024-01-01T10:00:00+00:00" });

  writeEntryFile(repo, "beta", "definition.ts", "export const definition = {};\n");
  commitAll(repo, "feat: add beta", { date: "2024-01-02T10:00:00+00:00" });

  writeEntryFile(repo, "alpha", "content.tsx", "export default function Alpha() { return null; }\n");
  const second = commitAll(repo, "feat: improve alpha", {
    date: "2024-01-03T10:00:00+00:00",
    body: "A longer explanation\nacross two lines.",
  });

  // Touches only shared infrastructure outside any entry directory; must
  // never be attributed to an entry's own history.
  writeSharedFile(repo, "shared.ts", "export const shared = 1;\n");
  commitAll(repo, "chore: tweak shared component", { date: "2024-01-04T10:00:00+00:00" });

  const history = await generateEntryHistory({ repoRoot: repo });

  expect(history.alpha.status).toBe("available");
  if (history.alpha.status !== "available") throw new Error("unreachable");
  expect(history.alpha.commits).toHaveLength(2);
  expect(history.alpha.commits[0].sha).toBe(second);
  expect(history.alpha.commits[0].subject).toBe("feat: improve alpha");
  expect(history.alpha.commits[0].body).toBe("A longer explanation\nacross two lines.");
  expect(history.alpha.commits[1].sha).toBe(first);
  expect(history.alpha.commits[1].subject).toBe("feat: add alpha");
  expect(history.alpha.commits.every((commit) => /^[0-9a-f]{40}$/.test(commit.sha))).toBe(true);
  expect(history.alpha.createdAt).toBe("2024-01-01T10:00:00Z");
  expect(history.alpha.updatedAt).toBe("2024-01-03T10:00:00Z");

  expect(history.beta.status).toBe("available");
  if (history.beta.status !== "available") throw new Error("unreachable");
  expect(history.beta.commits).toHaveLength(1);

  fs.rmSync(repo, { recursive: true, force: true });
});

test("a new, uncommitted entry gets an explicit unavailable status, not fabricated dates", async () => {
  const repo = makeTempRepo();
  writeEntryFile(repo, "alpha", "definition.ts", "export const definition = {};\n");
  commitAll(repo, "feat: add alpha");

  // "gamma" exists on disk (as a freshly scaffolded entry would) but was
  // never committed.
  writeEntryFile(repo, "gamma", "definition.ts", "export const definition = {};\n");

  const history = await generateEntryHistory({ repoRoot: repo });

  expect(history.gamma).toEqual({
    status: "unavailable",
    reason: "No commits touch src/entries/gamma yet.",
  });

  fs.rmSync(repo, { recursive: true, force: true });
});

test("breaks the tie deterministically when two commits share a committer timestamp", async () => {
  const repo = makeTempRepo();
  const sameInstant = "2024-05-01T00:00:00+00:00";

  writeEntryFile(repo, "delta", "definition.ts", "export const definition = {};\n");
  const commitA = commitAll(repo, "feat: add delta", { date: sameInstant });

  writeEntryFile(repo, "delta", "extra.ts", "export const extra = 1;\n");
  const commitB = commitAll(repo, "feat: extend delta", { date: sameInstant });

  const history = await generateEntryHistory({ repoRoot: repo });

  expect(history.delta.status).toBe("available");
  if (history.delta.status !== "available") throw new Error("unreachable");
  const shas = history.delta.commits.map((commit) => commit.sha);
  expect(shas).toEqual([...shas].sort());
  expect(new Set(shas)).toEqual(new Set([commitA, commitB]));

  fs.rmSync(repo, { recursive: true, force: true });
});

test("fails clearly instead of publishing wrong dates for a shallow clone", async () => {
  const repo = makeTempRepo();
  writeEntryFile(repo, "alpha", "definition.ts", "export const definition = {};\n");
  commitAll(repo, "feat: add alpha", { date: "2024-01-01T10:00:00+00:00" });
  writeEntryFile(repo, "alpha", "content.tsx", "export default function Alpha() { return null; }\n");
  commitAll(repo, "feat: improve alpha", { date: "2024-01-02T10:00:00+00:00" });

  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), "entry-history-shallow-"));
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${repo}`, shallow], { stdio: ["ignore", "pipe", "ignore"] });

  await expect(generateEntryHistory({ repoRoot: shallow })).rejects.toThrow(/shallow/i);

  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(shallow, { recursive: true, force: true });
});

test("fails clearly when there is no git repository at all", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "entry-history-plain-"));
  writeEntryFile(plain, "alpha", "definition.ts", "export const definition = {};\n");

  await expect(generateEntryHistory({ repoRoot: plain })).rejects.toThrow(/git/i);

  fs.rmSync(plain, { recursive: true, force: true });
});

test("directory moves retain earlier commits without attributing another tool's history", async () => {
  const repo = makeTempRepo();
  writeEntryFile(repo, "tools/alpha", "definition.ts", "export const definition = {};\n");
  const created = commitAll(repo, "add alpha", { date: "2024-01-01T00:00:00Z" });
  writeEntryFile(repo, "tools/alpha", "logic.ts", "export const value = 1;\n");
  const logic = commitAll(repo, "improve alpha logic", { date: "2024-01-02T00:00:00Z" });
  writeEntryFile(repo, "tools/beta", "definition.ts", "export const definition = {};\n");
  const unrelated = commitAll(repo, "add similar beta", { date: "2024-01-03T00:00:00Z" });
  fs.renameSync(path.join(repo, "src/entries/tools/alpha"), path.join(repo, "src/entries/alpha"));
  const moved = commitAll(repo, "flatten alpha", { date: "2024-01-04T00:00:00Z" });
  const history = await generateEntryHistory({ repoRoot: repo });
  expect(history.alpha.status).toBe("available");
  if (history.alpha.status !== "available") throw new Error("unreachable");
  expect(history.alpha.commits.map((commit) => commit.sha)).toEqual([moved, logic, created]);
  expect(history.alpha.commits.map((commit) => commit.sha)).not.toContain(unrelated);
  expect(history.alpha.createdAt).toBe("2024-01-01T00:00:00Z");
  fs.rmSync(repo, { recursive: true, force: true });
});

test("does not rewrite the output file when its content is unchanged", async () => {
  const repo = makeTempRepo();
  writeEntryFile(repo, "alpha", "definition.ts", "export const definition = {};\n");
  commitAll(repo, "feat: add alpha", { date: "2024-01-01T10:00:00+00:00" });

  const outputPath = path.join(repo, ".generated", "entry-history.json");
  await generateEntryHistory({ repoRoot: repo, outputPath });
  const firstWrite = fs.statSync(outputPath).mtimeMs;

  await new Promise((resolve) => setTimeout(resolve, 20));
  await generateEntryHistory({ repoRoot: repo, outputPath });
  const secondWrite = fs.statSync(outputPath).mtimeMs;

  expect(secondWrite).toBe(firstWrite);

  fs.rmSync(repo, { recursive: true, force: true });
});
