/**
 * Class strings for the ordinary native controls this entry uses in several
 * places. They are deliberately local to the entry (not shared components):
 * the jobs are plain buttons, sliders and text fields styled with site
 * tokens, and the only thing worth centralising is the touch-target sizing,
 * which is roughly 44 px on narrow screens and compact from `sm` up.
 */

/** One button of a segmented toggle group (`aria-pressed`). Pair with {@link segmentTone}. */
export const SEGMENT_BUTTON =
  "min-h-11 px-3 text-sm sm:min-h-0 sm:py-1 focus-visible:outline-2 focus-visible:outline-accent";

export function segmentTone(active: boolean): string {
  return active ? "bg-accent text-paper" : "text-secondary hover:text-ink";
}

/** An inline text-link style button (view presets, invert, copy). */
export const LINK_BUTTON =
  "inline-flex min-h-11 items-center px-1 text-secondary underline underline-offset-4 hover:text-accent sm:min-h-0 sm:px-0 focus-visible:outline-2 focus-visible:outline-accent";

/** A single-line numeric text field. */
export const TEXT_FIELD =
  "min-h-11 border border-rule bg-surface px-2 text-right font-mono text-sm tabular-nums sm:min-h-0 sm:py-1 focus-visible:outline-2 focus-visible:outline-accent";

/** A read-only numeric field, visually quieter than {@link TEXT_FIELD}. */
export const READONLY_FIELD =
  "min-h-11 border border-rule-subtle bg-panel px-2 text-right font-mono text-sm tabular-nums text-secondary sm:min-h-0 sm:py-1";

/** A range slider. The extra height on narrow screens is hit area, not track. */
export const RANGE_INPUT =
  "h-11 w-full accent-accent sm:h-auto focus-visible:outline-2 focus-visible:outline-accent";

/** A `<summary>` for the reference disclosures: kicker plus a muted phrase, comfortable to tap. */
export const DISCLOSURE_SUMMARY =
  "flex min-h-11 cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 py-2 marker:text-muted focus-visible:outline-2 focus-visible:outline-accent";
