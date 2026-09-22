/**
 * The timing profile for the experience.
 *
 * Everything about *when* a mark lands lives here, so the profile can be
 * retuned without touching the interaction, and so it can be tested without
 * a browser.
 *
 * The shape is taken from motor-sensory temporal recalibration: Stetson, Cui,
 * Montague and Eagleman, "Motor-Sensory Recalibration Leads to an Illusory
 * Reversal of Action and Sensation", Neuron 51(5), 2006. In the laboratory
 * paradigm a fixed delay is injected between a keypress and a flash for around
 * a hundred trials; afterwards, unexpectedly short delays are reported as
 * having happened *before* the press. Later work in the same lab described the
 * same effect with a ~150 ms delay injected into a video game.
 *
 * Two things here are deliberate departures from the research, not
 * replications of it:
 *
 *   - the delay is introduced gradually rather than fixed from the first
 *     press, so the manipulation stays hidden;
 *   - the adaptation is 24 delayed marks rather than ~100 trials, because a
 *     visitor has to be willing to finish the drawing.
 *
 * `holdDelayMs` is 180 ms: comfortably above the browser's own input and
 * display latency (roughly 16-50 ms, which the profile cannot control and does
 * not try to), and close to the delay the original authors used in their
 * game-based demonstration.
 */

export const TIMING = {
  /** Marks with no injected delay at all, so the interaction is learnt honestly. */
  settleMarks: 6,
  /** Marks over which the injected delay climbs to `holdDelayMs`. */
  driftMarks: 10,
  /** Marks held at the full injected delay, for adaptation. */
  holdMarks: 14,
  /** Marks after the injected delay is removed again. */
  releaseMarks: 3,
  /** The injected delay at the top of the drift, in milliseconds. */
  holdDelayMs: 180,
  /**
   * How long a gap between marks may be before the run is treated as
   * abandoned rather than merely paused.
   *
   * Generous on purpose. Recalibration aftereffects are stored rather than
   * rapidly lost when nothing contradicts them, so a visitor admiring the
   * bicycle for a few seconds has not gone stale — and starting over costs
   * them every mark they have laid. The limit is here for the visitor who
   * wandered off, not the one who paused.
   */
  idleLimitMs: 30_000,
  /**
   * The same judgement for a page that was hidden and came back. Stricter,
   * because being away from the page is a real change of context rather than
   * a pause in front of it, but still long enough to survive a notification,
   * a glance at another tab, or a short app switch.
   */
  awayLimitMs: 15_000,
} as const;

export type Phase = "settle" | "drift" | "hold" | "release";

const DRIFT_START = TIMING.settleMarks;
const HOLD_START = DRIFT_START + TIMING.driftMarks;
const RELEASE_START = HOLD_START + TIMING.holdMarks;

/** How many marks the drawing takes, and therefore how many presses. */
export const TOTAL_MARKS = RELEASE_START + TIMING.releaseMarks;

/** How much the injected delay grows with each drift mark. */
export const DRIFT_STEP_MS = TIMING.holdDelayMs / TIMING.driftMarks;

/**
 * Which part of the profile a press belongs to. `markIndex` is zero-based:
 * press 0 lays the first mark.
 */
export function phaseAt(markIndex: number): Phase {
  if (markIndex < DRIFT_START) return "settle";
  if (markIndex < HOLD_START) return "drift";
  if (markIndex < RELEASE_START) return "hold";
  return "release";
}

/**
 * The delay deliberately inserted between a press and its mark, in
 * milliseconds. Zero means the mark is laid in the same task as the input
 * event; the browser's own latency is whatever it is.
 */
export function injectedDelayMs(markIndex: number): number {
  switch (phaseAt(markIndex)) {
    case "settle":
    case "release":
      return 0;
    case "drift":
      return DRIFT_STEP_MS * (markIndex - DRIFT_START + 1);
    case "hold":
      return TIMING.holdDelayMs;
  }
}

/**
 * Whether a run interrupted for `gapMs` should be abandoned and started over.
 *
 * Only runs that have already been exposed to an injected delay can go stale:
 * before that there is no adaptation to lose, so a pause is harmless.
 */
export function shouldStartOver(
  markIndex: number,
  gapMs: number,
  limitMs: number,
): boolean {
  return markIndex > TIMING.settleMarks && gapMs > limitMs;
}
