import { expect, test } from "@playwright/test";

const description =
  "A living specimen of the shared structures used to build visual explainers on this site.";

test("the catalogue contains only the component kitchen sink", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Tools by Michael F\. Bryan/);
  await expect(
    page.getByRole("heading", { name: "Tools and explainers" }),
  ).toBeVisible();

  const catalogueEntries = page
    .getByRole("region", { name: "Catalogue" })
    .getByRole("listitem");
  await expect(catalogueEntries).toHaveCount(1);

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
    page.getByRole("heading", { name: "The page is the demonstration" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "One small vocabulary for explainers",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Steps are for sequences that really have an order",
    }),
  ).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(4);
  await expect(page.locator("dt").filter({ hasText: /^Container$/ })).toBeVisible();
  await expect(page.locator("dt").filter({ hasText: /^PageTitle$/ })).toBeVisible();
  await expect(page.locator("dt").filter({ hasText: /^Steps \/ Step$/ })).toBeVisible();
  await expect(
    page.getByText(
      "The caption explains why the picture matters instead of restating its labels.",
      { exact: true },
    ),
  ).toBeVisible();

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
