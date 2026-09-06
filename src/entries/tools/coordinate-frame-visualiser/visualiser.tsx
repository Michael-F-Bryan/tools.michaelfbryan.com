"use client";

import { useState } from "react";

import { ChainRail, type Mode } from "./chain-rail";
import type { EulerAngles, Geodetic, LocalConvention, Quaternion } from "./math";
import { OrientationMode } from "./orientation-mode";
import { PositionMode } from "./position-mode";
import type { Camera } from "./projection";
import {
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
  const [anchor, setAnchor] = useState<Geodetic>(OPENING_ANCHOR);
  const [orientationCamera, setOrientationCamera] = useState<Camera>({ azimuthDeg: -35, elevationDeg: 26, scale: 55 });
  const [positionCamera, setPositionCamera] = useState<Camera>({ azimuthDeg: 35, elevationDeg: 22, scale: 150 });

  function handleConventionChange(convention: LocalConvention) {
    setPose((prev) => withConvention(prev, convention));
  }

  return (
    <div className="border border-rule bg-surface">
      <ChainRail
        mode={mode}
        onModeChange={setMode}
        convention={pose.convention}
        anchor={anchor}
        rNedBody={pose.rNedBody}
        originNed={pose.originNed}
      />
      {mode === "orientation" ? (
        <OrientationMode
          state={pose}
          camera={orientationCamera}
          onCameraChange={setOrientationCamera}
          onConventionChange={handleConventionChange}
          onAngleEdit={(field: keyof EulerAngles, value: number) => setPose((prev) => withAngleEdit(prev, field, value))}
          onOrderChange={(order) => setPose((prev) => withOrder(prev, order))}
          onInterpretationChange={(interpretation) => setPose((prev) => withInterpretation(prev, interpretation))}
          onQuaternionCommit={(q: Quaternion) => setPose((prev) => withQuaternion(prev, q))}
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
