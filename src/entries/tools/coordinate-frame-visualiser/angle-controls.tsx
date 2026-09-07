import { RANGE_INPUT, TEXT_FIELD } from "./controls";
import { parseUserNumber } from "./format";
import type { EulerAngles } from "./math";
import type { PoseState } from "./pose";
import { stageAxisLabel, stageHumanName } from "./sequence";
import { useSyncedDraft } from "./use-synced-draft";

type AngleControlsProps = Readonly<{
  state: PoseState;
  gimbalLocked: boolean;
  onAngleEdit: (field: keyof EulerAngles, value: number) => void;
}>;

function AngleRow({
  fieldName,
  displayLabel,
  axisHint,
  value,
  onCommit,
  min = -180,
  max = 180,
}: Readonly<{
  /** Stable stage identity ("first"/"second"/"third") used for the aria-labels, independent of the order. */
  fieldName: string;
  /** The visible name of this stage's angle, e.g. "yaw" or "angle 1". */
  displayLabel: string;
  /** The visible description of the axis this stage turns about, e.g. "about z" or "about y′". */
  axisHint: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
}>) {
  const [draft, setDraft, resetDraft] = useSyncedDraft(value.toFixed(1));

  function commit() {
    const parsed = parseUserNumber(draft);
    if (parsed === null) {
      resetDraft();
      return;
    }
    onCommit(parsed);
  }

  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-x-2">
      <span className="col-span-3 flex items-baseline justify-between text-sm text-secondary">
        <span>
          {displayLabel} <small className="font-mono text-xs text-muted">{axisHint}</small>
        </span>
        <span className="font-mono text-xs text-muted">{((value * Math.PI) / 180).toFixed(4)} rad</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        aria-label={`${fieldName} angle, slider`}
        onChange={(event) => onCommit(Number(event.target.value))}
        className={RANGE_INPUT}
      />
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        aria-label={`${fieldName} angle, degrees`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className={`${TEXT_FIELD} w-full`}
      />
      <span className="font-mono text-xs text-muted">°</span>
    </div>
  );
}

/** The three angle sliders: the primary way to turn the body. */
export function AngleControls({ state, gimbalLocked, onAngleEdit }: AngleControlsProps) {
  const fieldNames = ["first", "second", "third"] as const;
  const stages = [1, 2, 3] as const;

  return (
    <div role="group" aria-label="Angles" className="border-t border-rule px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Angles</span>
        <span className="font-mono text-xs text-muted">
          {state.convention.toUpperCase()} · {state.order} · {state.interpretation}
        </span>
      </div>
      {stages.map((stageIndex, i) => (
        <AngleRow
          key={fieldNames[i]}
          fieldName={fieldNames[i]}
          displayLabel={stageHumanName(state.order, stageIndex) ?? `angle ${stageIndex}`}
          axisHint={`about ${stageAxisLabel(state.order, state.interpretation, state.convention, stageIndex)}`}
          value={state.angles[fieldNames[i]]}
          onCommit={(v) => onAngleEdit(fieldNames[i], v)}
          min={stageIndex === 2 ? -90 : -180}
          max={stageIndex === 2 ? 90 : 180}
        />
      ))}
      {gimbalLocked ? (
        <p role="status" className="mt-3 max-w-[38rem] text-sm text-secondary">
          Gimbal lock: the second angle is at ±90°, so the first and third angles are no longer separately
          determined — only their sum or difference is observable. Axis 1 and axis 3 are collinear, so the scene
          draws both pins on the same line.
        </p>
      ) : null}
    </div>
  );
}
