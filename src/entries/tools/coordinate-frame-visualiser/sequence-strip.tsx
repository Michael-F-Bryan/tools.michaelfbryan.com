import { cn } from "@/lib/utils";

import { RANGE_INPUT, SEGMENT_BUTTON, segmentTone } from "./controls";
import type { EulerAngles, EulerInterpretation, LocalConvention, TaitBryanOrder } from "./math";
import { ALL_ORDERS, orderDisplayName, stageAxisLabel, stageHumanName } from "./sequence";

type SequenceStripProps = Readonly<{
  order: TaitBryanOrder;
  interpretation: EulerInterpretation;
  convention: LocalConvention;
  angles: EulerAngles;
  progress: number;
  onOrderChange: (order: TaitBryanOrder) => void;
  onInterpretationChange: (interpretation: EulerInterpretation) => void;
  onProgressChange: (progress: number) => void;
}>;

const STAGE_TICKS = ["start", "after 1", "after 2", "after 3"] as const;

/** The stage the scrub position is in or has just finished: 0 at the start, 3 at the end. */
export function focusedStageFor(progress: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.ceil(progress))) as 0 | 1 | 2 | 3;
}

export function SequenceStrip({
  order,
  interpretation,
  convention,
  angles,
  progress,
  onOrderChange,
  onInterpretationChange,
  onProgressChange,
}: SequenceStripProps) {
  const focusedStage = focusedStageFor(progress);
  const anglesByStage = [angles.first, angles.second, angles.third];

  return (
    <div className="border-t border-rule px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Sequence</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm text-secondary">
            Order
            <select
              aria-label="Rotation order"
              value={order}
              onChange={(event) => onOrderChange(event.target.value as TaitBryanOrder)}
              className="min-h-11 min-w-0 max-w-full border border-rule bg-surface px-2 font-mono text-sm sm:min-h-0 sm:py-1"
            >
              {ALL_ORDERS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {orderDisplayName(candidate)}
                </option>
              ))}
            </select>
          </label>
          <span className="inline-flex border border-rule" role="group" aria-label="Interpretation">
            {(["intrinsic", "extrinsic"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={interpretation === candidate}
                onClick={() => onInterpretationChange(candidate)}
                className={cn(SEGMENT_BUTTON, segmentTone(interpretation === candidate))}
              >
                {candidate}
              </button>
            ))}
          </span>
        </span>
      </div>

      <div className="mt-4">
        <label className="flex items-baseline justify-between gap-2" htmlFor="cfv-scrub">
          <span className="font-mono text-xs font-bold uppercase tracking-label text-muted">Scrub the sequence</span>
          <span className="font-mono text-xs text-muted">the body follows the slider</span>
        </label>
        <input
          id="cfv-scrub"
          type="range"
          min={0}
          max={3}
          step={0.01}
          value={progress}
          onChange={(event) => onProgressChange(Number(event.target.value))}
          className={cn(RANGE_INPUT, "mt-1")}
        />
        <div className="mt-1 grid grid-cols-4 font-mono text-xs text-muted">
          {STAGE_TICKS.map((tick, index) => (
            <span
              key={tick}
              className={cn(
                index > 0 && "text-center",
                index === STAGE_TICKS.length - 1 && "text-right",
                focusedStage === index && "font-bold text-accent",
              )}
            >
              {tick}
            </span>
          ))}
        </div>
      </div>

      <ol className="mt-4 border-t border-rule-subtle" aria-label="Rotation sequence">
        <li
          aria-current={focusedStage === 0 ? "step" : undefined}
          className={cn("flex gap-3 border-b border-rule-subtle px-1 py-2 text-sm", focusedStage === 0 && "bg-accent/10")}
        >
          <span className={cn("font-mono text-xs font-bold", focusedStage === 0 ? "text-accent" : "text-muted")}>00</span>
          <span>
            <strong>start</strong> <span className="text-muted">· body axes coincide with the local frame</span>
          </span>
        </li>
        {([1, 2, 3] as const).map((stageIndex) => {
          const isCurrent = focusedStage === stageIndex;
          const human = stageHumanName(order, stageIndex);
          const axisLabel = stageAxisLabel(order, interpretation, convention, stageIndex);
          const angleValue = anglesByStage[stageIndex - 1];
          return (
            <li
              key={stageIndex}
              aria-current={isCurrent ? "step" : undefined}
              className={cn("flex gap-3 border-b border-rule-subtle px-1 py-2 text-sm", isCurrent && "bg-accent/10")}
            >
              <span className={cn("font-mono text-xs font-bold", isCurrent ? "text-accent" : "text-muted")}>
                0{stageIndex}
              </span>
              <span>
                <strong>{human ? `${human} ${angleValue.toFixed(1)}°` : `rotate ${angleValue.toFixed(1)}°`}</strong>{" "}
                <span className="text-muted">· about {axisLabel}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
