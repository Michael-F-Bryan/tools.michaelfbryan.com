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
  await expect(page.getByText("In development", { exact: true })).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    description,
  );
});
