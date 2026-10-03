/**
 * Pure time/angle/geometry helpers for the clock. Everything here treats a
 * day as a 1440-minute cycle with no calendar date attached — "the same
 * angle is the same instant" for every person on the dial, and switching
 * which offset sits at the top (the reference) only ever relabels angles,
 * never the underlying instant.
 */
import { MINUTES_PER_DAY, type Span } from "./types";

export function wrapMinute(minute: number): number {
  return ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function snapMinute(minute: number): number {
  return wrapMinute(Math.round(minute / 5) * 5);
}

/** The time-of-day (0–1439) a person with `offsetMinutes` reads at the shared `anchorMinute`. */
export function localMinuteFor(anchorMinute: number, offsetMinutes: number): number {
  return wrapMinute(anchorMinute + offsetMinutes);
}

/** Inverse of `localMinuteFor`: the shared anchor minute that reads as `localMinute` for `offsetMinutes`. */
export function anchorMinuteFor(localMinute: number, offsetMinutes: number): number {
  return wrapMinute(localMinute - offsetMinutes);
}

/** Clockwise degrees from the top (0 = top = local midnight for whichever offset is drawing the dial). */
export function minuteToAngle(minute: number): number {
  return (wrapMinute(minute) / MINUTES_PER_DAY) * 360;
}

export function angleToMinute(angleDegrees: number): number {
  const wrapped = ((angleDegrees % 360) + 360) % 360;
  return wrapMinute(Math.round((wrapped / 360) * MINUTES_PER_DAY));
}

/**
 * Whether `minute` (0–1439, in the same local time as `span`) falls inside
 * `span`. Spans may encode `endMinute > 1440` for an overnight crossing, so
 * membership is also checked one cycle up to catch the wrapped portion.
 */
export function minuteInSpan(minute: number, span: Readonly<{ startMinute: number; endMinute: number }>): boolean {
  return (
    (minute >= span.startMinute && minute < span.endMinute) ||
    (minute + MINUTES_PER_DAY >= span.startMinute && minute + MINUTES_PER_DAY < span.endMinute)
  );
}

/**
 * Which calendar day a person's local reading of `anchorMinute` falls on,
 * relative to the reference offset's reading of the same instant. Because
 * there is no real calendar here, "day" just means "how many midnights of
 * that offset have passed since the anchor's own midnight".
 *
 * Offsets span up to 28 hours apart (UTC+14 to UTC-12, plus the reference
 * itself can be anywhere in that range too), so this can legitimately be
 * more than one day in either direction — it is not clamped to -1/0/1.
 */
export function relativeDayOffset(anchorMinute: number, personOffsetMinutes: number, referenceOffsetMinutes: number): number {
  const personDay = Math.floor((anchorMinute + personOffsetMinutes) / MINUTES_PER_DAY);
  const referenceDay = Math.floor((anchorMinute + referenceOffsetMinutes) / MINUTES_PER_DAY);
  return personDay - referenceDay;
}

export type Arc = Readonly<{ startMinute: number; endMinute: number }>;

/**
 * Merges a person's (possibly overlapping, possibly overnight) spans into
 * the smallest set of disjoint arcs for drawing, so overlaps render as one
 * continuous band instead of doubled-up seams. The stored spans themselves
 * are left untouched — only the rendering is unioned.
 */
export function mergeSpansToArcs(spans: readonly Span[]): readonly Arc[] {
  if (spans.length === 0) return [];

  const pieces: Arc[] = [];
  for (const span of spans) {
    const start = wrapMinute(span.startMinute);
    const length = span.endMinute - span.startMinute;
    const end = start + length;
    if (end <= MINUTES_PER_DAY) {
      pieces.push({ startMinute: start, endMinute: end });
    } else {
      pieces.push({ startMinute: start, endMinute: MINUTES_PER_DAY });
      pieces.push({ startMinute: 0, endMinute: end - MINUTES_PER_DAY });
    }
  }

  pieces.sort((a, b) => a.startMinute - b.startMinute);

  const merged: Arc[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && piece.startMinute <= last.endMinute) {
      if (piece.endMinute > last.endMinute) {
        merged[merged.length - 1] = { startMinute: last.startMinute, endMinute: piece.endMinute };
      }
    } else {
      merged.push(piece);
    }
  }

  if (merged.length === 0) return [];

  const first = merged[0];
  const last = merged[merged.length - 1];
  if (merged.length > 1 && first.startMinute === 0 && last.endMinute === MINUTES_PER_DAY) {
    const wrapped: Arc = { startMinute: last.startMinute, endMinute: first.endMinute + MINUTES_PER_DAY };
    return [wrapped, ...merged.slice(1, -1)];
  }

  // A single piece spanning exactly the full day is "available all day".
  return merged;
}

export function isFullDay(arcs: readonly Arc[]): boolean {
  return arcs.length === 1 && arcs[0].startMinute === 0 && arcs[0].endMinute === MINUTES_PER_DAY;
}

export function formatClockTime(minute: number): string {
  const wrapped = wrapMinute(minute);
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "−" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Parses an `HH:MM` string (as produced by `<input type="time">`) into minutes-of-day, or `null` if malformed. */
export function parseClockTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
