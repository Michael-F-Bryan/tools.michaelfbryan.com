"use client";

import { useState } from "react";

import { ChainRail, type Mode } from "./chain-rail";
import type { EulerAngles, Geodetic, LocalConvention, Quaternion } from "./math";
import { ORIENTATION_VIEW, OrientationMode } from "./orientation-mode";
import { ANCHOR_VIEW, PositionMode } from "./position-mode";
import type { Camera } from "./projection";
import {
  displayedRNedBody,
  initialPoseState,
  withAngleEdit,
  withConvention,
  withInterpretation,
  withOrder,
  withOriginEdit,
  withProbeEdit,
  withQuaternion,
} from "./pose";

const OPENING_ANCHOR: Geodetic = { latitudeDeg: -31.9523, longitudeDeg: 115.8613, heightM: 24 };

export function Visualiser() {
  const [mode, setMode] = useState<Mode>("orientation");
  const [pose, setPose] = useState(initialPoseState);
  // The sequence scrubber opens at the end, so the body starts in its full pose.
  const [progress, setProgress] = useState(3);
  const [showProbe, setShowProbe] = useState(false);
  const [anchor, setAnchor] = useState<Geodetic>(OPENING_ANCHOR);
  const [orientationCamera, setOrientationCamera] = useState<Camera>(ORIENTATION_VIEW);
  const [positionCamera, setPositionCamera] = useState<Camera>(ANCHOR_VIEW);

  function handleConventionChange(convention: LocalConvention) {
    setPose((prev) => withConvention(prev, convention));
  }

  function handleQuaternionCommit(q: Quaternion) {
    // A quaternion describes the whole rotation, so committing one lands
    // the body at the end of the sequence rather than at a partial stage.
    setPose((prev) => withQuaternion(prev, q));
    setProgress(3);
  }

  return (
    // `contain: inline-size` isolates this workspace from the shared entry-page
    // grid's intrinsic-width calculation: without it, a single wide, unwrapped
    // row anywhere inside makes the page's outer grid track grow to fit it
    // instead of letting the row's own horizontal scroll affordance handle
    // the overflow.
    <div className="border border-rule bg-surface [contain:inline-size]">
      <ChainRail
        mode={mode}
        onModeChange={setMode}
        convention={pose.convention}
        anchor={anchor}
        rNedBody={displayedRNedBody(pose, progress)}
        originNed={pose.originNed}
      />
      {mode === "orientation" ? (
        <OrientationMode
          state={pose}
          progress={progress}
          onProgressChange={setProgress}
          showProbe={showProbe}
          onShowProbeChange={setShowProbe}
          camera={orientationCamera}
          onCameraChange={setOrientationCamera}
          onConventionChange={handleConventionChange}
          onAngleEdit={(field: keyof EulerAngles, value: number) => setPose((prev) => withAngleEdit(prev, field, value))}
          onOrderChange={(order) => setPose((prev) => withOrder(prev, order))}
          onInterpretationChange={(interpretation) => setPose((prev) => withInterpretation(prev, interpretation))}
          onQuaternionCommit={handleQuaternionCommit}
          onProbeEdit={(field, value) => setPose((prev) => withProbeEdit(prev, field, value))}
          onOriginEdit={(field, value) => setPose((prev) => withOriginEdit(prev, field, value))}
        />
      ) : (
        <PositionMode
          anchor={anchor}
          convention={pose.convention}
          camera={positionCamera}
          onCameraChange={setPositionCamera}
          onConventionChange={handleConventionChange}
          onAnchorCommit={setAnchor}
        />
      )}
    </div>
  );
}
