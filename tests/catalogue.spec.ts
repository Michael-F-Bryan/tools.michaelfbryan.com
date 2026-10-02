import { expect, test } from "@playwright/test";

test("the catalogue opens entries at flat routes without publishing the reference", async ({ page }) => {
  await page.goto("/");
  const catalogue = page.getByRole("region", { name: "Catalogue" });
  await expect(catalogue.getByRole("listitem")).toHaveCount(3);
  await expect(catalogue.getByRole("link", { name: /kitchen sink/i })).toHaveCount(0);

  for (const [title, href] of [
    ["Coordinate frame visualiser", "/coordinate-frame-visualiser"],
    ["GEDCOM family tree viewer", "/gedcom-viewer"],
    ["Melbourne morning", "/melbourne-morning"],
  ]) {
    await page.goto("/");
    const link = page.getByRole("link", { name: new RegExp(title) });
    await expect(link).toHaveAttribute("href", href);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText(/^(Tool|Explainer)$/)).toHaveCount(0);
  }
});

test("the catalogue gives entries decorative previews and keyboard focus", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tools & experiments", exact: true })).toBeVisible();
  const rows = page.getByRole("region", { name: "Catalogue" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) {
    await expect(row.locator('[aria-hidden="true"] svg')).toBeVisible();
  }
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const firstLink = rows.first().getByRole("link");
  await expect(firstLink).toBeFocused();
  expect(await firstLink.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const row of await rows.all()) {
    await expect(row.locator('[aria-hidden="true"] svg')).toBeVisible();
  }
});

test("the kitchen sink renders every shared explainer structure", async ({
  page,
}) => {
  await page.goto("/reference/components");
  await expect(page).toHaveTitle(/Explainer component kitchen sink/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Every shared explainer component on one page, so I can compare them without hunting through old entries.",
  );

  await expect(
    page.getByRole("heading", {
      name: "Opening seven files is a lousy way to check a design",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The shared parts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Don’t make a component after seeing something once",
    }),
  ).toBeVisible();
  await expect(
    page.locator('section[aria-labelledby="ordered-sequence"]').getByRole("listitem"),
  ).toHaveCount(4);
  await expect(page.locator("dt").filter({ hasText: /^Container$/ })).toBeVisible();
  await expect(page.locator("dt").filter({ hasText: /^PageTitle$/ })).toBeVisible();
  await expect(page.locator("dt").filter({ hasText: /^Steps \/ Step$/ })).toBeVisible();
  await expect(
    page.getByText(
      "Repetition alone is not enough. Share only when the same job appears on more than one page.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Repeated use, same job", { exact: true })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();

  const narrowPhoneHasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(narrowPhoneHasHorizontalOverflow).toBe(false);
});

test("the shared shell uses the accepted cool palette", async ({ page }) => {
  await page.goto("/reference/components");

  const palette = await page.evaluate(() => ({
    accent: getComputedStyle(
      [...document.querySelectorAll("span")].find(
        (element) => element.textContent === "Why this exists",
      )!,
    ).color,
    background: getComputedStyle(document.body).backgroundColor,
    rule: getComputedStyle(document.querySelector("body > header")!).borderBottomColor,
  }));

  expect(palette).toEqual({
    accent: "rgb(22, 77, 204)",
    background: "rgb(249, 250, 251)",
    rule: "rgb(132, 141, 152)",
  });
});

test("the explainer provides useful in-page navigation", async ({ page }) => {
  await page.goto("/reference/components");

  const contents = page.getByRole("navigation", { name: "On this page" });
  await expect(contents).toBeVisible();
  await expect(contents.getByRole("link")).toHaveCount(6);

  await contents.getByRole("link", { name: "The shared parts" }).click();

  await expect(page).toHaveURL(/#component-inventory$/);
  await expect(
    page.getByRole("heading", { name: "The shared parts" }),
  ).toBeInViewport();
});
