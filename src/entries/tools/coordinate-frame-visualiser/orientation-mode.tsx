import { useState } from "react";

import { OrientationInspector } from "./orientation-inspector";
import { OrientationScene } from "./orientation-scene";
import type { Camera } from "./projection";
import type { PoseState } from "./pose";
import { activeOrigin, activeProbe, activeRotation } from "./pose";
import {
  rotationAfterStages,
  rotationToEuler,
  stageAxis,
  type EulerAngles,
  type LocalConvention,
  type Quaternion,
} from "./math";
import { SequenceStrip } from "./sequence-strip";
import { stageAxisLabel } from "./sequence";

export type OrientationModeProps = Readonly<{
  state: PoseState;
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

const VIEW_PRESETS: Record<string, Camera> = {
  above: { azimuthDeg: 0, elevationDeg: 89, scale: 55 },
  behind: { azimuthDeg: 200, elevationDeg: 12, scale: 55 },
  reset: { azimuthDeg: -35, elevationDeg: 26, scale: 55 },
};

export function OrientationMode({
  state,
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
  const [progress, setProgress] = useState(2);

  const rotation = activeRotation(state);
  const origin = activeOrigin(state);
  const probe = activeProbe(state);
  const ghost = rotationAfterStages(state.angles, state.order, state.interpretation, progress);

  const focusedStage = Math.ceil(progress) as 0 | 1 | 2 | 3;
  const decomposition = rotationToEuler(rotation, state.order, state.interpretation);
  const gimbalLocked = decomposition.gimbalLock || Math.abs(Math.abs(state.angles.second) - 90) < 1e-6;

  const pinAxes =
    focusedStage === 0
      ? []
      : gimbalLocked
        ? ([1, 3] as const).map((stage) => stageAxis(state.angles, state.order, state.interpretation, stage))
        : [stageAxis(state.angles, state.order, state.interpretation, focusedStage)];

  const pinLabel =
    focusedStage === 0
      ? ""
      : gimbalLocked
        ? `stage 1 (${stageAxisLabel(state.order, state.interpretation, state.convention, 1)}) and stage 3 (${stageAxisLabel(state.order, state.interpretation, state.convention, 3)}) are collinear`
        : `about ${stageAxisLabel(state.order, state.interpretation, state.convention, focusedStage)}`;

  return (
    <section aria-label="Orientation" data-mode-section className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
      <div className="min-w-0 border-b border-rule lg:border-b-0 lg:border-r">
        <div className="px-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Scene · local → body</span>
            <span className="font-mono text-xs text-muted">
              {state.convention.toUpperCase()} · {state.order} · {state.interpretation}
            </span>
          </div>
          <figure className="mt-3">
            <OrientationScene
              convention={state.convention}
              rotation={rotation}
              origin={origin}
              probe={probe}
              ghostRotation={ghost}
              showGhost={progress > 0}
              pinAxes={pinAxes}
              pinLabel={pinLabel}
              camera={camera}
              onCameraChange={onCameraChange}
            />
            <figcaption className="mt-3 max-w-[38rem] text-sm leading-6 text-muted">
              The wedge is the body: its nose is body x, the dot marks the right side. The grid is the tangent plane
              at the anchor. The dashed outline is the ghost at the scrub position; the cobalt pin is the axis the
              focused stage turns about. Ink is the local frame; cobalt is the body and whatever is being edited.
            </figcaption>
          </figure>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>View</span>
            <button type="button" className="text-secondary underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onCameraChange(VIEW_PRESETS.above)}>
              from above
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="text-secondary underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onCameraChange(VIEW_PRESETS.behind)}>
              behind the body
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="text-secondary underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onCameraChange(VIEW_PRESETS.reset)}>
              reset view
            </button>
            <span className="basis-full text-xs sm:basis-auto">Dragging the scene orbits the camera only. The body turns through the controls.</span>
          </div>
        </div>
        <SequenceStrip
          order={state.order}
          interpretation={state.interpretation}
          convention={state.convention}
          angles={state.angles}
          progress={progress}
          onOrderChange={onOrderChange}
          onInterpretationChange={onInterpretationChange}
          onProgressChange={setProgress}
        />
      </div>
      <OrientationInspector
        state={state}
        onConventionChange={onConventionChange}
        onAngleEdit={onAngleEdit}
        onQuaternionCommit={onQuaternionCommit}
        onProbeEdit={onProbeEdit}
        onOriginEdit={onOriginEdit}
      />
    </section>
  );
}
