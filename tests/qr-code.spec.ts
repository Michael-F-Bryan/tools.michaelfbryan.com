import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const JSQR_PATH = path.join(process.cwd(), "node_modules", "jsqr", "dist", "jsQR.js");

const URL_PATH = "/qr-code";

async function injectJsQr(page: Page) {
  await page.addScriptTag({ path: JSQR_PATH });
}

/** Decodes the QR code currently painted on an on-screen `<canvas>`, entirely in the page. */
async function decodeCanvas(page: Page, canvas: Locator): Promise<string | null> {
  await injectJsQr(page);
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const ctx = element.getContext("2d")!;
    const data = ctx.getImageData(0, 0, element.width, element.height);
    // `jsQR` is attached to `window` by the injected script tag.
    const decoded = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null })
      .jsQR(data.data, data.width, data.height);
    return decoded ? decoded.data : null;
  });
}

/** Decodes raw downloaded image bytes (PNG or SVG) by rasterising them in the page, then reading pixels back out. */
async function decodeImageBytes(
  page: Page,
  bytes: Buffer,
  mime: string,
): Promise<{ text: string | null; cornerColor: [number, number, number, number] }> {
  await injectJsQr(page);
  const base64 = bytes.toString("base64");
  return page.evaluate(
    async ({ base64, mime }) => {
      const img = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image failed to load"));
      });
      img.src = `data:${mime};base64,${base64}`;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = (
        window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null }
      ).jsQR(data.data, data.width, data.height);
      const corner: [number, number, number, number] = [data.data[0], data.data[1], data.data[2], data.data[3]];
      return { text: decoded ? decoded.data : null, cornerColor: corner };
    },
    { base64, mime },
  );
}

async function downloadAndDecode(page: Page, buttonName: string, mime: string) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: buttonName }).click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = readFileSync(path!);
  const decoded = await decodeImageBytes(page, bytes, mime);
  return { decoded, suggestedFilename: download.suggestedFilename() };
}

function rawData(page: Page) {
  return page.getByText("View raw data").locator("..").locator("pre");
}

async function openRawData(page: Page) {
  const summary = page.getByText("View raw data");
  if (!(await summary.locator("..").locator("pre").isVisible())) {
    await summary.click();
  }
}

/**
 * Reads the raw-data `<pre>` via `textContent` (not `innerText`), which
 * preserves `\r\n` exactly as rendered instead of normalising it to `\n`,
 * and polls because the payload fills in asynchronously after rendering.
 */
async function rawDataText(page: Page): Promise<string> {
  await openRawData(page);
  const locator = rawData(page);
  await expect.poll(() => locator.textContent()).not.toBe("");
  return (await locator.textContent()) ?? "";
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL_PATH);
});

test("the catalogue entry opens, focuses the link input, and starts with no example code", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /QR code generator/ }).click();
  await expect(page).toHaveURL(new RegExp(`${URL_PATH}$`));
  await expect(page.getByRole("heading", { name: "QR code generator", exact: true })).toBeVisible();
  await expect(page.getByLabel("Web address")).toBeFocused();

  await expect(page.getByText("Fill in the form to see a preview.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download SVG" })).toBeDisabled();
  await openRawData(page);
  await expect(rawData(page)).toHaveText("");

  await expect(page.getByText("happens in this browser tab")).toBeVisible();
});

test("typing a valid link produces an instant preview without a generate button", async ({ page }) => {
  await page.getByLabel("Web address").fill("https://example.com/path");
  await expect(page.getByText("Opens a website at example.com/path")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();
  expect(await rawDataText(page)).toBe("https://example.com/path");

  const canvas = page.locator("#qr-preview canvas").first();
  await expect.poll(() => decodeCanvas(page, canvas)).toBe("https://example.com/path");
});

test("validation only appears after the field is blurred, and disables export while invalid", async ({ page }) => {
  const field = page.getByLabel("Web address");
  await field.fill("https://good.example");
  await expect.poll(() => decodeCanvas(page, page.locator("#qr-preview canvas").first())).toBe("https://good.example");
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();

  await field.fill("not a url");
  await expect(page.getByText(/Enter a full address/)).toHaveCount(0);
  await field.blur();
  await expect(page.getByText(/Enter a full address/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeDisabled();
  await expect(page.getByText("Preview is out of date")).toBeVisible();
});

test("switching type moves focus to the new type's first field", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("wifi");
  await expect(page.getByLabel("Network name (SSID)")).toBeFocused();
  await page.getByLabel("QR code type").selectOption("contact");
  await expect(page.getByLabel("First name")).toBeFocused();
});

test("wifi payload escapes special characters and explains readability", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("wifi");
  await page.getByLabel("Network name (SSID)").fill('Guest;Net,"1"');
  await page.getByLabel("Password").fill("a\\b");
  await page.getByLabel("Network is hidden").check();
  await expect(page.getByText(/not encrypted/)).toBeVisible();
  expect(await rawDataText(page)).toBe('WIFI:T:WPA;S:Guest\\;Net\\,\\"1\\";P:a\\\\b;H:true;;');
  await expect(page.getByText('Offers to join Guest;Net,"1"')).toBeVisible();

  const canvas = page.locator("#qr-preview canvas").first();
  await expect.poll(() => decodeCanvas(page, canvas)).toBe('WIFI:T:WPA;S:Guest\\;Net\\,\\"1\\";P:a\\\\b;H:true;;');
});

test("contact payload builds an escaped vCard 3.0", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("contact");
  await page.getByLabel("First name").fill("Ada;");
  await page.getByLabel("Last name").fill("North,");
  await page.getByLabel("Organisation (optional)").fill("Acme Co");
  const text = await rawDataText(page);
  expect(text).toContain("BEGIN:VCARD\r\nVERSION:3.0");
  expect(text).toContain("N:North\\,;Ada\\;;;;");
  expect(text).toContain("ORG:Acme Co");
  expect(text).toContain("END:VCARD");
  await expect(page.getByText(/^Adds a contact: Ada; North,/)).toBeVisible();
});

test("email payload percent-encodes subject and body", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("email");
  await page.getByLabel("Email address").fill("a@example.com");
  await page.getByLabel("Subject (optional)").fill("Say hi");
  await page.getByLabel("Body (optional)").fill("hello world");
  expect(await rawDataText(page)).toBe("mailto:a@example.com?subject=Say%20hi&body=hello%20world");
});

test("phone payload wraps the number verbatim in tel:", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("phone");
  await page.getByLabel("Phone number").fill("+61 3 5550 100");
  expect(await rawDataText(page)).toBe("tel:+61 3 5550 100");
  await expect(page.getByText("Calls +61 3 5550 100")).toBeVisible();
});

test("phone field rejects letters without silently repairing the input", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("phone");
  const field = page.getByLabel("Phone number");
  await field.fill("call me maybe");
  await field.blur();
  await expect(page.getByText(/digits, spaces/)).toBeVisible();
  await expect(field).toHaveValue("call me maybe");
});

test("sms payload uses SMSTO: and notes compatibility caveats", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("sms");
  await page.getByLabel("Phone number").fill("+1 555 0100");
  await page.getByLabel("Message (optional)").fill("On my way");
  await expect(page.locator("#qr-sms-message-hint")).toBeVisible();
  expect(await rawDataText(page)).toBe("SMSTO:+1 555 0100:On my way");
});

test("location payload validates latitude and longitude ranges", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("location");
  await page.getByLabel("Latitude").fill("91");
  await page.getByLabel("Latitude").blur();
  await expect(page.getByText(/Latitude must be between/)).toBeVisible();

  await page.getByLabel("Latitude").fill("-37.8136");
  await page.getByLabel("Longitude").fill("144.9631");
  expect(await rawDataText(page)).toBe("geo:-37.8136,144.9631");
});

test("calendar payload orders dates and builds a floating-time VEVENT", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("calendar");
  await page.getByLabel("Title").fill("Standup");
  await page.getByLabel("Starts").fill("2026-03-05T10:00");
  await page.getByLabel("Ends").fill("2026-03-05T09:00");
  await page.getByLabel("Ends").focus();
  await page.getByLabel("Ends").blur();
  await expect(page.getByText("End must be after the start.")).toBeVisible();

  await page.getByLabel("Ends").fill("2026-03-05T10:30");
  const text = await rawDataText(page);
  expect(text).toContain("DTSTART:20260305T100000");
  expect(text).toContain("DTEND:20260305T103000");
  expect(text).toContain("SUMMARY:Standup");
});

test("an all-day calendar event stores an exclusive end date the day after", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("calendar");
  await page.getByLabel("Title").fill("Conference");
  await page.getByLabel("All-day event").check();
  await page.getByLabel("Starts").fill("2026-03-05");
  await page.getByLabel("Ends").fill("2026-03-05");
  const text = await rawDataText(page);
  expect(text).toContain("DTSTART;VALUE=DATE:20260305");
  expect(text).toContain("DTEND;VALUE=DATE:20260306");
});

test("raw text preserves unicode and is disclosed as raw data", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("text");
  await page.getByLabel("Text").fill("héllo 世界 🎉");
  expect(await rawDataText(page)).toBe("héllo 世界 🎉");
  const canvas = page.locator("#qr-preview canvas").first();
  await expect.poll(() => decodeCanvas(page, canvas)).toBe("héllo 世界 🎉");
});

test("pasting a vCard into raw text offers an explicit switch to Contact, never silent", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("text");
  const field = page.getByLabel("Text");
  await field.click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text", "BEGIN:VCARD\r\nVERSION:3.0\r\nN:North;Ada;;;\r\nFN:Ada North\r\nTEL:+1 555 0100\r\nEND:VCARD");
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
  });
  await expect(page.getByText(/This looks like a contact card \(vCard\)/)).toBeVisible();
  await expect(page.getByLabel("QR code type")).toHaveValue("text");

  await page.getByRole("button", { name: "Switch to Contact" }).click();
  await expect(page.getByLabel("QR code type")).toHaveValue("contact");
  await expect(page.getByLabel("First name")).toHaveValue("Ada");
  await expect(page.getByLabel("Last name")).toHaveValue("North");
});

for (const sample of [
  { type: "url", fields: { "Web address": "https://example.com/caf%C3%A9" } },
  { type: "wifi", fields: { "Network name (SSID)": " Guest;Network ", "Password": "a\\b;秘密" } },
  { type: "contact", fields: { "First name": "Zoë", "Last name": "North", "Job title (optional)": "Engineer", "Address (optional)": "12 Example Street\nPerth" } },
  { type: "email", fields: { "Email address": "a@example.com", "Body (optional)": "héllo & goodbye" } },
  { type: "phone", fields: { "Phone number": "+61412345678" } },
  { type: "sms", fields: { "Phone number": "+61412345678", "Message (optional)": "Hello: 世界" } },
  { type: "location", fields: { "Latitude": "-31.95", "Longitude": "115.86" } },
  { type: "calendar", fields: { "Title": "Workshop", "Starts": "2026-10-04T09:00", "Ends": "2026-10-04T10:00" } },
  { type: "text", fields: { "Text": "héllo 世界 🎉" } },
]) {
  test(`downloaded ${sample.type} code decodes to its complete current payload`, async ({ page }) => {
    await page.getByLabel("QR code type").selectOption(sample.type);
    for (const [label, value] of Object.entries(sample.fields)) {
      await page.getByLabel(label, { exact: true }).fill(value!);
    }
    await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();
    const payload = await rawDataText(page);
    const png = await downloadAndDecode(page, "Download PNG", "image/png");
    expect(png.decoded.text).toBe(payload);
    expect(png.decoded.cornerColor).toEqual([255, 255, 255, 255]);
  });
}

test("exported PNG and SVG decode to the exact payload with a white background and quiet zone", async ({ page }) => {
  await page.getByLabel("Web address").fill("https://example.com");
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();

  const png = await downloadAndDecode(page, "Download PNG", "image/png");
  expect(png.decoded.text).toBe("https://example.com");
  expect(png.decoded.cornerColor).toEqual([255, 255, 255, 255]);
  expect(png.suggestedFilename).toBe("qr-url-example-com.png");

  const svg = await downloadAndDecode(page, "Download SVG", "image/svg+xml");
  expect(svg.decoded.text).toBe("https://example.com");
  expect(svg.suggestedFilename).toBe("qr-url-example-com.svg");
});

test("copy image gives a real success message when the browser allows it", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard image permissions are only grantable on Chromium.");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByLabel("Web address").fill("https://example.com");
  await expect(page.getByRole("button", { name: "Copy image" })).toBeEnabled();
  await page.getByRole("button", { name: "Copy image" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied the QR code image." })).toBeVisible();

  const read = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items[0];
    return item ? item.types : [];
  });
  expect(read).toContain("image/png");
});

test("copy image reports a real failure when the clipboard write rejects", async ({ page }) => {
  // Simulates a browser whose clipboard implementation refuses image writes
  // (e.g. a strict permissions policy) — the app's own encode/decode path is
  // untouched; only the external browser API's outcome is forced to fail,
  // so the UI's failure branch is exercised for real.
  await page.addInitScript(() => {
    Object.defineProperty(window, "ClipboardItem", { value: class {}, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { write: () => Promise.reject(new DOMException("Denied", "NotAllowedError")) },
      configurable: true,
    });
  });
  await page.goto(URL_PATH);
  await page.getByLabel("Web address").fill("https://example.com");
  await expect(page.getByRole("button", { name: "Copy image" })).toBeEnabled();
  await page.getByRole("button", { name: "Copy image" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Couldn't copy the image" })).toBeVisible();
});

test("the share button is absent unless the browser supports the Web Share API", async ({ page }) => {
  await page.getByLabel("Web address").fill("https://example.com");
  const supportsShare = await page.evaluate(() => typeof navigator.share === "function");
  expect(await page.getByRole("button", { name: "Share" }).count()).toBe(supportsShare ? 1 : 0);
});

test("the share button appears and is invoked when Web Share is stubbed as supported", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __shareCalls: unknown[] }).__shareCalls = [];
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (data: unknown) => {
        (window as unknown as { __shareCalls: unknown[] }).__shareCalls.push(data);
      },
      configurable: true,
    });
  });
  await page.goto(URL_PATH);
  await page.getByLabel("Web address").fill("https://example.com");
  await expect(page.getByRole("button", { name: "Share" })).toBeEnabled();
  await page.getByRole("button", { name: "Share" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shareCalls: unknown[] }).__shareCalls.length)).toBe(1);
  const fileInfo = await page.evaluate(() => {
    const call = (window as unknown as { __shareCalls: { files: File[] }[] }).__shareCalls[0];
    const file = call.files[0];
    return { type: file.type, name: file.name };
  });
  expect(fileInfo.type).toBe("image/png");
  expect(fileInfo.name).toBe("qr-url-example-com.png");
});

test("fullscreen view opens as a native dialog, closes on Escape, and returns focus", async ({ page }) => {
  await page.getByLabel("Web address").fill("https://example.com");
  const trigger = page.getByRole("button", { name: "View full screen" });
  await trigger.click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  const fullscreenCanvas = dialog.locator("canvas");
  await expect.poll(() => decodeCanvas(page, fullscreenCanvas)).toBe("https://example.com");

  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("fullscreen view also closes via its own close button", async ({ page }) => {
  await page.getByLabel("Web address").fill("https://example.com");
  await page.getByRole("button", { name: "View full screen" }).click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("contrast gating disables export for near-identical colours and re-enables once fixed", async ({ page }) => {
  await page.getByLabel("Web address").fill("https://example.com");
  await page.getByText("Appearance", { exact: true }).click();
  await page.getByLabel("Foreground colour").fill("#cccccc");
  await page.getByLabel("Background colour").fill("#dddddd");
  await expect(page.getByText(/too close in contrast/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeDisabled();

  await page.getByLabel("Foreground colour").fill("#000000");
  await page.getByLabel("Background colour").fill("#ffffff");
  await expect(page.getByText(/too close in contrast/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();
});

test("error correction choice is explained and changes the encoded symbol without changing the payload", async ({ page }) => {
  await page.getByLabel("Web address").fill("https://example.com");
  await page.getByText("Appearance", { exact: true }).click();
  await page.getByText("Advanced: error correction").click();
  await expect(page.getByText(/Low — about 7%/)).toBeVisible();
  await expect(page.getByText(/High — about 30%/)).toBeVisible();

  const canvas = page.locator("#qr-preview canvas").first();
  await expect.poll(() => decodeCanvas(page, canvas)).toBe("https://example.com");
  await page.getByRole("radio", { name: /High — about 30%/ }).check();
  await expect.poll(() => decodeCanvas(page, canvas)).toBe("https://example.com");
});

test("too-long content is rejected with a clear message instead of crashing", async ({ page }) => {
  await page.getByLabel("QR code type").selectOption("text");
  await page.getByLabel("Text").fill("x".repeat(6000));
  await expect(page.getByText(/too long to fit/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeDisabled();
});

test("race safety: the preview reflects the latest input, not a stale one", async ({ page }) => {
  const field = page.getByLabel("Web address");
  const canvas = page.locator("#qr-preview canvas").first();
  await field.fill("https://a.example");
  await field.fill("https://bb.example");
  await field.fill("https://ccc.example");
  await expect.poll(() => decodeCanvas(page, canvas)).toBe("https://ccc.example");
});

test("desktop layout uses two stable columns; mobile stacks the form above the preview without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_PATH);
  const columns = await page.evaluate(() => {
    const picker = document.querySelector("#qr-preview")!;
    const grid = picker.parentElement!;
    return getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
  });
  expect(columns).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("Web address").fill("https://tools.michaelfbryan.com");
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("qr-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(URL_PATH);
  const narrowColumns = await page.evaluate(() => {
    const picker = document.querySelector("#qr-preview")!;
    const grid = picker.parentElement!;
    return getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
  });
  expect(narrowColumns).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const typeSelect = page.getByLabel("QR code type");
  const preview = page.locator("#qr-preview");
  const selectBox = (await typeSelect.boundingBox())!;
  const previewBox = (await preview.boundingBox())!;
  expect(selectBox.y).toBeLessThan(previewBox.y);

  await page.getByRole("link", { name: /View code/ }).click();
  await expect(preview).toBeInViewport();
  await page.getByLabel("Web address").fill("https://tools.michaelfbryan.com");
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeEnabled();
  const codeBox = (await preview.locator("canvas").first().boundingBox())!;
  expect(codeBox.width).toBeCloseTo(codeBox.height, 0);
  await page.screenshot({ path: testInfo.outputPath("qr-mobile.png"), fullPage: true, animations: "disabled" });
});

test("switching content type refreshes the explanation even for identical encoded bytes", async ({ page }) => {
  await page.getByLabel("Web address").fill("https://example.com");
  await expect(page.getByText("Opens a website at example.com", { exact: true })).toBeVisible();
  await page.getByLabel("QR code type").selectOption("text");
  await page.getByLabel("Text", { exact: true }).fill("https://example.com");
  await expect(page.getByText('Shows text: "https://example.com"', { exact: true })).toBeVisible();
  await page.getByLabel("QR code type").selectOption("url");
  await expect(page.getByText("Opens a website at example.com", { exact: true })).toBeVisible();
});

test("invalidating a payload hides its old encoded data", async ({ page }) => {
  const field = page.getByLabel("Web address");
  await field.fill("https://example.com");
  expect(await rawDataText(page)).toBe("https://example.com");
  await field.fill("invalid");
  await expect(rawData(page)).toHaveText("");
  await expect(page.getByRole("button", { name: "Download PNG" })).toBeDisabled();
});

test("nothing typed into the form is sent over the network, to analytics, or to storage", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url() + " " + (request.postData() ?? "")));
  await page.goto(URL_PATH);
  await page.getByLabel("QR code type").selectOption("wifi");
  await page.getByLabel("Network name (SSID)").fill("TopSecretNetwork");
  await page.getByLabel("Password").fill("super-secret-password");


  const combined = requests.join(" ");
  expect(combined).not.toContain("TopSecretNetwork");
  expect(combined).not.toContain("super-secret-password");
  expect(page.url()).not.toContain("TopSecretNetwork");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
