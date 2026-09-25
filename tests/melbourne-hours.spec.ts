import { expect, test } from "@playwright/test";
import { availability, listedHoursForDate } from "../src/entries/tools/melbourne-morning/hours";
import { places, type Place } from "../src/entries/tools/melbourne-morning/places";

const museum = places.find((place) => place.id === "melbourne-museum")!;
const readings = places.find((place) => place.id === "readings-carlton")!;
const lune = places.find((place) => place.id === "lune-fitzroy")!;

function withHours(hours: NonNullable<Place["hours"]>, timezone = "Australia/Melbourne"): Place {
  return { ...museum, hours, timezone, exceptions: undefined };
}

test("holiday hours override ordinary Friday hours without implying a live confirmation", () => {
  const window = { date: "2026-09-25", from: "08:30", until: "12:00" };
  expect(availability(lune, window)).toMatchObject({ kind: "open", label: "Listed special-date hours: open on arrival · until 3pm" });
  expect(availability(museum, window)).toMatchObject({ kind: "later", label: "Listed hours: opens 9am" });
  expect(availability(readings, window)).toMatchObject({ kind: "later", label: "Listed special-date hours: opens 10am" });
  expect(availability(readings, { date: "2026-10-02", from: "08:30", until: "12:00" }).label).toBe("Listed hours: opens 9am");
});

test("a venue's confirmed closure, no window overlap and missing schedule are distinct", () => {
  const window = { date: "2026-09-25", from: "18:00", until: "20:00" };
  expect(availability(museum, window).kind).toBe("closed");
  expect(availability(readings, window).kind).toBe("open");
  expect(availability(places.find((place) => place.id === "chinese-museum")!, window).label).toBe("Closed on selected date (venue notice)");
  expect(availability(places.find((place) => place.id === "melbourne-city-baths")!, window).kind).toBe("unknown");
  expect(availability(places.find((place) => place.id === "imax-melbourne")!, window).kind).toBe("unknown");
  expect(availability(withHours([{ days: [1], opens: "09:00", closes: "17:00" }]), window).kind).toBe("closed");
});

test("a previous day's overnight opening remains open after midnight, then closes", () => {
  const late = withHours([{ days: [1], opens: "22:00", closes: "02:00" }]);
  expect(availability(late, { date: "2026-09-28", from: "23:00", until: "23:45" }).kind).toBe("open");
  expect(availability(late, { date: "2026-09-29", from: "00:30", until: "01:30" })).toMatchObject({ kind: "open", label: "Listed hours: open on arrival · until 2am" });
  expect(availability(late, { date: "2026-09-29", from: "02:30", until: "03:00" }).kind).toBe("closed");
});

test("a local window is converted in each place's timezone, including Melbourne DST", () => {
  const daily = [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "10:00", closes: "18:00" }];
  const window = { date: "2026-09-25", from: "09:00", until: "12:00" };
  expect(availability(withHours(daily), window).starts).toBe(Date.parse("2026-09-25T00:00:00Z"));
  expect(availability(withHours(daily, "America/Los_Angeles"), window).starts).toBe(Date.parse("2026-09-25T17:00:00Z"));
  expect(availability(withHours(daily), { date: "2026-10-04", from: "09:00", until: "12:00" }).starts).toBe(Date.parse("2026-10-03T23:00:00Z"));
});

test("a place closing before estimated arrival is not presented as usable", () => {
  const window = { date: "2026-09-25", from: "16:50", until: "17:30" };
  expect(availability(museum, window, 15)).toMatchObject({ kind: "closed", label: "Closes before estimated arrival" });
  expect(availability(museum, window, 2).kind).toBe("open");
  expect(availability(museum, { date: "2026-09-25", from: "09:00", until: "09:05" }, 10).label).toBe("Not reachable in this window (estimate)");
});

test("detail hours are selected-day periods, not other weekdays or unverified holiday hours", () => {
  const gallery = places.find((place) => place.id === "brunswick-street-gallery")!;
  expect(listedHoursForDate(gallery, "2026-09-25")).toBe("10:00–17:00");
  expect(listedHoursForDate(gallery, "2026-09-27")).toBe("11:00–16:00");
  expect(listedHoursForDate(gallery, "2026-09-28")).toBe("No listed hours for selected day");
  expect(listedHoursForDate(places.find((place) => place.id === "melbourne-city-baths")!, "2026-09-25")).toBe("Special-date hours unverified");
  expect(listedHoursForDate(places.find((place) => place.id === "kathleen-syme")!, "2026-09-25")).toBe("Closed on selected date");
});
