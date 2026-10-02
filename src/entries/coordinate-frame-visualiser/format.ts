/** Presentation-only number formatting shared by the orientation and position modes. */

/** A thin space, used to group digits in large metre counts. */
const THIN_SPACE = " ";

/**
 * Formats a matrix/vector entry to a fixed number of decimals with an
 * explicit sign, never printing a signed zero (`-0.0000` becomes `+0.0000`).
 */
export function formatSigned(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(decimals));
  const magnitude = Math.abs(rounded).toFixed(decimals);
  const sign = rounded < 0 ? "−" : "+";
  return `${sign}${magnitude}`;
}

/** Formats a plain (unsigned-style) number to a fixed number of decimals. */
export function formatFixed(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

/** Formats metres to the nearest whole metre, grouped with thin spaces every 3 digits. */
export function formatMetres(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  return `${negative ? "−" : ""}${grouped}`;
}

/** Formats degrees to one decimal place. */
export function formatDegrees(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

/** Formats radians to 4 decimal places, matching the reviewed concept's precision. */
export function formatRadians(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(4);
}

/** Parses a user-typed number, rejecting empty strings, letters, and non-finite results. */
export function parseUserNumber(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
