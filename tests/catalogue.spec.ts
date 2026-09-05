import { expect, test } from "@playwright/test";

test("the catalogue opens the first explainer", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Tools by Michael F\. Bryan/);
  await expect(
    page.getByRole("heading", { name: "Tools and explainers" }),
  ).toBeVisible();

  const explainer = page.getByRole("link", {
    name: /Reliable AI-assisted transcription/,
  });

  await expect(explainer).toBeVisible();
  await explainer.click();

  await expect(page).toHaveURL(/\/explainers\/reliable-transcription$/);
  await expect(
    page.getByRole("heading", { name: "Reliable AI-assisted transcription" }),
  ).toBeVisible();
  await expect(page.getByText("In development", { exact: true })).toBeVisible();
});
