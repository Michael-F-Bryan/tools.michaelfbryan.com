import { expect, test } from "@playwright/test";

import { contrastRatio, hasSafeContrast } from "../src/entries/qr-code/contrast";
import { escapeICal, escapeVCard, escapeWifi, foldICalLine } from "../src/entries/qr-code/encoding";
import { detectPastedStructuredContent, evaluate, slugify, validatePhone } from "../src/entries/qr-code/payload";
import { defaultValues, type QrValues } from "../src/entries/qr-code/types";

function values(overrides: Partial<QrValues> = {}): QrValues {
  return { ...defaultValues(), ...overrides };
}

test.describe("escaping", () => {
  test("escapeWifi escapes backslash, semicolon, comma, colon and quote", () => {
    expect(escapeWifi('a\\b;c,d:e"f')).toBe('a\\\\b\\;c\\,d\\:e\\"f');
  });

  test("escapeVCard escapes backslash, newline, comma and semicolon", () => {
    expect(escapeVCard("a\\b\nc,d;e")).toBe("a\\\\b\\nc\\,d\\;e");
  });

  test("escapeICal matches vCard's escaping rules", () => {
    expect(escapeICal("a\\b\nc,d;e")).toBe("a\\\\b\\nc\\,d\\;e");
  });

  test("foldICalLine leaves short lines untouched", () => {
    const short = "SUMMARY:short";
    expect(foldICalLine(short)).toBe(short);
  });

  test("foldICalLine wraps long lines at 75 octets with a leading space continuation", () => {
    const long = "SUMMARY:" + "x".repeat(100);
    const folded = foldICalLine(long);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) expect(line.startsWith(" ")).toBe(true);
    expect(lines.map((l) => (l.startsWith(" ") ? l.slice(1) : l)).join("")).toBe(long);
  });

  test("foldICalLine never splits a surrogate pair across the fold", () => {
    const emoji = "\u{1F600}"; // 4-byte UTF-8 astral character
    const long = "DESCRIPTION:" + emoji.repeat(30);
    const folded = foldICalLine(long);
    expect(folded).not.toMatch(/\ud83d(?![\ude00-\ude4f])/);
    const rejoined = folded
      .split("\r\n")
      .map((l) => (l.startsWith(" ") ? l.slice(1) : l))
      .join("");
    expect(rejoined).toBe(long);
  });
});

test.describe("link", () => {
  test("requires a non-empty address", () => {
    const outcome = evaluate("url", values());
    expect(outcome.build).toBeNull();
    expect(outcome.errors.url).toBeTruthy();
  });

  test("rejects addresses without a scheme", () => {
    const outcome = evaluate("url", values({ url: { url: "example.com" } }));
    expect(outcome.build).toBeNull();
    expect(outcome.errors.url).toBeTruthy();
  });

  test("rejects non-http(s) schemes", () => {
    const outcome = evaluate("url", values({ url: { url: "javascript:alert(1)" } }));
    expect(outcome.build).toBeNull();
    expect(outcome.errors.url).toBeTruthy();
  });

  test("accepts a full https address and describes it", () => {
    const outcome = evaluate("url", values({ url: { url: " https://example.com/path " } }));
    expect(outcome.build?.payload).toBe("https://example.com/path");
    expect(outcome.build?.sentence).toContain("example.com/path");
    expect(outcome.build?.filenameHint).toBe("example-com");
  });
});

test.describe("wifi", () => {
  test("requires a password unless the network is open", () => {
    const outcome = evaluate("wifi", values({ wifi: { ssid: "Cafe", password: "", encryption: "WPA", hidden: false } }));
    expect(outcome.build).toBeNull();
    expect(outcome.errors.password).toBeTruthy();
  });

  test("open networks don't require a password", () => {
    const outcome = evaluate(
      "wifi",
      values({ wifi: { ssid: "Cafe", password: "", encryption: "nopass", hidden: false } }),
    );
    expect(outcome.build?.payload).toBe("WIFI:T:nopass;S:Cafe;;");
  });

  test("escapes special characters in SSID and password, and marks hidden networks", () => {
    const outcome = evaluate(
      "wifi",
      values({ wifi: { ssid: 'Guest;Net,"1"', password: "a\\b", encryption: "WPA", hidden: true } }),
    );
    expect(outcome.build?.payload).toBe('WIFI:T:WPA;S:Guest\\;Net\\,\\"1\\";P:a\\\\b;H:true;;');
    expect(outcome.build?.sentence).toBe('Offers to join Guest;Net,"1"');
  });
});

test.describe("contact", () => {
  test("requires at least a first or last name", () => {
    const outcome = evaluate("contact", values());
    expect(outcome.build).toBeNull();
    expect(outcome.errors.firstName).toBeTruthy();
  });

  test("builds a vCard 3.0 with only the fields provided, escaped", () => {
    const outcome = evaluate(
      "contact",
      values({
        contact: { firstName: "Ada;", lastName: "North,", org: "", phone: "", email: "", url: "" },
      }),
    );
    const payload = outcome.build?.payload ?? "";
    expect(payload).toContain("BEGIN:VCARD\r\nVERSION:3.0");
    expect(payload).toContain("N:North\\,;Ada\\;;;;");
    expect(payload).toContain("FN:Ada\\; North\\,");
    expect(payload).not.toContain("ORG:");
    expect(payload).toContain("END:VCARD");
  });

  test("rejects an invalid email without blocking on the name", () => {
    const outcome = evaluate(
      "contact",
      values({ contact: { firstName: "Ada", lastName: "", org: "", phone: "", email: "not-an-email", url: "" } }),
    );
    expect(outcome.build).toBeNull();
    expect(outcome.errors.email).toBeTruthy();
  });
});

test.describe("email", () => {
  test("requires a valid address", () => {
    expect(evaluate("email", values({ email: { to: "nope", subject: "", body: "" } })).build).toBeNull();
  });

  test("percent-encodes subject and body, including spaces and unicode", () => {
    const outcome = evaluate(
      "email",
      values({ email: { to: "a@example.com", subject: "Say hi", body: "héllo world & more" } }),
    );
    expect(outcome.build?.payload).toBe(
      "mailto:a@example.com?subject=Say%20hi&body=h%C3%A9llo%20world%20%26%20more",
    );
  });

  test("omits the query string entirely when subject and body are empty", () => {
    const outcome = evaluate("email", values({ email: { to: "a@example.com", subject: "", body: "" } }));
    expect(outcome.build?.payload).toBe("mailto:a@example.com");
  });
});

test.describe("phone numbers", () => {
  test("rejects letters", () => {
    expect(validatePhone("call me").error).toBeTruthy();
  });

  test("rejects a + anywhere but the start", () => {
    expect(validatePhone("555-+100").error).toBeTruthy();
  });

  test("rejects too few digits", () => {
    expect(validatePhone("+1").error).toBeTruthy();
  });

  test("accepts international formatting without altering it", () => {
    const result = validatePhone(" +61 (3) 555-0100 ");
    expect(result.error).toBeUndefined();
    expect(result.trimmed).toBe("+61 (3) 555-0100");
  });

  test("phone type builds a tel: URI from the untouched input", () => {
    const outcome = evaluate("phone", values({ phone: { phone: "+61 3 5550 100" } }));
    expect(outcome.build?.payload).toBe("tel:+61 3 5550 100");
  });

  test("sms type uses SMSTO: with the message appended", () => {
    const outcome = evaluate("sms", values({ sms: { phone: "+1 555 0100", message: "On my way" } }));
    expect(outcome.build?.payload).toBe("SMSTO:+1 555 0100:On my way");
    expect(outcome.build?.sentence).toContain("On my way");
  });
});

test.describe("location", () => {
  test("rejects out-of-range latitude and longitude", () => {
    const outcome = evaluate("location", values({ location: { latitude: "91", longitude: "0" } }));
    expect(outcome.errors.latitude).toBeTruthy();
  });

  test("rejects non-numeric input without coercing it", () => {
    const outcome = evaluate("location", values({ location: { latitude: "south-ish", longitude: "0" } }));
    expect(outcome.errors.latitude).toBeTruthy();
  });

  test("builds a geo: URI from valid coordinates", () => {
    const outcome = evaluate("location", values({ location: { latitude: "-37.8136", longitude: "144.9631" } }));
    expect(outcome.build?.payload).toBe("geo:-37.8136,144.9631");
  });
});

test.describe("calendar", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const uid = "fixed-uid@test";

  test("rejects an end before the start", () => {
    const outcome = evaluate(
      "calendar",
      values({
        calendar: {
          title: "Standup",
          location: "",
          description: "",
          start: "2026-03-05T10:00",
          end: "2026-03-05T09:00",
          allDay: false,
        },
      }),
      { now, uid },
    );
    expect(outcome.build).toBeNull();
    expect(outcome.errors.end).toBeTruthy();
  });

  test("builds a floating-time VEVENT for a timed event", () => {
    const outcome = evaluate(
      "calendar",
      values({
        calendar: {
          title: "Standup",
          location: "Room 1",
          description: "Daily sync",
          start: "2026-03-05T10:00",
          end: "2026-03-05T10:30",
          allDay: false,
        },
      }),
      { now, uid },
    );
    const payload = outcome.build?.payload ?? "";
    expect(payload).toContain("DTSTART:20260305T100000");
    expect(payload).toContain("DTEND:20260305T103000");
    expect(payload).toContain("DTSTAMP:20260101T000000Z");
    expect(payload).toContain(`UID:${uid}`);
    expect(payload).toContain("SUMMARY:Standup");
    expect(payload).toContain("LOCATION:Room 1");
  });

  test("an all-day event allows a same-day end and stores an exclusive DTEND the day after", () => {
    const outcome = evaluate(
      "calendar",
      values({
        calendar: { title: "Conference", location: "", description: "", start: "2026-03-05", end: "2026-03-05", allDay: true },
      }),
      { now, uid },
    );
    const payload = outcome.build?.payload ?? "";
    expect(payload).toContain("DTSTART;VALUE=DATE:20260305");
    expect(payload).toContain("DTEND;VALUE=DATE:20260306");
  });

  test("an all-day event rejects an end before the start date", () => {
    const outcome = evaluate(
      "calendar",
      values({
        calendar: { title: "Conference", location: "", description: "", start: "2026-03-05", end: "2026-03-04", allDay: true },
      }),
      { now, uid },
    );
    expect(outcome.build).toBeNull();
  });

  test("folds a long description across multiple lines", () => {
    const outcome = evaluate(
      "calendar",
      values({
        calendar: {
          title: "Workshop",
          location: "",
          description: "x".repeat(200),
          start: "2026-03-05T09:00",
          end: "2026-03-05T17:00",
          allDay: false,
        },
      }),
      { now, uid },
    );
    const payload = outcome.build?.payload ?? "";
    expect(payload).toContain("DESCRIPTION:" + "x".repeat(63) + "\r\n ");
  });
});

test.describe("raw text", () => {
  test("requires non-empty text", () => {
    expect(evaluate("text", values()).build).toBeNull();
  });

  test("preserves unicode verbatim as the payload", () => {
    const outcome = evaluate("text", values({ text: { text: "héllo 世界 🎉" } }));
    expect(outcome.build?.payload).toBe("héllo 世界 🎉");
  });
});

test.describe("pasted content detection", () => {
  test("recognises a pasted vCard and extracts its fields", () => {
    const pasted = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:North;Ada;;;\r\nFN:Ada North\r\nTEL:+1 555 0100\r\nEND:VCARD";
    const suggestion = detectPastedStructuredContent(pasted);
    expect(suggestion?.type).toBe("vcard");
    if (suggestion?.type === "vcard") {
      expect(suggestion.parsed.firstName).toBe("Ada");
      expect(suggestion.parsed.lastName).toBe("North");
      expect(suggestion.parsed.phone).toBe("+1 555 0100");
    }
  });

  test("recognises a pasted bare URL", () => {
    expect(detectPastedStructuredContent("https://example.com")).toEqual({ type: "url", url: "https://example.com" });
  });

  test("ignores ordinary text", () => {
    expect(detectPastedStructuredContent("just some notes")).toBeNull();
  });
});

test.describe("contrast", () => {
  test("black on white is maximum contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(hasSafeContrast("#000000", "#ffffff")).toBe(true);
  });

  test("near-identical colours fail the safety gate", () => {
    expect(hasSafeContrast("#cccccc", "#dddddd")).toBe(false);
  });

  test("invalid colour strings are treated as unsafe", () => {
    expect(hasSafeContrast("red", "#ffffff")).toBe(false);
  });
});

test("network names retain significant leading and trailing spaces", () => {
  const input = values({ wifi: { ssid: " Guest ", password: " password ", encryption: "WPA", hidden: false } });
  expect(evaluate("wifi", input).build?.payload).toBe("WIFI:T:WPA;S: Guest ;P: password ;;");
});

test("phone numbers reject repeated plus signs", () => {
  expect(validatePhone("++61412345678").error).toBeTruthy();
});

test("email recipient delimiters cannot change the mailto query", () => {
  const input = values({ email: { to: "a?tag@example.com", subject: "Hello", body: "" } });
  expect(evaluate("email", input).build?.payload).toBe("mailto:a%3Ftag@example.com?subject=Hello");
});

test("contact cards include optional job title and postal address", () => {
  const input = values({ contact: { ...defaultValues().contact, firstName: "Ada", jobTitle: "Engineer", address: "12 Example Street\nPerth" } });
  const payload = evaluate("contact", input).build?.payload;
  expect(payload).toContain("TITLE:Engineer");
  expect(payload).toContain("ADR:;;12 Example Street\\nPerth;;;;");
});

test("contact website URI retains its delimiters without text escaping", () => {
  const input = values({ contact: { ...defaultValues().contact, firstName: "Ada", url: "https://example.com/a;b?q=1,2" } });
  expect(evaluate("contact", input).build?.payload).toContain("URL:https://example.com/a;b?q=1,2");
});

test("calendar rejects nonexistent dates rather than rolling into the next month", () => {
  const input = values({ calendar: { ...defaultValues().calendar, title: "Meeting", start: "2026-02-30T09:00", end: "2026-03-03T10:00" } });
  expect(evaluate("calendar", input).build).toBeNull();
});

test("text-property escaping normalises carriage returns without injecting properties", () => {
  expect(escapeVCard("Ada\r\nTITLE:Injected\rSmith")).toBe("Ada\\nTITLE:Injected\\nSmith");
  expect(escapeICal("Ada\r\nLOCATION:Injected\rSmith")).toBe("Ada\\nLOCATION:Injected\\nSmith");
});

test("inverted QR colours are not offered as safe", () => {
  expect(hasSafeContrast("#ffffff", "#000000")).toBe(false);
});

test.describe("slugify", () => {
  test("strips diacritics and punctuation", () => {
    expect(slugify("Café René!", "fallback")).toBe("cafe-rene");
  });

  test("falls back when nothing alphanumeric remains", () => {
    expect(slugify("日本語", "fallback")).toBe("fallback");
  });
});
