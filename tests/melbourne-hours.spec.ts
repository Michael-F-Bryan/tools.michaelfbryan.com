import { expect, test } from "@playwright/test";
import { availability } from "../src/entries/tools/melbourne-morning/hours";
import { places, type Place } from "../src/entries/tools/melbourne-morning/places";

const museum = places.find((place) => place.id === "melbourne-museum")!;
const readings = places.find((place) => place.id === "readings-carlton")!;
const dune = places.find((place) => place.id === "lune-fitzroy")!;

function withHours(hours: NonNullable<Place["hours"]>, timezone = "Australia/Melbourne"): Place {
  return { ...museum, hours, timezone, exceptions: undefined };
}

test("a venue opening inside the window follows an already-open venue; a dated holiday override wins", () => {
  const window = { date: "2026-09-25", from: "08:30", until: "12:00" };
  expect(availability(dune, window)).toMatchObject({ kind: "open", label: "Open at start · until 3pm" });
  expect(availability(museum, window)).toMatchObject({ kind: "later", label: "Opens 9am" });
  expect(availability(readings, window)).toMatchObject({ kind: "later", label: "Opens 10am" });
  expect(availability(readings, { date: "2026-10-02", from: "08:30", until: "12:00" }).label).toBe("Opens 9am");
});

test("closed throughout the window differs from missing schedule", () => {
  const window = { date: "2026-09-25", from: "18:00", until: "20:00" };
  expect(availability(museum, window).kind).toBe("closed");
  expect(availability(readings, window).kind).toBe("open");
  expect(availability(places.find((place) => place.id === "imax-melbourne")!, window).kind).toBe("unknown");
  expect(availability(withHours([{ days: [1], opens: "09:00", closes: "17:00" }]), window).kind).toBe("closed");
});

test("a previous day's overnight opening remains open after midnight, then closes", () => {
  const late = withHours([{ days: [1], opens: "22:00", closes: "02:00" }]);
  expect(availability(late, { date: "2026-09-28", from: "23:00", until: "23:45" }).kind).toBe("open");
  expect(availability(late, { date: "2026-09-29", from: "00:30", until: "01:30" })).toMatchObject({ kind: "open", label: "Open at start · until 2am" });
  expect(availability(late, { date: "2026-09-29", from: "02:30", until: "03:00" }).kind).toBe("closed");
});

test("a local window is converted in each place's timezone, including Melbourne DST", () => {
  const daily = [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "10:00", closes: "18:00" }];
  const window = { date: "2026-09-25", from: "09:00", until: "12:00" };
  expect(availability(withHours(daily), window).starts).toBe(Date.parse("2026-09-25T00:00:00Z"));
  expect(availability(withHours(daily, "America/Los_Angeles"), window).starts).toBe(Date.parse("2026-09-25T17:00:00Z"));
  expect(availability(withHours(daily), { date: "2026-10-04", from: "09:00", until: "12:00" }).starts).toBe(Date.parse("2026-10-03T23:00:00Z"));
});
