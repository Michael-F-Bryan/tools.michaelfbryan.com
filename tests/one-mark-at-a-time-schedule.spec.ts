import { expect, test } from "@playwright/test";

import { MARKS, STROKE_WIDTHS, VIEW_BOX } from "../src/entries/tools/one-mark-at-a-time/marks";
import {
  DRIFT_STEP_MS,
  TIMING,
  TOTAL_MARKS,
  injectedDelayMs,
  phaseAt,
  shouldStartOver,
  type Phase,
} from "../src/entries/tools/one-mark-at-a-time/schedule";

/** Which of a command's arguments are coordinate pairs, by leading argument index. */
const POINTS: Record<string, readonly number[]> = {
  M: [0],
  L: [0],
  Q: [0, 2],
  C: [0, 2, 4],
  // rx ry rotation large-arc sweep x y: only the last pair is a coordinate.
  A: [5],
};

/** Every coordinate pair named by an absolute SVG path, control points included. */
function pathPoints(d: string): [number, number][] {
  const points: [number, number][] = [];

  for (const [, command, args] of d.matchAll(/([MLQCA])((?:\s+-?[\d.]+)+)/g)) {
    const numbers = args!.trim().split(/\s+/).map(Number);
    for (const offset of POINTS[command!]!) {
      points.push([numbers[offset]!, numbers[offset + 1]!]);
    }
  }

  expect(points.length, d).toBeGreaterThan(0);
  return points;
}

/** The injected delay for every press of a complete run, in order. */
function profile(): number[] {
  return Array.from({ length: TOTAL_MARKS }, (_unused, index) => injectedDelayMs(index));
}

function phases(): Phase[] {
  return Array.from({ length: TOTAL_MARKS }, (_unused, index) => phaseAt(index));
}

test.describe("the timing profile", () => {
  test("covers exactly one press per mark", () => {
    expect(TOTAL_MARKS).toBe(
      TIMING.settleMarks + TIMING.driftMarks + TIMING.holdMarks + TIMING.releaseMarks,
    );
    expect(MARKS).toHaveLength(TOTAL_MARKS);
  });

  test("runs settle, drift, hold, release, in that order and only once each", () => {
    const boundaries = phases().reduce<Phase[]>((seen, phase) => {
      if (seen.at(-1) !== phase) seen.push(phase);
      return seen;
    }, []);

    expect(boundaries).toEqual(["settle", "drift", "hold", "release"]);
  });

  test("opens and closes with no injected delay at all", () => {
    const delays = profile();

    expect(delays.slice(0, TIMING.settleMarks)).toEqual(
      Array.from({ length: TIMING.settleMarks }, () => 0),
    );
    expect(delays.slice(-TIMING.releaseMarks)).toEqual(
      Array.from({ length: TIMING.releaseMarks }, () => 0),
    );
  });

  test("climbs to the hold delay in equal unobtrusive steps", () => {
    const drift = profile().slice(TIMING.settleMarks, TIMING.settleMarks + TIMING.driftMarks);

    expect(drift).toEqual([18, 36, 54, 72, 90, 108, 126, 144, 162, 180]);
    expect(DRIFT_STEP_MS).toBe(TIMING.holdDelayMs / TIMING.driftMarks);
    // Each step has to be small enough to pass unnoticed inside a self-paced
    // action, which is the whole reason the delay is introduced gradually.
    expect(DRIFT_STEP_MS).toBeLessThanOrEqual(20);
    expect(drift.at(-1)).toBe(TIMING.holdDelayMs);
  });

  test("never steps backwards before the release, and then drops the whole delay at once", () => {
    const delays = profile();
    const beforeRelease = delays.slice(0, TOTAL_MARKS - TIMING.releaseMarks);

    for (let index = 1; index < beforeRelease.length; index += 1) {
      expect(beforeRelease[index]).toBeGreaterThanOrEqual(beforeRelease[index - 1]!);
    }

    expect(beforeRelease.at(-1)).toBe(TIMING.holdDelayMs);
    expect(delays[TOTAL_MARKS - TIMING.releaseMarks]).toBe(0);
  });

  test("sustains enough delayed marks for the drop to be a surprise", () => {
    const delayed = profile().filter((delay) => delay > 0);

    expect(delayed).toHaveLength(TIMING.driftMarks + TIMING.holdMarks);
    // Well clear of the browser's own input and display latency, so the delay
    // being removed is a change to something that was actually there.
    expect(TIMING.holdDelayMs).toBeGreaterThan(100);
  });

  test("a press past the end of the run asks for nothing", () => {
    expect(phaseAt(TOTAL_MARKS)).toBe("release");
    expect(injectedDelayMs(TOTAL_MARKS)).toBe(0);
  });
});

test.describe("shouldStartOver", () => {
  test("ignores pauses before any delay has been injected", () => {
    for (let index = 0; index <= TIMING.settleMarks; index += 1) {
      expect(shouldStartOver(index, 60_000, TIMING.idleLimitMs)).toBe(false);
    }
  });

  test("abandons an adapted run once the gap passes the limit", () => {
    const adapted = TIMING.settleMarks + TIMING.driftMarks + 1;

    expect(shouldStartOver(adapted, TIMING.idleLimitMs + 1, TIMING.idleLimitMs)).toBe(true);
    expect(shouldStartOver(adapted, TIMING.idleLimitMs, TIMING.idleLimitMs)).toBe(false);
    expect(shouldStartOver(adapted, TIMING.awayLimitMs + 1, TIMING.awayLimitMs)).toBe(true);
    expect(shouldStartOver(adapted, TIMING.awayLimitMs, TIMING.awayLimitMs)).toBe(false);
  });

  test("is stricter about a hidden page than about a visitor who hesitates", () => {
    expect(TIMING.awayLimitMs).toBeLessThan(TIMING.idleLimitMs);
  });
});

test.describe("the drawing", () => {
  test("reveals every mark exactly once", () => {
    const ids = MARKS.map((mark) => mark.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("is made only of marks a browser can draw", () => {
    for (const mark of MARKS) {
      expect(mark.d, mark.id).toMatch(/^M [\d.-]+ [\d.-]+ [ACLQ]/);
      expect(mark.d, mark.id).not.toContain("NaN");
      expect(STROKE_WIDTHS[mark.weight], mark.id).toBeGreaterThan(0);
    }
  });

  test("fits inside its own coordinate window", () => {
    const [minX, minY, width, height] = VIEW_BOX.split(" ").map(Number);

    for (const mark of MARKS) {
      for (const [x, y] of pathPoints(mark.d)) {
        expect(x, `${mark.id} x`).toBeGreaterThanOrEqual(minX!);
        expect(x, `${mark.id} x`).toBeLessThanOrEqual(minX! + width!);
        expect(y, `${mark.id} y`).toBeGreaterThanOrEqual(minY!);
        expect(y, `${mark.id} y`).toBeLessThanOrEqual(minY! + height!);
      }
    }
  });

  test("ends on the three marks that land with the delay removed", () => {
    // The release marks have to be worth watching for: the drawing is not
    // finished without them, and each is a clear, separate piece of ink.
    expect(MARKS.slice(-TIMING.releaseMarks).map((mark) => mark.id)).toEqual([
      "fork",
      "saddle",
      "handlebar",
    ]);
  });

  test("keeps the faint marks apart once the delay starts moving", () => {
    // A hairline is the least noticeable mark in the drawing. Two in a row
    // while the timing is changing would give a visitor two weak events to
    // judge it by, so after the opening marks they are always separated.
    const faint = MARKS.map((mark) => mark.weight === "hair");

    for (let index = TIMING.settleMarks + 1; index < faint.length; index += 1) {
      expect(faint[index] && faint[index - 1], `marks ${index} and ${index + 1}`).toBe(false);
    }
  });

  test("becomes legible long before it is finished", () => {
    const at = (count: number) => new Set(MARKS.slice(0, count).map((mark) => mark.id));

    // A closed rim by the fourth mark, both wheels by the eighth, a closed
    // frame by the fourteenth: there is something to recognise early.
    expect(at(4)).toEqual(new Set(["rear-rim-1", "rear-rim-2", "rear-rim-3", "rear-rim-4"]));
    expect([...at(8)].filter((id) => id.startsWith("front-rim"))).toHaveLength(4);
    for (const tube of ["down-tube", "seat-tube", "top-tube", "head-tube", "chain-stay", "seat-stay"]) {
      expect(at(14), tube).toContain(tube);
    }
  });

  test("does not reveal itself from one side to the other", () => {
    // A left-to-right or small-to-large reveal would let a visitor read
    // progress off the drawing, which is the one thing it must not be.
    const firstNumber = (mark: (typeof MARKS)[number]) =>
      Number(mark.d.match(/-?\d+(\.\d+)?/)![0]);
    const xs = MARKS.map(firstNumber);
    const ascending = xs.every((x, index) => index === 0 || x >= xs[index - 1]!);
    const descending = xs.every((x, index) => index === 0 || x <= xs[index - 1]!);

    expect(ascending).toBe(false);
    expect(descending).toBe(false);
  });
});
