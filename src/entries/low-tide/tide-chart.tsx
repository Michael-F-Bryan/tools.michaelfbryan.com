import { isDark, BAND_NAMES, type Band } from "./model";
import styles from "./tide-chart.module.css";

type Props = {
  /** Low-water depth per tide: how many bands are exposed. */
  tides: readonly number[];
  /** 0-based index of the tide being played (or, after the run, the tide it ended on). */
  current: number;
  /** Things that happened on each tide (0-based index → short labels), drawn as dots under the bar. */
  marks?: Readonly<Record<number, readonly string[]>>;
  /** Accessible name of the chart. */
  label?: string;
};

function reaches(depth: number): string {
  return depth <= 0 ? "nothing" : `the ${BAND_NAMES[(depth - 1) as Band].toLowerCase()}`;
}

/**
 * The whole run as a strip of bars, one per tide: how far the water will fall
 * (bar height, one step per exposed band), which tides are dark, which one is
 * now, which are behind you, and optionally what you built when. Pure render;
 * the game owns the state.
 */
export function TideChart({ tides, current, marks, label = "Tide chart" }: Props) {
  return (
    <ol className={styles.chart} aria-label={label}>
      {tides.map((depth, index) => {
        const dark = isDark(index);
        const state = index < current ? "past" : index === current ? "now" : "ahead";
        const events = marks?.[index] ?? [];
        return (
          <li key={index} className={styles.tide} data-state={state} data-dark={dark || undefined} aria-current={state === "now" ? "step" : undefined}>
            <span className={styles.bars} aria-hidden="true">
              {[1, 2, 3, 4].map(level => <i key={level} data-on={level <= depth || undefined} />)}
            </span>
            <span className={styles.number} aria-hidden="true">{index + 1}</span>
            {marks ? (
              <span className={styles.marks} aria-hidden="true">
                {events.slice(0, 3).map((event, i) => <i key={i} title={event} />)}
              </span>
            ) : null}
            <span className="sr-only">
              {`Tide ${index + 1}${state === "now" ? ", now" : state === "past" ? ", past" : ""}: water out to ${reaches(depth)}${dark ? ", in the dark" : ""}.${events.length ? ` Built ${events.join(", ")}.` : ""}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
