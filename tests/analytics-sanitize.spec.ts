import { expect, test } from "@playwright/test";

import { sanitizePathname, sanitizeReferrer } from "../src/components/analytics-sanitize";

test("sanitizePathname strips any query string or fragment that slips through", () => {
  expect(sanitizePathname("/timezone-clock")).toBe("/timezone-clock");
  expect(sanitizePathname("/timezone-clock?tz=%7B%22p%22%3A%5B%22Ada%22%5D%7D")).toBe("/timezone-clock");
  expect(sanitizePathname("/timezone-clock#section")).toBe("/timezone-clock");
  expect(sanitizePathname("")).toBe("/");
});

test("sanitizeReferrer keeps only origin + path, dropping query and hash", () => {
  expect(sanitizeReferrer("https://tools.michaelfbryan.com/timezone-clock?tz=secret-names-and-spans")).toBe(
    "https://tools.michaelfbryan.com/timezone-clock",
  );
  expect(sanitizeReferrer("https://tools.michaelfbryan.com/timezone-clock#frag")).toBe(
    "https://tools.michaelfbryan.com/timezone-clock",
  );
  expect(sanitizeReferrer("")).toBe("");
  expect(sanitizeReferrer("not a url")).toBe("");
});
