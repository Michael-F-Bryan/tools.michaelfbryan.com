import { expect, test } from "@playwright/test";

import {
  angleToMinute,
  formatClockTime,
  formatOffset,
  localMinuteFor,
  mergeSpansToArcs,
  minuteInSpan,
  minuteToAngle,
  parseClockTime,
  relativeDayOffset,
  wrapMinute,
} from "../src/entries/timezone-clock/clock-math";
import { angleFromCenter, fullRingPath, wedgePath } from "../src/entries/timezone-clock/geometry";
import { parseArrangementFromSearch, searchForArrangement, serializeArrangement } from "../src/entries/timezone-clock/serialization";
import type { Arrangement } from "../src/entries/timezone-clock/types";
import { createPerson, createSpan } from "../src/entries/timezone-clock/types";

test("wrapMinute normalises any integer into 0–1439", () => {
  expect(wrapMinute(0)).toBe(0);
  expect(wrapMinute(1439)).toBe(1439);
  expect(wrapMinute(1440)).toBe(0);
  expect(wrapMinute(-1)).toBe(1439);
  expect(wrapMinute(-1440)).toBe(0);
  expect(wrapMinute(2880 + 30)).toBe(30);
});

test("minuteToAngle and angleToMinute are inverses at the hour marks", () => {
  for (const minute of [0, 360, 540, 720, 1080, 1439]) {
    expect(angleToMinute(minuteToAngle(minute))).toBe(minute);
  }
  expect(minuteToAngle(0)).toBe(0);
  expect(minuteToAngle(360)).toBe(90);
  expect(minuteToAngle(720)).toBe(180);
  expect(minuteToAngle(1080)).toBe(270);
});

test("localMinuteFor applies a fixed offset with no DST awareness", () => {
  // Same instant, AWST (+480) reads 09:00 while UTC reads 01:00.
  const anchor = 60;
  expect(localMinuteFor(anchor, 480)).toBe(540);
  expect(localMinuteFor(anchor, 0)).toBe(60);
  // US Eastern Standard (-300) is the previous day's evening.
  expect(localMinuteFor(anchor, -300)).toBe(1200);
});

test("minuteInSpan covers ordinary and overnight (wrapping) spans", () => {
  const ordinary = { startMinute: 540, endMinute: 1020 }; // 09:00–17:00
  expect(minuteInSpan(540, ordinary)).toBe(true); // inclusive start
  expect(minuteInSpan(1020, ordinary)).toBe(false); // exclusive end
  expect(minuteInSpan(1019, ordinary)).toBe(true);
  expect(minuteInSpan(0, ordinary)).toBe(false);

  const overnight = { startMinute: 1320, endMinute: 1560 }; // 22:00–02:00
  expect(minuteInSpan(1320, overnight)).toBe(true);
  expect(minuteInSpan(1439, overnight)).toBe(true);
  expect(minuteInSpan(0, overnight)).toBe(true);
  expect(minuteInSpan(119, overnight)).toBe(true);
  expect(minuteInSpan(120, overnight)).toBe(false); // exclusive end at 02:00
  expect(minuteInSpan(1319, overnight)).toBe(false);
});

test("relativeDayOffset reports previous/same/next day across the anchor's midnight", () => {
  const reference = 480; // AWST
  // At 09:00 AWST (anchor 60), US Eastern Standard (-300) reads 19:00 the previous day.
  expect(relativeDayOffset(60, -300, reference)).toBe(-1);
  expect(relativeDayOffset(60, 480, reference)).toBe(0);
  // Late in the UTC day, a person further ahead (NZST +720) has already rolled into
  // the next day while UTC itself (reference 0) has not.
  expect(relativeDayOffset(1000, 720, 0)).toBe(1);
  expect(relativeDayOffset(1400, reference, reference)).toBe(0);
});

test("relativeDayOffset is not clamped to -1/0/1: extreme offsets can be two days apart", () => {
  // At 11:00 UTC, Kiribati (UTC+14) has already rolled into the next UTC day
  // while Baker Island (UTC-12) is still a day behind it — two full days apart.
  expect(relativeDayOffset(660, 840, -720)).toBe(2);
  expect(relativeDayOffset(660, -720, 840)).toBe(-2);
});

test("mergeSpansToArcs unions overlapping and touching spans without altering single spans", () => {
  expect(mergeSpansToArcs([createSpan(540, 1020)])).toEqual([{ startMinute: 540, endMinute: 1020 }]);

  // Overlapping spans merge into one arc.
  const overlapping = [createSpan(540, 700), createSpan(650, 1020)];
  expect(mergeSpansToArcs(overlapping)).toEqual([{ startMinute: 540, endMinute: 1020 }]);

  // Touching spans (end === next start) merge too.
  const touching = [createSpan(0, 600), createSpan(600, 900)];
  expect(mergeSpansToArcs(touching)).toEqual([{ startMinute: 0, endMinute: 900 }]);

  // Disjoint spans stay separate, sorted by start.
  const disjoint = [createSpan(900, 1000), createSpan(0, 60)];
  expect(mergeSpansToArcs(disjoint)).toEqual([
    { startMinute: 0, endMinute: 60 },
    { startMinute: 900, endMinute: 1000 },
  ]);
});

test("mergeSpansToArcs joins pieces that wrap across midnight into one arc", () => {
  // 22:00 -> 02:00 and 02:00 -> 06:00 should become one continuous overnight arc.
  const spans = [createSpan(1320, 1560), createSpan(120, 360)];
  expect(mergeSpansToArcs(spans)).toEqual([{ startMinute: 1320, endMinute: 360 + 1440 }]);
});

test("mergeSpansToArcs recognises full-day coverage from multiple spans", () => {
  const spans = [createSpan(0, 720), createSpan(720, 1440)];
  const arcs = mergeSpansToArcs(spans);
  expect(arcs).toEqual([{ startMinute: 0, endMinute: 1440 }]);
});

test("formatClockTime and formatOffset render human-readable, zero-padded strings", () => {
  expect(formatClockTime(0)).toBe("00:00");
  expect(formatClockTime(540)).toBe("09:00");
  expect(formatClockTime(1439)).toBe("23:59");
  expect(formatClockTime(1440)).toBe("00:00");
  expect(formatOffset(480)).toBe("UTC+08:00");
  expect(formatOffset(0)).toBe("UTC+00:00");
  expect(formatOffset(-570)).toBe("UTC−09:30");
  expect(formatOffset(345)).toBe("UTC+05:45");
});

test("parseClockTime accepts HH:MM and rejects malformed strings", () => {
  expect(parseClockTime("09:00")).toBe(540);
  expect(parseClockTime("23:59")).toBe(1439);
  expect(parseClockTime("")).toBeNull();
  expect(parseClockTime("9:00")).toBeNull();
  expect(parseClockTime("24:00")).toBeNull();
  expect(parseClockTime("12:60")).toBeNull();
});

test("wedgePath and fullRingPath produce non-degenerate SVG path data", () => {
  const wedge = wedgePath(100, 100, 40, 60, 0, 90);
  expect(wedge.startsWith("M ")).toBe(true);
  expect(wedge).toContain("A 60 60 0 0 1");
  const largeArc = wedgePath(100, 100, 40, 60, 0, 270);
  expect(largeArc).toContain("A 60 60 0 1 1");

  const ring = fullRingPath(100, 100, 40, 60);
  expect(ring.match(/A 60 60/g)?.length).toBe(2);
  expect(ring.match(/A 40 40/g)?.length).toBe(2);
});

test("angleFromCenter excludes the exact centre as a dead zone and measures clockwise from the top", () => {
  expect(angleFromCenter(100, 100, 100, 100, 10)).toBeNull();
  expect(angleFromCenter(100, 100, 100, 95, 10)).toBeNull(); // inside dead zone, above centre
  expect(angleFromCenter(100, 100, 100, 0, 10)).toBe(0); // straight up = top = 0deg
  expect(angleFromCenter(100, 100, 200, 100, 10)).toBe(90); // straight right = 90deg clockwise
  expect(angleFromCenter(100, 100, 100, 200, 10)).toBe(180); // straight down = 180deg
  expect(angleFromCenter(100, 100, 0, 100, 10)).toBe(270); // straight left = 270deg
});

function arrangement(): Arrangement {
  return {
    referenceOffsetMinutes: 480,
    selectedMinuteUtc: 60,
    people: [
      createPerson({ name: "Perth", offsetMinutes: 480, color: "#0072B2", spans: [createSpan(540, 1020)] }),
      createPerson({
        name: "New York",
        offsetMinutes: -300,
        color: "#009E73",
        spans: [createSpan(480, 990), createSpan(1320, 1560)],
      }),
    ],
  };
}

test("serializeArrangement and parseArrangementFromSearch round-trip the full arrangement and selection", () => {
  const original = arrangement();
  const search = searchForArrangement(original);
  expect(search.startsWith("?tz=")).toBe(true);

  const result = parseArrangementFromSearch(search);
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  expect(result.arrangement.referenceOffsetMinutes).toBe(original.referenceOffsetMinutes);
  expect(result.arrangement.selectedMinuteUtc).toBe(original.selectedMinuteUtc);
  expect(result.arrangement.people.map((p) => ({ name: p.name, offsetMinutes: p.offsetMinutes, color: p.color, spans: p.spans.map((s) => [s.startMinute, s.endMinute]) }))).toEqual(
    original.people.map((p) => ({ name: p.name, offsetMinutes: p.offsetMinutes, color: p.color, spans: p.spans.map((s) => [s.startMinute, s.endMinute]) })),
  );
  // Ids are regenerated, not round-tripped, and are present/unique.
  const ids = result.arrangement.people.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("parseArrangementFromSearch treats a missing parameter as absent, not an error", () => {
  expect(parseArrangementFromSearch("")).toEqual({ kind: "absent" });
  expect(parseArrangementFromSearch("?other=1")).toEqual({ kind: "absent" });
});

test("parseArrangementFromSearch reports a clear, recoverable error for malformed data instead of guessing", () => {
  expect(parseArrangementFromSearch("?tz=not-json").kind).toBe("error");
  expect(parseArrangementFromSearch("?tz=" + encodeURIComponent("{}")).kind).toBe("error");
  expect(parseArrangementFromSearch("?tz=" + encodeURIComponent(JSON.stringify({ v: 2, r: 0, t: 0, p: [] }))).kind).toBe("error");
  expect(parseArrangementFromSearch("?tz=" + encodeURIComponent(JSON.stringify({ v: 1, r: 0, t: 0, p: [] }))).kind).toBe("error"); // empty people
  expect(
    parseArrangementFromSearch(
      "?tz=" + encodeURIComponent(JSON.stringify({ v: 1, r: 5000, t: 0, p: [{ n: "A", o: 0, c: "#000000", s: [] }] })),
    ).kind,
  ).toBe("error"); // offset out of range
  expect(
    parseArrangementFromSearch(
      "?tz=" + encodeURIComponent(JSON.stringify({ v: 1, r: 0, t: 0, p: [{ n: "A", o: 0, c: "not-a-color", s: [] }] })),
    ).kind,
  ).toBe("error");
  expect(
    parseArrangementFromSearch(
      "?tz=" + encodeURIComponent(JSON.stringify({ v: 1, r: 0, t: 0, p: [{ n: "A", o: 0, c: "#000000", s: [[100, 50]] }] })),
    ).kind,
  ).toBe("error"); // end before start
});

test("a URL-level mutation of a valid link is still rejected safely", () => {
  const search = searchForArrangement(arrangement());
  const tampered = search.slice(0, -5) + "xxxxx";
  const result = parseArrangementFromSearch(tampered);
  expect(result.kind).toBe("error");
});

test("serializeArrangement never embeds internal ids, only wire fields", () => {
  const serialized = serializeArrangement(arrangement());
  expect(serialized).not.toContain("person-");
  expect(serialized).not.toContain("span-");
});
