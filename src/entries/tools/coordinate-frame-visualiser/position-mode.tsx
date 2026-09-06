import type { Geodetic, LocalConvention } from "./math";
import { PositionInspector } from "./position-inspector";
import { PositionScene } from "./position-scene";
import type { Camera } from "./projection";

export type PositionModeProps = Readonly<{
  anchor: Geodetic;
  convention: LocalConvention;
  camera: Camera;
  onCameraChange: (camera: Camera) => void;
  onConventionChange: (convention: LocalConvention) => void;
  onAnchorCommit: (anchor: Geodetic) => void;
}>;

// "reset" is deliberately the same as "anchor": at this fixture's anchor
// (southern hemisphere, east of the prime meridian) the plain default
// camera (az 35, el 22) puts the anchor on the far hemisphere, so the load
// view faced away from the very thing the scene exists to show.
export const ANCHOR_VIEW: Camera = { azimuthDeg: 115, elevationDeg: -22, scale: 150 };

const VIEW_PRESETS: Record<string, Camera> = {
  anchor: ANCHOR_VIEW,
  pole: { azimuthDeg: 0, elevationDeg: 89, scale: 150 },
  reset: ANCHOR_VIEW,
};

export function PositionMode({ anchor, convention, camera, onCameraChange, onConventionChange, onAnchorCommit }: PositionModeProps) {
  return (
    <section aria-label="Position" data-mode-section className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
      <div className="min-w-0 border-b border-rule lg:border-b-0 lg:border-r">
        <div className="px-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Scene · geodetic → ECEF → local</span>
            <span className="font-mono text-xs text-muted">WGS84 · {convention.toUpperCase()} at the anchor · to scale</span>
          </div>
          <figure className="mt-3">
            <PositionScene anchor={anchor} convention={convention} camera={camera} onCameraChange={onCameraChange} />
            <figcaption className="mt-3 max-w-[38rem] text-sm leading-6 text-muted">
              The cobalt dot is the anchor. The small triad is the local frame standing on the ellipsoid there. The
              ECEF axes are dashed inside the Earth and solid outside it. Latitude and longitude are angles, so the
              anchor&rsquo;s position passes through a function before any matrix can touch it. Drawn to scale: the
              flattening is barely visible, and no body is drawn because it would be smaller than the dot.
            </figcaption>
          </figure>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>View</span>
            <button type="button" className="text-secondary underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onCameraChange(VIEW_PRESETS.anchor)}>
              anchor
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="text-secondary underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onCameraChange(VIEW_PRESETS.pole)}>
              pole
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="text-secondary underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={() => onCameraChange(VIEW_PRESETS.reset)}>
              reset view
            </button>
            <span className="basis-full text-xs sm:basis-auto">Dragging the scene orbits the camera. Anchor dragging is not available yet.</span>
          </div>
        </div>
        <div className="border-t border-rule px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Hops</span>
            <span className="text-sm text-muted">Two different kinds of step. Only the second is a matrix.</span>
          </div>
          <ol className="mt-3 border-t border-rule-subtle" aria-label="Hops">
            <li className="border-b border-rule-subtle py-2 text-sm">
              <span className="font-mono text-xs font-bold text-muted">01</span>{" "}
              <strong>geodetic → ECEF</strong> <span className="text-muted">· a closed-form function of φ, λ, h and the WGS84 constants</span>
            </li>
            <li aria-current="step" className="bg-accent/10 border-b border-rule-subtle py-2 text-sm">
              <span className="font-mono text-xs font-bold text-accent">02</span>{" "}
              <strong>ECEF ↔ local {convention.toUpperCase()}</strong>{" "}
              <span className="text-ink">· a 4×4 whose rotation depends only on φ and λ, and whose last column is the anchor&rsquo;s ECEF position</span>
            </li>
            <li className="border-b border-rule-subtle py-2 text-sm">
              <span className="font-mono text-xs font-bold text-muted">03</span>{" "}
              <strong>local {convention.toUpperCase()} ↔ body</strong> <span className="text-muted">· the orientation mode</span>
            </li>
          </ol>
        </div>
      </div>
      <PositionInspector anchor={anchor} convention={convention} onConventionChange={onConventionChange} onAnchorCommit={onAnchorCommit} />
    </section>
  );
}
