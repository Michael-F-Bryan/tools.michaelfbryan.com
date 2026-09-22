"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Label } from "@/components/label";
import { Prose } from "@/components/prose";

import { MARKS, STROKE_WIDTHS, VIEW_BOX } from "./marks";
import { TIMING, TOTAL_MARKS, injectedDelayMs, shouldStartOver } from "./schedule";

/** After this many marks the hint has done its job and steps back. */
const HINT_MARKS = 4;
/**
 * Two contacts closer together than this are one clumsy press, not two. It
 * sits well under a comfortable tapping rate, so an ordinary deliberate press
 * is not swallowed.
 */
const REFRACTORY_MS = 110;
/**
 * How long the finished drawing is left alone before the way out appears. The
 * last mark deserves the room, and a control that arrived under the finger
 * would be activated by the release of the press that finished the drawing.
 */
const SETTLE_MS = 900;

const COARSE_POINTER = "(pointer: coarse)";

type PointerKind = "unknown" | "coarse" | "fine";

function subscribePointerKind(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readPointerKind(): PointerKind {
  if (typeof window.matchMedia !== "function") return "unknown";
  return window.matchMedia(COARSE_POINTER).matches ? "coarse" : "fine";
}

const HINTS: Record<PointerKind, string> = {
  // Named before the device is known, so the pre-hydration hint is true of both.
  unknown: "Tap or press Space to draw",
  coarse: "Tap here to draw",
  fine: "Press Space to draw",
};

export function Drawing() {
  const [drawn, setDrawn] = useState(0);
  const [startedOver, setStartedOver] = useState(false);
  const [settled, setSettled] = useState(false);
  const pointerKind = useSyncExternalStore(
    subscribePointerKind,
    readPointerKind,
    () => "unknown" as const,
  );

  // The press path deliberately reads and writes refs rather than state: a
  // press must leave no visual trace of its own. The mark is the only
  // consequence, and it arrives when the profile says it does.
  const drawnRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  // When the last press was accepted, for the refractory window.
  const lastPressRef = useRef<number | null>(null);
  // When the visitor was last plausibly at the drawing, for the idle window.
  // Coming back to the page counts; it must not also count as a press.
  const lastActivityRef = useRef<number | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);
  const surfaceHadFocusRef = useRef(false);
  const refocusRef = useRef(false);
  const surfaceRef = useRef<HTMLButtonElement | null>(null);
  const finishedRef = useRef<HTMLDivElement | null>(null);

  const finished = drawn === TOTAL_MARKS;

  const clearPending = useCallback(() => {
    if (pendingRef.current !== null) {
      window.clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
  }, []);

  const layMark = useCallback(() => {
    pendingRef.current = null;
    // The press surface may be about to go away. Whether it holds focus right
    // now decides whether focus has to be moved, and once it has gone there
    // is no way left to ask.
    surfaceHadFocusRef.current = document.activeElement === surfaceRef.current;
    drawnRef.current += 1;
    setDrawn(drawnRef.current);
  }, []);

  const startOver = useCallback(
    (announce: boolean) => {
      clearPending();
      drawnRef.current = 0;
      lastPressRef.current = null;
      lastActivityRef.current = null;
      setDrawn(0);
      setSettled(false);
      setStartedOver(announce);
    },
    [clearPending],
  );

  const press = useCallback(() => {
    // A press arriving while a mark is still owed is dropped rather than
    // queued. Queueing it would either reorder two marks across a change in
    // the injected delay or stretch the next press's delay to fit, and both
    // would blur the one thing a mark has to say: when it landed.
    if (pendingRef.current !== null) return;
    if (drawnRef.current >= TOTAL_MARKS) return;

    const now = performance.now();

    const lastPress = lastPressRef.current;
    if (lastPress !== null && now - lastPress < REFRACTORY_MS) return;

    const lastActivity = lastActivityRef.current;
    if (
      lastActivity !== null &&
      shouldStartOver(drawnRef.current, now - lastActivity, TIMING.idleLimitMs)
    ) {
      // The old run is set aside, but this press is not spent on undoing it:
      // it falls through and lays the first mark of the new one, so a visitor
      // who paused too long sees their press do something rather than only
      // take something away.
      startOver(true);
    } else {
      setStartedOver(false);
    }

    lastPressRef.current = now;
    lastActivityRef.current = now;

    const delay = injectedDelayMs(drawnRef.current);
    if (delay === 0) {
      // Nothing is scheduled and nothing is pre-rendered: the mark is laid in
      // the same task as the input event, so only the browser's own input and
      // display latency remains.
      layMark();
      return;
    }
    pendingRef.current = window.setTimeout(layMark, delay);
  }, [layMark, startOver]);

  useEffect(() => clearPending, [clearPending]);

  // Space is the primary action on a keyboard, whether or not the surface
  // itself holds focus, because the key travel is the motor event.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" && event.key !== " ") return;
      // Shift+Space is a page key of its own, and the rest are shortcuts.
      if (event.repeat || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const active = document.activeElement;
      if (
        active !== null &&
        active !== surfaceRef.current &&
        active.matches("a[href], button, input, select, textarea, [contenteditable]")
      ) {
        return;
      }

      // Space would otherwise scroll the page, and would activate the focused
      // surface a second time on release.
      event.preventDefault();

      // After thirty-three presses of Space a thirty-fourth is a reflex. It
      // lays no mark, and having swallowed it here it cannot scroll the
      // finished drawing out of view either.
      if (drawnRef.current >= TOTAL_MARKS) return;

      press();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [press]);

  // A run that was interrupted has lost its adaptation, so it starts over
  // rather than handing back a mark whose timing no longer means anything.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        hiddenSinceRef.current = performance.now();
        // A timer that fires while the page is hidden is throttled, so its
        // mark would land at a time the profile never chose. Drop the press.
        clearPending();
        return;
      }

      const hiddenSince = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      if (hiddenSince === null) return;

      const away = performance.now() - hiddenSince;
      if (
        drawnRef.current > 0 &&
        drawnRef.current < TOTAL_MARKS &&
        shouldStartOver(drawnRef.current, away, TIMING.awayLimitMs)
      ) {
        startOver(true);
        return;
      }

      // Time spent away is not time spent hesitating, so the idle gap is
      // measured from the moment the page came back. Coming back is not a
      // press, though, so it must not start a refractory window either.
      lastActivityRef.current = performance.now();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [clearPending, startOver]);

  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [finished]);

  // The surface that held the visitor's focus has just been replaced. Focus
  // moves to the finished panel rather than to the restart control, because a
  // reflex press must not be the thing that throws the drawing away.
  useEffect(() => {
    if (!settled || !surfaceHadFocusRef.current) return;
    finishedRef.current?.focus({ preventScroll: true });
  }, [settled]);

  // And back again on the way out, so restarting does not strand focus on the
  // document body with nothing to show for it.
  useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    surfaceRef.current?.focus({ preventScroll: true });
  }, [drawn]);

  return (
    // The panel hugs the drawing rather than filling the workspace width —
    // everything around the accumulating ink should be quiet — and shares the
    // left edge of the title above it rather than sitting on its own axis.
    <div className="w-full max-w-[44rem] border border-rule bg-surface">
      {/*
        A live region that is mounted from the start and empty until it has
        something to say. Announcing through a region that appears at the same
        moment as its text is unreliable, and the marks themselves are not
        announced at all: thirty-three interruptions would be no kindness.
      */}
      <p aria-live="polite" className="sr-only">
        {finished
          ? "The drawing is finished."
          : startedOver
            ? "Starting again on fresh paper."
            : ""}
      </p>

      <div className="relative px-4 py-5 sm:px-8 sm:py-8">
        <svg
          viewBox={VIEW_BOX}
          role="img"
          aria-label={
            finished
              ? "A finished ink drawing of a bicycle"
              : drawn === 0
                ? "Blank paper"
                : "An unfinished ink drawing"
          }
          // Sized by width alone, with the drawing's own 810:526 ratio folded
          // into the height cap, so the ink is never letterboxed inside a box
          // taller or wider than itself. At 54svh the whole panel still fits
          // the height of a landscape phone, which is the tightest case; the
          // rem caps bind first in portrait and on a desktop, so neither is
          // affected by it.
          className="mx-auto block h-auto w-[min(100%,40rem,calc(54svh*1.54))]"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
        >
          {MARKS.slice(0, drawn).map((mark) => (
            <path
              key={mark.id}
              d={mark.d}
              strokeWidth={STROKE_WIDTHS[mark.weight]}
              data-mark={mark.id}
            />
          ))}
        </svg>

        {startedOver ? (
          // Written on the fresh paper, so nothing around the press surface
          // moves, and so the first press clears it in the same frame as the
          // mark it lays. It sits along the foot of the sheet like a caption,
          // clear of the one mark that can be on the paper beside it.
          <p className="pointer-events-none absolute inset-0 flex items-end justify-center px-6 pb-1 text-center text-sm leading-6 text-muted">
            Starting again on fresh paper.
          </p>
        ) : null}
      </div>

      {/*
        The swap waits out the settling beat rather than arriving with the
        thirty-third mark. That mark is the one the whole drawing is for, and
        it should land with nothing else moving anywhere on the page. Until
        then the press surface stays where it is, inert: `press` lays no
        thirty-fourth mark, and the hint has long since faded out of it.
      */}
      {settled ? (
        <div
          ref={finishedRef}
          tabIndex={-1}
          className="flex min-h-[26svh] flex-col items-center justify-center gap-6 border-t border-rule bg-panel px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-accent sm:min-h-28 sm:px-8"
        >
          <p className="text-center leading-7 text-secondary">
            That&rsquo;s the drawing.
          </p>
          <button
            type="button"
            onClick={() => {
              refocusRef.current = true;
              startOver(false);
            }}
            className="border border-rule px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-label text-secondary hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Draw another
          </button>

          <Aside />
        </div>
      ) : (
        <button
          ref={surfaceRef}
          type="button"
          // The initial contact is the action; waiting for a release would put
          // the visitor's own lift-off inside the interval being manipulated.
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            press();
          }}
          // A mouse or a finger has already been served on `pointerdown`, and
          // both leave a click count behind. A click without one came from a
          // keyboard's Enter or from assistive technology, neither of which
          // sends a pointer sequence at all, so that is the click to act on.
          onClick={(event) => {
            if (event.detail !== 0) return;
            press();
          }}
          className="flex min-h-[26svh] w-full cursor-pointer select-none items-center justify-center border-t border-rule bg-panel px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] font-mono text-xs font-bold uppercase tracking-label text-muted [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-accent sm:min-h-28"
        >
          {/*
            The hint fades out rather than dimming. A dimmed instruction is
            still text, and at any opacity low enough to be unobtrusive it
            fails to meet the contrast the rest of the site holds to. Gone, it
            leaves the surface silent for the marks that matter — and, being
            only transparent, it is still the button's accessible name.
            Starting over brings it back at full strength.
          */}
          <span
            className={`transition-opacity duration-700 motion-reduce:transition-none ${drawn >= HINT_MARKS ? "opacity-0" : ""}`}
          >
            {HINTS[pointerKind]}
          </span>
        </button>
      )}

    </div>
  );
}

/**
 * The only explanation on the page, and it exists only once the drawing is
 * finished: closed, secondary, and impossible to read before the thing it
 * would spoil has already happened.
 */
function Aside() {
  return (
    <details className="group w-full max-w-measure border-t border-rule-subtle pt-5 text-left">
      {/*
        Shaped like the site's other disclosures (see `DISCLOSURE_SUMMARY` in
        the coordinate-frame visualiser): a comfortable tap height, and a flex
        box, which suppresses the native marker. Interactivity is carried by
        the question itself and by the hover colour.
      */}
      <summary className="flex min-h-11 cursor-pointer items-center py-2 focus-visible:outline-2 focus-visible:outline-accent">
        <Label tone="muted" className="group-hover:text-accent">
          What was that?
        </Label>
      </summary>

      <Prose size="base" className="mb-2 text-muted">
        <p>
          The gap between your press and the mark was not constant. It grew by a
          few milliseconds per mark, held at 180&nbsp;ms for a while, and then,
          three marks from the end, went away.
        </p>
        <p>
          The effect it borrows is motor-sensory temporal recalibration, from{" "}
          <a
            href="https://www.sciencedirect.com/science/article/pii/S0896627306006271"
            className="text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            Stetson, Cui, Montague and Eagleman (2006)
          </a>
          . They injected a fixed delay for about a hundred trials; afterwards,
          unexpectedly short delays were reported as having happened{" "}
          <em>before</em> the keypress. Introducing the delay gradually is a
          liberty taken here to keep it hidden, and twenty-four delayed marks is
          well short of their adaptation, so this is a drawing inspired by the
          research rather than a replication of it. Nothing was measured, timed
          or recorded: every press stayed in your browser.
        </p>
      </Prose>
    </details>
  );
}
