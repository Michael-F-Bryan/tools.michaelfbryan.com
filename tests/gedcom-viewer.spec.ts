import { expect, test, type Page } from "@playwright/test";

const URL = "/tools/gedcom-viewer";
const tree = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Ada /North/
1 BIRT
2 DATE 1900
2 PLAC Lake Town
0 @I2@ INDI
1 NAME Sam /North/
0 @I3@ INDI
1 NAME Kit /North/
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 CHIL @I3@
0 TRLR`;

async function upload(page: Page, text = tree, name = "synthetic.ged") {
  await page.getByLabel("Load GEDCOM").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
}

test("opens empty, then imports a local tree and navigates relationships", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /GEDCOM family tree viewer/ }).click();
  await expect(page).toHaveURL(new RegExp(`${URL}$`));
  await expect(page.getByText("Private to this tab")).toBeVisible();
  await expect(page.locator("[data-person-node]")).toHaveCount(0);
  await upload(page);
  await expect(page.getByRole("status")).toContainText("3 people loaded");
  await expect(page.locator("[data-person-node]")).toHaveCount(3);
  await expect(page.locator("[data-parent-edge]")).toHaveCount(2);
  await expect(page.locator("[data-partner-edge]")).toHaveCount(1);
  await page.getByRole("button", { name: /Ada North/ }).first().click();
  await expect(page.getByRole("region", { name: "Person details" })).toContainText("Lake Town");
  await page.getByRole("region", { name: "Person details" }).getByRole("button", { name: /Kit North/ }).click();
  await expect(page.getByRole("region", { name: "Person details" })).toContainText("Ada North");
});

test("search distinguishes names and invalid imports preserve the current tree", async ({ page }) => {
  await page.goto(URL);
  await upload(page, tree.replace("0 @F1@ FAM", "0 @I4@ INDI\n1 NAME Ada /North/\n1 BIRT\n2 DATE 1920\n0 @F1@ FAM"));
  await page.getByLabel("Find someone").fill("Ada");
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results.getByRole("button", { name: /Ada North/ })).toHaveCount(2);
  await results.getByRole("button", { name: /1920/ }).click();
  await expect(page.getByRole("region", { name: "Person details" })).toContainText("1920");
  await upload(page, tree.replace("5.5.1", "7.0"), "invalid.ged");
  await expect(page.getByRole("alert").filter({ hasText: "Unsupported GEDCOM version" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("synthetic.ged");
  await expect(page.getByRole("status")).toContainText("4 people loaded");
  await page.reload();
  await expect(page.locator("[data-person-node]")).toHaveCount(0);
});

test("mobile controls and graph remain reachable without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(URL);
  await upload(page);
  await page.getByLabel("Find someone").fill("Ada");
  await page.getByRole("region", { name: "Search results" }).getByRole("button").first().click();
  const scene = page.locator("svg[aria-label='Family relationship graph']");
  const box = await scene.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(160);
  await expect(page.getByRole("button", { name: "Fit whole tree" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close details" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("surname accents distinguish branches without changing edge semantics", async ({ page }) => {
  await page.goto(URL);
  await upload(page, tree.replace("Sam /North/", "Sam /South/"));
  const nodes = page.locator("[data-person-node]");
  const north = await nodes.nth(0).locator("circle").first().getAttribute("stroke");
  const south = await nodes.nth(1).locator("circle").first().getAttribute("stroke");
  expect(north).not.toBe(south);
  await expect(page.locator("[data-parent-edge]")).toHaveCount(2);
  await expect(page.locator("[data-partner-edge]")).toHaveCount(1);
});

test("resource and charset errors do not replace a loaded tree", async ({ page }) => {
  await page.goto(URL);
  await upload(page);
  await upload(page, tree.replace("UTF-8", "ANSEL"), "ansel.ged");
  await expect(page.getByRole("alert").filter({ hasText: "Unsupported character set" })).toBeVisible();
  await upload(page, tree + "\n" + "x".repeat(2 * 1024 * 1024), "large.ged");
  await expect(page.getByRole("alert").filter({ hasText: "2 MiB" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("synthetic.ged");
});

test("loading a second file resets search and selection", async ({ page }) => {
  await page.goto(URL);
  await upload(page);
  await page.getByLabel("Find someone").fill("Ada");
  await page.getByRole("region", { name: "Search results" }).getByRole("button").first().click();
  await upload(page, tree.replaceAll("North", "South"), "second.ged");
  await expect(page.getByRole("status")).toContainText("second.ged");
  await expect(page.getByRole("region", { name: "Person details" })).not.toContainText("Ada North");
  await page.getByLabel("Find someone").fill("South");
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("button")).toHaveCount(3);
});

test("imported text stays in memory and is rendered as text", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url() + " " + (request.postData() ?? "")));
  await page.goto(URL);
  await upload(page, tree.replace("Ada /North/", "<img src=x onerror=alert(1)> /North/"));
  await page.getByLabel("Find someone").fill("onerror");
  await page.getByRole("region", { name: "Search results" }).getByRole("button").click();
  await expect(page.locator("img[src=x]")).toHaveCount(0);
  expect(page.url()).not.toContain("onerror");
  expect(requests.join(" ")).not.toContain("onerror");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});


test("background pointer drag pans and cancelled touch stops panning", async ({ page }, testInfo) => {
  await page.goto(URL);
  await upload(page);
  const svg = page.locator("svg[aria-label='Family relationship graph']");
  const transform = () => svg.locator("g[transform]").first().getAttribute("transform");
  const before = await transform();
  const box = (await svg.boundingBox())!;
  if (testInfo.project.name === "desktop-chromium") {
    await page.mouse.move(box.x + 80, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 120, { steps: 5 });
    await page.mouse.up();
    expect(await transform()).not.toBe(before);
  }
  const moved = await transform();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 80, y: box.y + 80, id: 101 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 120, y: box.y + 100, id: 101 }] });
  await expect.poll(transform).not.toBe(moved);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  const cancelled = await transform();
  await svg.evaluate((element) => element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 101, pointerType: "touch", clientX: 300, clientY: 300 })));
  expect(await transform()).toBe(cancelled);
});

test("wheel zoom anchors under cursor and does not scroll page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-chromium", "No physical wheel on touch device");
  await page.goto(URL);
  await upload(page);
  const svg = page.locator("svg[aria-label='Family relationship graph']");
  await page.evaluate(() => window.scrollTo(0, 0));
  const before = await svg.locator("g[transform]").first().getAttribute("transform");
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .3);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => svg.locator("g[transform]").first().getAttribute("transform")).not.toBe(before);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("selection places distant relatives nearby and overview omits illegible labels", async ({ page }) => {
  await page.goto(URL);
  const people = Array.from({ length: 134 }, (_, i) => `0 @I${i}@ INDI\n1 NAME Person ${i} /Family/`).join("\n");
  await upload(page, `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n${people}\n0 @F1@ FAM\n1 HUSB @I0@\n1 CHIL @I133@\n0 TRLR`);
  await page.getByRole("button", { name: "Fit whole tree" }).click();
  expect(await page.locator("[data-person-node] text").count()).toBeLessThan(134);
  await page.getByLabel("Find someone").fill("Person 0");
  await page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Person 0 Family/ }).click();
  const geometry = await page.locator("[data-person-node]").evaluateAll((nodes) => {
    const a = nodes[0].getBoundingClientRect(), b = nodes[1].getBoundingClientRect();
    return { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), labels: [nodes[0].querySelector("text")?.textContent, nodes[1].querySelector("text")?.textContent] };
  });
  expect(geometry.dx).toBeLessThan(400);
  expect(geometry.dy).toBeLessThan(300);
  expect(geometry.labels).toEqual(["Person 0 Family", "Person 133 Family"]);
});

test("phone inspector stays on screen beside graph controls and resizes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(URL);
  await upload(page);
  await page.getByLabel("Find someone").fill("Ada");
  await page.getByRole("region", { name: "Search results" }).getByRole("button").click();
  for (const size of [{ width: 320, height: 700 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const boxes = await Promise.all([page.locator("svg[aria-label='Family relationship graph']"), page.getByRole("button", { name: "Fit whole tree" }), page.getByRole("button", { name: "Close details" })].map((item) => item.boundingBox()));
    for (const box of boxes) { expect(box).not.toBeNull(); expect(box!.y).toBeLessThan(size.height); expect(box!.y + box!.height).toBeGreaterThan(0); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole("region", { name: "Person details" }).getByRole("button", { name: /Kit North/ }).click();
  await expect(page.getByRole("region", { name: "Person details" })).toContainText("Kit North");
  await page.getByRole("button", { name: "Close details" }).click();
  await expect(page.getByRole("button", { name: "Close details" })).toHaveCount(0);
});


test("phone details leave a useful portion of the graph visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL);
  await upload(page);
  await page.getByLabel("Find someone").fill("Ada");
  await page.getByRole("region", { name: "Search results" }).getByRole("button").click();
  const scene = await page.locator("svg[aria-label='Family relationship graph']").boundingBox();
  const sheet = await page.getByRole("region", { name: "Person details" }).boundingBox();
  expect(scene).not.toBeNull();
  expect(sheet).not.toBeNull();
  expect(sheet!.y - Math.max(0, scene!.y)).toBeGreaterThanOrEqual(120);
});

test("closing person details restores a visible whole-tree graph", async ({ page }) => {
  await page.goto(URL);
  await upload(page);
  await page.getByLabel("Find someone").fill("Ada");
  await page.getByRole("region", { name: "Search results" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Close details" }).click();
  const allInside = await page.locator("svg[aria-label='Family relationship graph']").evaluate((svg) => {
    const scene = svg.getBoundingClientRect();
    return [...svg.querySelectorAll("[data-person-node]")].every((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= scene.left && rect.right <= scene.right && rect.top >= scene.top && rect.bottom <= scene.bottom;
    });
  });
  expect(allInside).toBe(true);
});

test("near-limit synthetic import remains responsive to search and overview", async ({ page }) => {
  await page.goto(URL);
  const records = Array.from({ length: 1950 }, (_, i) => `0 @I${i}@ INDI\n1 NAME Person ${i} /Synthetic/`).join("\n");
  const started = Date.now();
  await upload(page, `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n${records}\n0 TRLR`);
  await expect(page.getByRole("status")).toContainText("1950 people loaded");
  await page.getByLabel("Find someone").fill("Person 1949");
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("button")).toHaveCount(1);
  await page.getByLabel("Find someone").press("Escape");
  await page.getByRole("button", { name: "Fit whole tree" }).click();
  await expect(page.locator("[data-person-node]")).toHaveCount(1950);
  console.log(`near-limit 1950: ${Date.now() - started}ms`);
  expect(Date.now() - started).toBeLessThan(12000);
});


test("selected relatives have readable phone labels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(URL);
  await upload(page);
  const labels = page.locator("[data-person-node] text");
  await expect(labels).toHaveCount(3);
  for (const label of await labels.all()) expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(11);
});


test("wheel preserves the same graph point under cursor after resize", async ({ page }) => {
  await page.goto(URL);
  await upload(page);
  await page.setViewportSize({ width: 600, height: 800 });
  const svg = page.locator("svg[aria-label=\"Family relationship graph\"]");
  const box = (await svg.boundingBox())!;
  const x = box.x + box.width * .7, y = box.y + box.height * .45;
  const underCursor = () => svg.evaluate((element, point) => {
    const group = element.querySelector("g[transform]")!;
    const pos = new DOMPoint(point.x, point.y).matrixTransform((group as SVGGraphicsElement).getScreenCTM()!.inverse());
    return { x: pos.x, y: pos.y };
  }, { x, y });
  const before = await underCursor();
  const transformBefore = await svg.locator("g[transform]").first().getAttribute("transform");
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -180);
  await expect.poll(() => svg.locator("g[transform]").first().getAttribute("transform")).not.toBe(transformBefore);
  const after = await underCursor();
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
});
