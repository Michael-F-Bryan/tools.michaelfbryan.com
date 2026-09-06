import { expect, test } from "@playwright/test";

test("the catalogue opens the first explainer", async ({ page }) => {
  const description =
    "Engineering principles for turning recordings into trustworthy transcripts without hiding uncertainty or losing the source evidence.";

  await page.goto("/");

  await expect(page).toHaveTitle(/Tools by Michael F\. Bryan/);
  await expect(
    page.getByRole("heading", { name: "Tools and explainers" }),
  ).toBeVisible();

  const explainer = page.getByRole("link", {
    name: /Reliable AI-assisted transcription/,
  });

  await expect(explainer).toBeVisible();
  await expect(explainer).toContainText(description);
  await explainer.click();

  await expect(page).toHaveURL(/\/explainers\/reliable-transcription$/);
  await expect(
    page.getByRole("heading", { name: "Reliable AI-assisted transcription" }),
  ).toBeVisible();
  await expect(
    page.getByText("In development", { exact: true }),
  ).not.toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    description,
  );
});

test("the weekend explainer connects curiosity with rest", async ({ page }) => {
  const description =
    "A note for Gabbey about what I mean when I say I’m bored, and why making small things matters to my wellbeing.";

  await page.goto("/");

  const explainer = page.getByRole("link", {
    name: /Why I get restless on free weekends/,
  });

  await expect(explainer).toBeVisible();
  await expect(explainer).toContainText(description);
  await explainer.click();

  await expect(page).toHaveURL(/\/explainers\/restless-weekends$/);
  await expect(
    page.getByRole("heading", { name: "Why I get restless on free weekends" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What happens on a free Saturday" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The wedding website" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What I want you to understand" }),
  ).toBeVisible();
  await expect(
    page.getByText("“It’s not really that appealing to me.”", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This is a working explanation, not a diagnosis.", {
      exact: true,
    }),
  ).not.toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    description,
  );

  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();

  const narrowPhoneHasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(narrowPhoneHasHorizontalOverflow).toBe(false);
});
