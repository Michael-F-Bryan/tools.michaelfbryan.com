/** Escapes a value for the WIFI: URI (RFC-less, but universally implemented) special characters. */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** Escapes a value for vCard 3.0 (RFC 2426) text properties. */
export function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Escapes a value for iCalendar (RFC 5545) TEXT properties. */
export function escapeICal(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Folds an iCalendar content line to at most 75 octets per physical line, as
 * RFC 5545 requires. Counts UTF-8 octets (not UTF-16 code units) and never
 * splits a surrogate pair, since it chunks by Unicode code point.
 */
export function foldICalLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const codePoints = Array.from(line);
  let result = "";
  let current = "";
  let limit = 75;
  for (const codePoint of codePoints) {
    const candidate = current + codePoint;
    if (current && encoder.encode(candidate).length > limit) {
      result += (result ? "\r\n " : "") + current;
      current = codePoint;
      limit = 74;
    } else {
      current = candidate;
    }
  }
  if (current) result += (result ? "\r\n " : "") + current;
  return result;
}
