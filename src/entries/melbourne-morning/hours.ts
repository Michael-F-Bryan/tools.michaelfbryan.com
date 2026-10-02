import { Temporal } from "@js-temporal/polyfill";
import type { Place } from "./places";

export type Window = Readonly<{ date: string; from: string; until: string }>;
export type Availability = Readonly<{
  kind: "open" | "later" | "unknown" | "closed";
  label: string;
  starts: number; // first estimated usable instant, for ordering
}>;

function minutesLabel(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${hours < 12 ? "am" : "pm"}`;
}

function localInstant(date: Temporal.PlainDate, time: string, zone: string) {
  return date.toPlainDateTime(time).toZonedDateTime(zone).toInstant().epochMilliseconds;
}

export function availability(place: Place, window: Window, walkingMinutes = 0): Availability {
  const day = Temporal.PlainDate.from(window.date);
  const start = localInstant(day, window.from, place.timezone);
  const end = localInstant(day, window.until, place.timezone);
  if (end <= start) throw new RangeError("Window must end after it starts in the place's timezone");

  const schedule = place.hours;
  if (!schedule) return { kind: "unknown", label: place.hoursNote ?? "Hours unknown · check venue", starts: Infinity };
  if (place.uncertainDates?.includes(window.date)) {
    return { kind: "unknown", label: "Special-date hours unverified · check venue", starts: Infinity };
  }
  if (place.exceptions && Object.hasOwn(place.exceptions, window.date) && place.exceptions[window.date] === null) {
    return { kind: "closed", label: "Closed on selected date (venue notice)", starts: Infinity };
  }

  const arrival = start + Math.max(0, walkingMinutes) * 60_000;
  if (arrival >= end) return { kind: "closed", label: "Not reachable in this window (estimate)", starts: Infinity };

  // Include yesterday's overnight opening. A dated exception overrides that day's weekly hours.
  const intervals = [-1, 0, 1].flatMap((offset) => {
    const openingDay = day.add({ days: offset });
    const date = openingDay.toString();
    const weekday = openingDay.dayOfWeek % 7;
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

  const usable = intervals.find(({ closes }) => closes > arrival);
  if (!usable) {
    const closesBeforeArrival = intervals.some(({ closes }) => closes <= arrival);
    return {
      kind: "closed",
      label: closesBeforeArrival ? "Closes before estimated arrival" : "No listed opening in this window",
      starts: Infinity,
    };
  }
  const published = place.exceptions && Object.hasOwn(place.exceptions, window.date);
  const prefix = published ? "Listed special-date hours" : "Listed hours";
  if (usable.opens <= arrival) {
    return { kind: "open", label: `${prefix}: open on arrival · until ${usable.closingLabel}`, starts: arrival };
  }
  const opening = Temporal.Instant.fromEpochMilliseconds(usable.opens)
    .toZonedDateTimeISO(place.timezone);
  const time = `${String(opening.hour).padStart(2, "0")}:${String(opening.minute).padStart(2, "0")}`;
  return { kind: "later", label: `${prefix}: opens ${minutesLabel(time)}`, starts: usable.opens };
}

export function listedHoursForDate(place: Place, date: string): string {
  if (!place.hours) return place.hoursNote ?? "Hours unknown";
  if (place.uncertainDates?.includes(date)) return "Special-date hours unverified";
  const day = Temporal.PlainDate.from(date);
  const schedule = place.exceptions && Object.hasOwn(place.exceptions, date)
    ? place.exceptions[date] : place.hours;
  if (schedule === null) return "Closed on selected date";
  const periods = schedule.filter((hours) => hours.days.includes(day.dayOfWeek % 7));
  return periods.length ? periods.map(({ opens, closes }) => `${opens}–${closes}`).join(", ") : "No listed hours for selected day";
}

export function localNow(zone: string, now = Temporal.Now.instant()) {
  const local = now.toZonedDateTimeISO(zone);
  return {
    date: local.toPlainDate().toString(),
    time: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
  };
}
