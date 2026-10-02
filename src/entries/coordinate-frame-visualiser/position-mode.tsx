import { AnchorControls } from "./anchor-controls";
import { LINK_BUTTON } from "./controls";
import type { Geodetic, LocalConvention } from "./math";
import { anchorFacing, cameraFacingAnchor, POSITION_SCALE, REFRAME_BELOW_FACING } from "./position-geometry";
import { PositionInspector } from "./position-inspector";
import { PositionScene } from "./position-scene";
import type { Camera } from "./projection";

export type PositionModeProps = Readonly<{
  anchor: Geodetic;
  convention: LocalConvention;
  camera: Camera;
  onCameraChange: (camera: Camera) => void;
  onConventionChange: (convention: LocalConvention) => void;
  onAnchorChange: (anchor: Geodetic) => void;
}>;

const POLE_VIEW: Camera = { azimuthDeg: 0, elevationDeg: 89, scale: POSITION_SCALE };

function LegendSwatch({ kind }: Readonly<{ kind: "ecef" | "local" }>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 8" className="inline-block h-2 w-6">
      <line x1={1} y1={4} x2={23} y2={4} className={kind === "ecef" ? "stroke-ink" : "stroke-accent"} strokeWidth={kind === "local" ? 2.5 : 1.25} />
    </svg>
  );
}

export function PositionMode({ anchor, convention, camera, onCameraChange, onConventionChange, onAnchorChange }: PositionModeProps) {
  /** A change from the sliders or fields: reframe when it would land the anchor on the limb or behind the Earth. */
  function handleControlsChange(next: Geodetic) {
    onAnchorChange(next);
    if (anchorFacing(camera, next) < REFRAME_BELOW_FACING) onCameraChange(cameraFacingAnchor(next));
  }

  return (
    <section aria-label="Position" data-mode-section className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
      <div className="min-w-0 border-b border-rule lg:border-b-0 lg:border-r">
        <div className="sticky top-0 z-10 border-b border-rule-subtle bg-surface px-4 pb-3 pt-3 sm:px-6" data-scene-stage>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Scene · geodetic → ECEF → local</span>
            <span className="font-mono text-xs text-muted">WGS84 · to scale</span>
          </div>
          <PositionScene anchor={anchor} convention={convention} camera={camera} onCameraChange={onCameraChange} onAnchorDrag={onAnchorChange} />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-xs text-muted">
            <span className="flex flex-wrap items-center gap-x-3">
              <span className="flex items-center gap-1">
                <LegendSwatch kind="ecef" /> ECEF
              </span>
              <span className="flex items-center gap-1">
                <LegendSwatch kind="local" /> local {convention.toUpperCase()} at the anchor
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-sm">
              <span>View</span>
              <button type="button" className={LINK_BUTTON} onClick={() => onCameraChange(cameraFacingAnchor(anchor))}>
                anchor
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" className={LINK_BUTTON} onClick={() => onCameraChange(POLE_VIEW)}>
                pole
              </button>
            </span>
          </div>
        </div>
        <AnchorControls anchor={anchor} onAnchorChange={handleControlsChange} />
      </div>
      <PositionInspector anchor={anchor} convention={convention} onConventionChange={onConventionChange} />
    </section>
  );
}
