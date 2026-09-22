import { expect, test } from "@playwright/test";

const description =
  "Every shared explainer component on one page, so I can compare them without hunting through old entries.";

test("the catalogue lists every discovered entry and opens one", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Tools by Michael F\. Bryan/);
  await expect(
    page.getByRole("heading", { name: "Tools and explainers" }),
  ).toBeVisible();

  const catalogueEntries = page
    .getByRole("region", { name: "Catalogue" })
    .getByRole("listitem");
  await expect(catalogueEntries).toHaveCount(3);

  const tool = page.getByRole("link", {
    name: /Coordinate frame visualiser/,
  });
  await expect(tool).toBeVisible();

  const explainer = page.getByRole("link", {
    name: /Explainer component kitchen sink/,
  });

  await expect(explainer).toContainText(description);
  await explainer.click();

  await expect(page).toHaveURL(/\/explainers\/component-kitchen-sink$/);
  await expect(
    page.getByRole("heading", { name: "Explainer component kitchen sink" }),
  ).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    description,
  );
});

test("the kitchen sink renders every shared explainer structure", async ({
  page,
}) => {
  await page.goto("/explainers/component-kitchen-sink");

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
  await page.goto("/explainers/component-kitchen-sink");

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
  await page.goto("/explainers/component-kitchen-sink");

  const contents = page.getByRole("navigation", { name: "On this page" });
  await expect(contents).toBeVisible();
  await expect(contents.getByRole("link")).toHaveCount(6);

  await contents.getByRole("link", { name: "The shared parts" }).click();

  await expect(page).toHaveURL(/#component-inventory$/);
  await expect(
    page.getByRole("heading", { name: "The shared parts" }),
  ).toBeInViewport();
});
