import { Temporal } from "@js-temporal/polyfill";
import type { Place } from "./places";

export type Window = Readonly<{ date: string; from: string; until: string }>;
export type Availability = Readonly<{
  kind: "open" | "later" | "unknown" | "closed";
  label: string;
  starts: number; // epoch milliseconds; useful for ordering
}>;

function minutesLabel(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${hours < 12 ? "am" : "pm"}`;
}

function localInstant(date: Temporal.PlainDate, time: string, zone: string) {
  return date.toPlainDateTime(time).toZonedDateTime(zone).toInstant().epochMilliseconds;
}

export function availability(place: Place, window: Window): Availability {
  const day = Temporal.PlainDate.from(window.date);
  const start = localInstant(day, window.from, place.timezone);
  const end = localInstant(day, window.until, place.timezone);
  if (end <= start) throw new RangeError("Window must end after it starts in the place's timezone");

  const schedule = place.hours;
  if (!schedule) return { kind: "unknown", label: place.hoursNote ?? "Hours unknown · check venue", starts: Infinity };

  // Include yesterday's overnight opening and tomorrow for a window near midnight.
  const overlapping = [-1, 0, 1].flatMap((offset) => {
    const openingDay = day.add({ days: offset });
    const weekday = openingDay.dayOfWeek % 7;
    const date = openingDay.toString();
    const hoursForDay = place.exceptions && Object.hasOwn(place.exceptions, date)
      ? place.exceptions[date] : schedule;
    return (hoursForDay ?? []).filter((hours) => hours.days.includes(weekday)).map((hours) => {
      const opens = localInstant(openingDay, hours.opens, place.timezone);
      const closes = localInstant(
        openingDay.add({ days: hours.closes <= hours.opens ? 1 : 0 }),
        hours.closes,
        place.timezone,
      );
      return { opens, closes, closingLabel: minutesLabel(hours.closes) };
    });
  }).filter(({ opens, closes }) => opens < end && closes > start)
    .sort((a, b) => a.opens - b.opens);

  if (!overlapping.length) return { kind: "closed", label: "Closed in this window", starts: Infinity };
  const active = overlapping.find(({ opens, closes }) => opens <= start && closes > start);
  if (active) return { kind: "open", label: `Open at start · until ${active.closingLabel}`, starts: start };
  const next = overlapping[0];
  const opening = Temporal.Instant.fromEpochMilliseconds(next.opens)
    .toZonedDateTimeISO(place.timezone);
  const time = `${String(opening.hour).padStart(2, "0")}:${String(opening.minute).padStart(2, "0")}`;
  return { kind: "later", label: `Opens ${minutesLabel(time)}`, starts: next.opens };
}

export function localNow(zone: string, now = Temporal.Now.instant()) {
  const local = now.toZonedDateTimeISO(zone);
  return {
    date: local.toPlainDate().toString(),
    time: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
  };
}
