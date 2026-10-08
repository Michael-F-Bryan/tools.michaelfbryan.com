import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

type EntryHistory =
  | { status: "available"; createdAt: string; updatedAt: string; commits: readonly { sha: string; subject: string; committedAt: string; body: string }[] }
  | { status: "unavailable"; reason: string };

const ENTRIES = [
  { slug: "afterlight", title: "Afterlight" },
  { slug: "coordinate-frame-visualiser", title: "Coordinate frame visualiser" },
  { slug: "gedcom-viewer", title: "GEDCOM family tree viewer" },
  { slug: "melbourne-morning", title: "Melbourne morning" },
  { slug: "qr-code", title: "QR code generator" },
  { slug: "timezone-clock", title: "Timezone availability clock" },
] as const;

function readGeneratedHistory(): Record<string, EntryHistory> {
  const outputPath = path.join(process.cwd(), ".generated", "entry-history.json");
  return JSON.parse(fs.readFileSync(outputPath, "utf8")) as Record<string, EntryHistory>;
}

function expectedOrder(history: Record<string, EntryHistory>): readonly (typeof ENTRIES)[number][] {
  function updatedAt(entry: (typeof ENTRIES)[number]): number {
    const entryHistory = history[entry.slug];
    return entryHistory.status === "available" ? Date.parse(entryHistory.updatedAt) : 0;
  }
  return [...ENTRIES].sort(
    (left, right) => updatedAt(right) - updatedAt(left) || left.title.localeCompare(right.title),
  );
}

test("the catalogue sorts by most recently updated, title tie-break, and shows real dates", async ({ page }) => {
  const history = readGeneratedHistory();
  const order = expectedOrder(history);

  await page.goto("/");
  const titles = await page
    .getByRole("region", { name: "Catalogue" })
    .getByRole("listitem")
    .locator("span.text-xl")
    .allTextContents();
  expect(titles).toEqual(order.map((entry) => entry.title));

  for (const entry of order) {
    const entryHistory = history[entry.slug];
    const row = page.getByRole("link", { name: new RegExp(entry.title) });
    if (entryHistory.status === "available") {
      const expected = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(entryHistory.updatedAt));
      await expect(row.getByText(`Last updated ${expected}`)).toBeVisible();
    } else {
      await expect(row.getByText("Last updated date unavailable")).toBeVisible();
    }
  }
});

for (const entry of ENTRIES) {
 test(`development history for ${entry.slug} shows only its own commits`, async ({ page }) => {
  const history = readGeneratedHistory();
  const entryHistory = history[entry.slug];
  if (entryHistory.status !== "available") throw new Error("unreachable");

  await page.goto(`/${entry.slug}`);
  await expect(page.getByText(/^Updated /)).toBeVisible();
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute(
    "href",
    `https://github.com/Michael-F-Bryan/tools.michaelfbryan.com/tree/main/src/entries/${entry.slug}`,
  );

  const trigger = page.getByRole("button", { name: "Development history" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: `${entry.title} — Development history` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`src/entries/${entry.slug}`)).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(entryHistory.commits.length);
  const links = await dialog.getByRole("listitem").getByRole("link").evaluateAll(
    (elements) => elements.map((element) => element.getAttribute("href")),
  );
  expect(links).toEqual(entryHistory.commits.map((commit) =>
    `https://github.com/Michael-F-Bryan/tools.michaelfbryan.com/commit/${commit.sha}`,
  ));

  const latest = entryHistory.commits[0];
  await expect(dialog.getByText(latest.subject)).toBeVisible();
  const commitLink = dialog.getByRole("link", { name: latest.sha.slice(0, 7) });
  await expect(commitLink).toHaveAttribute(
    "href",
    `https://github.com/Michael-F-Bryan/tools.michaelfbryan.com/commit/${latest.sha}`,
  );

  // Escape dismisses the dialog and returns focus to its trigger.
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
}

test("the development history dialog closes with its close button and fits narrow viewports without overflow", async ({ page }, testInfo) => {
  const history = readGeneratedHistory();
  const entry = ENTRIES.find((candidate) => history[candidate.slug]?.status === "available");
  if (!entry) throw new Error("No entry with available history to test against.");

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/${entry.slug}`);

  const trigger = page.getByRole("button", { name: "Development history" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: `${entry.title} — Development history` });
  await expect(dialog).toBeVisible();

  const overflowsViewport = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflowsViewport).toBe(false);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
  // The tool's positioned visualisations must never paint over the dialog.
  await expect.poll(() => dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.bottom - 8);
    return hit !== null && element.contains(hit);
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("history-mobile.png"), animations: "disabled" });

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("an entry with no recorded history yet states that plainly instead of showing fabricated dates", async ({ page }) => {
  const history = readGeneratedHistory();
  const unavailableEntry = ENTRIES.find((candidate) => history[candidate.slug]?.status === "unavailable");
  test.skip(!unavailableEntry, "Every discovered entry currently has recorded history in this checkout.");
  if (!unavailableEntry) return;

  await page.goto(`/${unavailableEntry.slug}`);
  await expect(page.getByText("Updated date unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Development history" }).click();
  await expect(page.getByText(/doesn.t have recorded development history yet/)).toBeVisible();
});
