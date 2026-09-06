import { cn } from "@/lib/utils";

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
  const focusedStage = Math.ceil(progress) as 0 | 1 | 2 | 3;
  const anglesByStage = [angles.first, angles.second, angles.third];

  return (
    <div className="border-t border-rule px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Sequence</span>
        <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm text-secondary">
          Order
          <select
            aria-label="Rotation order"
            value={order}
            onChange={(event) => onOrderChange(event.target.value as TaitBryanOrder)}
            className="min-w-0 max-w-full border border-rule bg-surface px-2 py-1 font-mono text-sm"
          >
            {ALL_ORDERS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {orderDisplayName(candidate)}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-flex border border-rule" role="group" aria-label="Interpretation">
          {(["intrinsic", "extrinsic"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={interpretation === candidate}
              onClick={() => onInterpretationChange(candidate)}
              className={cn(
                "px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-accent",
                interpretation === candidate ? "bg-accent text-paper" : "text-secondary",
              )}
            >
              {candidate}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">Changing either keeps the three numbers and moves the block.</p>

      <ol className="mt-4 border-t border-rule-subtle" aria-label="Rotation sequence">
        <li className="flex gap-3 border-b border-rule-subtle py-2 text-sm">
          <span className="font-mono text-xs font-bold text-muted">00</span>
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
              className={cn(
                "flex flex-col gap-1 border-b border-rule-subtle py-2 text-sm",
                isCurrent && "bg-accent/10",
              )}
            >
              <span className="flex gap-3">
                <span className={cn("font-mono text-xs font-bold", isCurrent ? "text-accent" : "text-muted")}>
                  0{stageIndex}
                </span>
                <span>
                  <strong>{human ? `${human} ${angleValue.toFixed(1)}°` : `rotate ${angleValue.toFixed(1)}°`}</strong>{" "}
                  <span className="text-muted">· about {axisLabel}</span>
                </span>
              </span>
              {isCurrent ? (
                <span className="ml-6 max-w-[38rem] text-sm text-secondary">
                  The cobalt pin in the scene is {axisLabel}. Switch intrinsic/extrinsic and this same angle applies
                  about a different axis; the pin jumps, the numbers stay, the block lands somewhere else.
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-4">
        <label className="block font-mono text-xs font-bold uppercase tracking-label text-muted" htmlFor="cfv-scrub">
          Scrub the sequence
        </label>
        <input
          id="cfv-scrub"
          type="range"
          min={0}
          max={3}
          step={0.01}
          value={progress}
          onChange={(event) => onProgressChange(Number(event.target.value))}
          className="mt-2 w-full accent-accent focus-visible:outline-2 focus-visible:outline-accent"
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
    </div>
  );
}
