import { escapeICal, escapeVCard, escapeWifi, foldICalLine } from "./encoding";
import type {
  CalendarValue,
  ContactValue,
  EmailValue,
  LocationValue,
  PhoneValue,
  QrType,
  QrValues,
  SmsValue,
  TextValue,
  UrlValue,
  WifiValue,
} from "./types";

export type ValidationErrors = Record<string, string>;
export type BuildResult = { payload: string; sentence: string; filenameHint: string };
export type BuildOutcome = { errors: ValidationErrors; build: BuildResult | null };

/** A short, filesystem-safe fragment for export filenames, e.g. `example-com` or `ada-north`. */
export function slugify(text: string, fallback: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_ALLOWED_RE = /^[0-9+\-() .]+$/;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Validates a phone number without reformatting it: we only check that the
 * characters and digit count look like a phone number, then pass the
 * original text straight into the `tel:`/`SMSTO:` payload. Silently
 * "fixing" an international number is more likely to produce a wrong number
 * than a merely unconventionally formatted one.
 */
export function validatePhone(raw: string): { error?: string; trimmed: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Enter a phone number.", trimmed };
  if (!PHONE_ALLOWED_RE.test(trimmed)) {
    return { error: "Use digits, spaces, and + - ( ) . only.", trimmed };
  }
  if (trimmed.includes("+") && (trimmed.indexOf("+") !== 0 || trimmed.lastIndexOf("+") !== 0)) {
    return { error: "A “+” can only appear at the start.", trimmed };
  }
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length < 3) {
    return { error: "Enter a few more digits.", trimmed };
  }
  return { trimmed };
}

function evaluateUrl(v: UrlValue): BuildOutcome {
  const trimmed = v.url.trim();
  if (!trimmed) return { errors: { url: "Enter a web address." }, build: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { errors: { url: "Enter a full address, including https://" }, build: null };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { errors: { url: "Use an http:// or https:// address." }, build: null };
  }
  const place = parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
  return {
    errors: {},
    build: { payload: trimmed, sentence: `Opens a website at ${place}`, filenameHint: slugify(parsed.hostname, "link") },
  };
}

function evaluateWifi(v: WifiValue): BuildOutcome {
  const errors: ValidationErrors = {};
  const ssid = v.ssid;
  if (!ssid) errors.ssid = "Enter the network name.";
  const needsPassword = v.encryption !== "nopass";
  if (needsPassword && !v.password) {
    errors.password = "Enter the network password, or set security to None.";
  }
  if (Object.keys(errors).length) return { errors, build: null };

  const parts = [`WIFI:T:${v.encryption}`, `S:${escapeWifi(ssid)}`];
  if (needsPassword) parts.push(`P:${escapeWifi(v.password)}`);
  if (v.hidden) parts.push("H:true");
  const payload = parts.join(";") + ";;";
  return { errors, build: { payload, sentence: `Offers to join ${ssid}`, filenameHint: slugify(ssid, "wifi") } };
}

function evaluateContact(v: ContactValue): BuildOutcome {
  const errors: ValidationErrors = {};
  const first = v.firstName.trim();
  const last = v.lastName.trim();
  if (!first && !last) errors.firstName = "Add a first or last name.";
  if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) errors.email = "Enter a valid email address.";
  if (v.phone.trim()) {
    const check = validatePhone(v.phone);
    if (check.error) errors.phone = check.error;
  }
  if (v.url.trim()) {
    try {
      new URL(v.url.trim());
    } catch {
      errors.url = "Enter a full address, including https://";
    }
  }
  if (Object.keys(errors).length) return { errors, build: null };

  const fullName = [first, last].filter(Boolean).join(" ");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCard(last)};${escapeVCard(first)};;;`,
    `FN:${escapeVCard(fullName)}`,
  ];
  if (v.org.trim()) lines.push(`ORG:${escapeVCard(v.org.trim())}`);
  if (v.jobTitle?.trim()) lines.push(`TITLE:${escapeVCard(v.jobTitle.trim())}`);
  if (v.address?.trim()) lines.push(`ADR:;;${escapeVCard(v.address.trim())};;;;`);
  if (v.phone.trim()) lines.push(`TEL:${v.phone.trim()}`);
  if (v.email.trim()) lines.push(`EMAIL:${escapeVCard(v.email.trim())}`);
  if (v.url.trim()) lines.push(`URL:${v.url.trim()}`);
  lines.push("END:VCARD");
  return {
    errors,
    build: { payload: lines.join("\r\n"), sentence: `Adds a contact: ${fullName}`, filenameHint: slugify(fullName, "contact") },
  };
}

function mailtoParam(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}`;
}

function evaluateEmail(v: EmailValue): BuildOutcome {
  const errors: ValidationErrors = {};
  const to = v.to.trim();
  if (!to) errors.to = "Enter an email address.";
  else if (!EMAIL_RE.test(to)) errors.to = "Enter a valid email address.";
  if (Object.keys(errors).length) return { errors, build: null };

  const subject = v.subject.trim();
  const body = v.body;
  const params: string[] = [];
  if (subject) params.push(mailtoParam("subject", subject));
  if (body) params.push(mailtoParam("body", body));
  const recipient = encodeURIComponent(to).replace(/%40/g, "@");
  const payload = `mailto:${recipient}${params.length ? "?" + params.join("&") : ""}`;
  return { errors, build: { payload, sentence: `Emails ${to}`, filenameHint: slugify(to, "email") } };
}

function evaluatePhone(v: PhoneValue): BuildOutcome {
  const check = validatePhone(v.phone);
  if (check.error) return { errors: { phone: check.error }, build: null };
  return {
    errors: {},
    build: { payload: `tel:${check.trimmed}`, sentence: `Calls ${check.trimmed}`, filenameHint: slugify(check.trimmed, "phone") },
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function evaluateSms(v: SmsValue): BuildOutcome {
  const check = validatePhone(v.phone);
  if (check.error) return { errors: { phone: check.error }, build: null };
  const payload = `SMSTO:${check.trimmed}:${v.message}`;
  const sentence = v.message.trim()
    ? `Texts ${check.trimmed} saying "${truncate(v.message.trim(), 40)}"`
    : `Texts ${check.trimmed}`;
  return { errors: {}, build: { payload, sentence, filenameHint: slugify(check.trimmed, "sms") } };
}

function evaluateLocation(v: LocationValue): BuildOutcome {
  const errors: ValidationErrors = {};
  const latRaw = v.latitude.trim();
  const lonRaw = v.longitude.trim();

  if (!latRaw) errors.latitude = "Enter a latitude.";
  else if (!DECIMAL_RE.test(latRaw)) errors.latitude = "Use a plain decimal number.";
  else if (Number(latRaw) < -90 || Number(latRaw) > 90) errors.latitude = "Latitude must be between -90 and 90.";

  if (!lonRaw) errors.longitude = "Enter a longitude.";
  else if (!DECIMAL_RE.test(lonRaw)) errors.longitude = "Use a plain decimal number.";
  else if (Number(lonRaw) < -180 || Number(lonRaw) > 180) {
    errors.longitude = "Longitude must be between -180 and 180.";
  }

  if (Object.keys(errors).length) return { errors, build: null };
  return {
    errors,
    build: {
      payload: `geo:${latRaw},${lonRaw}`,
      sentence: `Opens a map location at ${latRaw}, ${lonRaw}`,
      filenameHint: slugify(`${latRaw}-${lonRaw}`, "location"),
    },
  };
}

type DateOnlyParts = { y: number; m: number; d: number };
type DateTimeParts = DateOnlyParts & { hh: number; mm: number };

function validDate(y: number, m: number, d: number): boolean {
  if (y < 100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parseDateOnlyParts(s: string): DateOnlyParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return undefined;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!validDate(y, m, d)) return undefined;
  return { y, m, d };
}

function parseDateTimeParts(s: string): DateTimeParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!match) return undefined;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const hh = Number(match[4]);
  const mm = Number(match[5]);
  if (!validDate(y, m, d) || hh > 23 || mm > 59) return undefined;
  return { y, m, d, hh, mm };
}

function partsToUtcMillis(p: DateOnlyParts | DateTimeParts): number {
  const t = p as DateTimeParts;
  return Date.UTC(p.y, p.m - 1, p.d, t.hh ?? 0, t.mm ?? 0);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function formatDateOnlyParts(p: DateOnlyParts): string {
  return `${pad(p.y, 4)}${pad(p.m, 2)}${pad(p.d, 2)}`;
}

function formatFloatingStampParts(p: DateTimeParts): string {
  return `${pad(p.y, 4)}${pad(p.m, 2)}${pad(p.d, 2)}T${pad(p.hh, 2)}${pad(p.mm, 2)}00`;
}

function formatUtcStamp(date: Date): string {
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}` +
    `T${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}Z`
  );
}

function addOneDay(p: DateOnlyParts): DateOnlyParts {
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

function randomUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type CalendarEvaluateOptions = { now?: Date; uid?: string };

function evaluateCalendar(v: CalendarValue, options: CalendarEvaluateOptions = {}): BuildOutcome {
  const errors: ValidationErrors = {};
  const title = v.title.trim();
  if (!title) errors.title = "Enter a title.";
  if (!v.start) errors.start = "Enter a start.";
  if (!v.end) errors.end = "Enter an end.";

  const startParts = v.start ? (v.allDay ? parseDateOnlyParts(v.start) : parseDateTimeParts(v.start)) : undefined;
  const endParts = v.end ? (v.allDay ? parseDateOnlyParts(v.end) : parseDateTimeParts(v.end)) : undefined;
  if (v.start && !startParts) errors.start = "Enter a valid date.";
  if (v.end && !endParts) errors.end = "Enter a valid date.";

  if (startParts && endParts) {
    const startMs = partsToUtcMillis(startParts);
    const endMs = partsToUtcMillis(endParts);
    const ok = v.allDay ? endMs >= startMs : endMs > startMs;
    if (!ok) errors.end = v.allDay ? "End must be on or after the start date." : "End must be after the start.";
  }

  if (Object.keys(errors).length || !startParts || !endParts) return { errors, build: null };

  const stamp = formatUtcStamp(options.now ?? new Date());
  const uid = options.uid ?? `${randomUid()}@tools.michaelfbryan.com`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//tools.michaelfbryan.com//QR Code Generator//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
  ];
  if (v.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnlyParts(startParts)}`);
    // All-day DTEND is exclusive, so the stored end is the day after the user's inclusive end date.
    lines.push(`DTEND;VALUE=DATE:${formatDateOnlyParts(addOneDay(endParts as DateOnlyParts))}`);
  } else {
    lines.push(`DTSTART:${formatFloatingStampParts(startParts as DateTimeParts)}`);
    lines.push(`DTEND:${formatFloatingStampParts(endParts as DateTimeParts)}`);
  }
  lines.push(foldICalLine(`SUMMARY:${escapeICal(title)}`));
  if (v.location.trim()) lines.push(foldICalLine(`LOCATION:${escapeICal(v.location.trim())}`));
  if (v.description.trim()) lines.push(foldICalLine(`DESCRIPTION:${escapeICal(v.description.trim())}`));
  lines.push("END:VEVENT", "END:VCALENDAR");

  return {
    errors: {},
    build: {
      payload: lines.join("\r\n"),
      sentence: `Adds a calendar event: ${title}`,
      filenameHint: slugify(title, "event"),
    },
  };
}

function evaluateText(v: TextValue): BuildOutcome {
  if (!v.text.trim()) return { errors: { text: "Enter some text." }, build: null };
  return {
    errors: {},
    build: {
      payload: v.text,
      sentence: `Shows text: "${truncate(v.text.trim(), 40)}"`,
      filenameHint: slugify(v.text.trim(), "text"),
    },
  };
}

export function evaluate(type: QrType, values: QrValues, options: CalendarEvaluateOptions = {}): BuildOutcome {
  switch (type) {
    case "url":
      return evaluateUrl(values.url);
    case "wifi":
      return evaluateWifi(values.wifi);
    case "contact":
      return evaluateContact(values.contact);
    case "email":
      return evaluateEmail(values.email);
    case "phone":
      return evaluatePhone(values.phone);
    case "sms":
      return evaluateSms(values.sms);
    case "location":
      return evaluateLocation(values.location);
    case "calendar":
      return evaluateCalendar(values.calendar, options);
    case "text":
      return evaluateText(values.text);
  }
}

export type PasteSuggestion =
  | { type: "vcard"; parsed: Partial<ContactValue> }
  | { type: "url"; url: string };

function unescapeVCardValue(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseVCardLoosely(text: string): Partial<ContactValue> {
  const result: Partial<ContactValue> = {};
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const match = /^([A-Za-z]+)(?:;[^:]*)?:(.*)$/.exec(rawLine.trim());
    if (!match) continue;
    const value = unescapeVCardValue(match[2]);
    switch (match[1].toUpperCase()) {
      case "N": {
        const [last, first] = value.split(";");
        if (first) result.firstName = first;
        if (last) result.lastName = last;
        break;
      }
      case "ORG":
        result.org = value;
        break;
      case "TEL":
        if (!result.phone) result.phone = value;
        break;
      case "EMAIL":
        if (!result.email) result.email = value;
        break;
      case "URL":
        if (!result.url) result.url = value;
        break;
    }
  }
  return result;
}

/**
 * Looks for obviously-structured content pasted into the raw-text field, so
 * the UI can offer (never force) a switch to a better-fitting type.
 */
export function detectPastedStructuredContent(text: string): PasteSuggestion | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^BEGIN:VCARD/i.test(trimmed)) return { type: "vcard", parsed: parseVCardLoosely(trimmed) };
  if (/^https?:\/\/\S+$/i.test(trimmed) && !trimmed.includes("\n")) return { type: "url", url: trimmed };
  return null;
}
