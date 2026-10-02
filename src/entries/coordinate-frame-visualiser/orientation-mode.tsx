import { cn } from "@/lib/utils";

import { AngleControls } from "./angle-controls";
import { LINK_BUTTON } from "./controls";
import { OrientationInspector } from "./orientation-inspector";
import { OrientationScene, type ScenePin } from "./orientation-scene";
import type { Camera } from "./projection";
import type { PoseState } from "./pose";
import { activeOrigin, activeProbe, activeRotation, displayedRotation } from "./pose";
import { rotationToEuler, stageAxis, type EulerAngles, type LocalConvention, type Quaternion } from "./math";
import { focusedStageFor, SequenceStrip } from "./sequence-strip";

export type OrientationModeProps = Readonly<{
  state: PoseState;
  /** Scrub position through the sequence, 0 (start) to 3 (finished). */
  progress: number;
  onProgressChange: (progress: number) => void;
  showProbe: boolean;
  onShowProbeChange: (show: boolean) => void;
  camera: Camera;
  onCameraChange: (camera: Camera) => void;
  onConventionChange: (convention: LocalConvention) => void;
  onAngleEdit: (field: keyof EulerAngles, value: number) => void;
  onOrderChange: (order: PoseState["order"]) => void;
  onInterpretationChange: (interpretation: PoseState["interpretation"]) => void;
  onQuaternionCommit: (q: Quaternion) => void;
  onProbeEdit: (field: 0 | 1 | 2, value: number) => void;
  onOriginEdit: (field: 0 | 1 | 2, value: number) => void;
}>;

export const ORIENTATION_VIEW: Camera = { azimuthDeg: -35, elevationDeg: 26, scale: 55 };

const VIEW_PRESETS = {
  above: { azimuthDeg: 0, elevationDeg: 89, scale: 55 },
  behind: { azimuthDeg: 200, elevationDeg: 12, scale: 55 },
  reset: ORIENTATION_VIEW,
} as const satisfies Record<string, Camera>;

/** Whether the second angle sits at ±90°, where the first and third stages share an axis. */
export function isGimbalLocked(state: PoseState): boolean {
  const decomposition = rotationToEuler(activeRotation(state), state.order, state.interpretation);
  return decomposition.gimbalLock || Math.abs(Math.abs(state.angles.second) - 90) < 1e-6;
}

function LegendSwatch({ kind }: Readonly<{ kind: "local" | "body" | "final" }>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 8" className="inline-block h-2 w-6">
      <line
        x1={1}
        y1={4}
        x2={23}
        y2={4}
        className={kind === "local" ? "stroke-ink" : kind === "body" ? "stroke-accent" : "stroke-rule"}
        strokeWidth={kind === "body" ? 2.5 : 1.25}
        strokeDasharray={kind === "final" ? "3 2" : undefined}
      />
    </svg>
  );
}

export function OrientationMode({
  state,
  progress,
  onProgressChange,
  showProbe,
  onShowProbeChange,
  camera,
  onCameraChange,
  onConventionChange,
  onAngleEdit,
  onOrderChange,
  onInterpretationChange,
  onQuaternionCommit,
  onProbeEdit,
  onOriginEdit,
}: OrientationModeProps) {
  const finalRotation = activeRotation(state);
  const rotation = displayedRotation(state, progress);
  const origin = activeOrigin(state);
  const probe = activeProbe(state);
  const focusedStage = focusedStageFor(progress);
  const gimbalLocked = isGimbalLocked(state);
  const scrubbed = progress < 3;


  // At gimbal lock the two coincident axes are the lesson, so they stay
  // pinned whatever the scrub position. Otherwise pin the stage in progress;
  // at the start and at the end no stage is in progress, so nothing is pinned.
  const pins: readonly ScenePin[] = gimbalLocked
    ? ([1, 3] as const).map((stage) => ({ axis: stageAxis(state.angles, state.order, state.interpretation, stage), stage }))
    : scrubbed && focusedStage !== 0
      ? [{ axis: stageAxis(state.angles, state.order, state.interpretation, focusedStage), stage: focusedStage }]
      : [];

  return (
    <section aria-label="Orientation" data-mode-section className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
      <div className="min-w-0 border-b border-rule lg:border-b-0 lg:border-r">
        <div className="sticky top-0 z-10 border-b border-rule-subtle bg-surface px-4 pb-3 pt-3 sm:px-6" data-scene-stage>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Scene · local → body</span>
            <span className="font-mono text-xs text-muted" data-displayed-stage={focusedStage}>
              {scrubbed ? `showing: ${focusedStage === 0 ? "start" : `after stage ${focusedStage}`}` : "showing: full rotation"}
            </span>
          </div>
          <OrientationScene
            convention={state.convention}
            rotation={rotation}
            finalRotation={finalRotation}
            showFinalGhost={scrubbed}
            origin={origin}
            probe={probe}
            showProbe={showProbe}
            pins={pins}
            pinsCollinear={gimbalLocked}
            camera={camera}
            onCameraChange={onCameraChange}
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-xs text-muted">
            <span className="flex flex-wrap items-center gap-x-3">
              <span className="flex items-center gap-1">
                <LegendSwatch kind="local" /> local {state.convention.toUpperCase()}
              </span>
              <span className="flex items-center gap-1">
                <LegendSwatch kind="body" /> body
              </span>
              {scrubbed ? (
                <span className="flex items-center gap-1">
                  <LegendSwatch kind="final" /> final pose
                </span>
              ) : null}
              <label className={cn("inline-flex min-h-11 items-center gap-1.5 sm:min-h-0", showProbe && "text-ink")}>
                <input
                  type="checkbox"
                  checked={showProbe}
                  onChange={(event) => onShowProbeChange(event.target.checked)}
                  className="size-4 accent-accent"
                />
                show point P
              </label>
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-sm">
              <span>View</span>
              <button type="button" className={LINK_BUTTON} onClick={() => onCameraChange(VIEW_PRESETS.above)}>
                above
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" className={LINK_BUTTON} onClick={() => onCameraChange(VIEW_PRESETS.behind)}>
                behind
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" className={LINK_BUTTON} onClick={() => onCameraChange(VIEW_PRESETS.reset)}>
                reset
              </button>
            </span>
          </div>
        </div>
        <AngleControls state={state} gimbalLocked={gimbalLocked} onAngleEdit={onAngleEdit} />
        <SequenceStrip
          order={state.order}
          interpretation={state.interpretation}
          convention={state.convention}
          angles={state.angles}
          progress={progress}
          onOrderChange={onOrderChange}
          onInterpretationChange={onInterpretationChange}
          onProgressChange={onProgressChange}
        />
      </div>
      <OrientationInspector
        state={state}
        rotation={rotation}
        focusedStage={focusedStage}
        showProbe={showProbe}
        onShowProbeChange={onShowProbeChange}
        onConventionChange={onConventionChange}
        onQuaternionCommit={onQuaternionCommit}
        onProbeEdit={onProbeEdit}
        onOriginEdit={onOriginEdit}
      />
    </section>
  );
}
