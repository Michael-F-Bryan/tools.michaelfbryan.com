import { cn } from "@/lib/utils";

import { DISCLOSURE_SUMMARY, SEGMENT_BUTTON, segmentTone } from "./controls";
import { formatMetres, formatSigned } from "./format";
import { type Geodetic, type LocalConvention, type Mat3, type Vec3 } from "./math";
import { ScrollableMatrix } from "./matrix-table";
import { wholeChain } from "./pose";

export type Mode = "orientation" | "position";

type ChainRailProps = Readonly<{
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  convention: LocalConvention;
  anchor: Geodetic;
  rNedBody: Mat3;
  originNed: Vec3;
}>;

/** Rotation block at 4 dp, translation column in metres; the bottom `0 0 0 1` row is printed plainly. */
function matrixRows(m: readonly (readonly number[])[]): readonly string[] {
  return m.map((row, r) =>
    r < 3
      ? [formatSigned(row[0], 4), formatSigned(row[1], 4), formatSigned(row[2], 4), formatMetres(row[3])].join("  ")
      : row.map((v) => v.toString()).join("  "),
  );
}

function MatrixLines({ m }: Readonly<{ m: readonly (readonly number[])[] }>) {
  return (
    <div className="mt-1 font-mono text-sm text-secondary">
      {matrixRows(m).map((row, i) => (
        <div key={i} className="whitespace-nowrap">
          {row}
        </div>
      ))}
    </div>
  );
}

/** A frame name in the chain map. */
function FrameName({ children }: Readonly<{ children: React.ReactNode }>) {
  return <li className="whitespace-nowrap font-mono text-sm font-bold text-ink">{children}</li>;
}

/** A hop between two frames: the step that a mode explores is drawn in cobalt. */
function Hop({ active, children }: Readonly<{ active: boolean; children: React.ReactNode }>) {
  return (
    <li
      aria-current={active ? "true" : undefined}
      className={cn(
        "whitespace-nowrap border-b-2 px-1 font-mono text-xs",
        active ? "border-accent font-bold text-accent" : "border-transparent text-muted",
      )}
    >
      {children}
    </li>
  );
}

/**
 * The chain of frames from geodetic to body, as a map of where each mode
 * sits. The two mode buttons are the only controls; the map itself just
 * shows which hops the current mode is about.
 */
export function ChainRail({ mode, onModeChange, convention, anchor, rNedBody, originNed }: ChainRailProps) {
  const localLabel = convention === "ned" ? "local NED" : "local ENU";
  const { ecefFromBody, bodyFromEcef } = wholeChain(anchor, convention, rNedBody, originNed);

  return (
    <nav aria-label="Transform chain" className="border-b border-rule">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div className="inline-flex border border-rule" role="group" aria-label="Mode">
          {(["orientation", "position"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => onModeChange(candidate)}
              className={cn(SEGMENT_BUTTON, "px-4", segmentTone(mode === candidate))}
            >
              {candidate === "orientation" ? "Orientation" : "Position"}
            </button>
          ))}
        </div>
        <ol aria-label="Frames" className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <FrameName>geodetic</FrameName>
          <Hop active={mode === "position"}>f(φ, λ, h) →</Hop>
          <FrameName>ECEF</FrameName>
          <Hop active={mode === "position"}>T[ecef←{convention}] ↔</Hop>
          <FrameName>{localLabel}</FrameName>
          <Hop active={mode === "orientation"}>T[{convention}←body] ↔</Hop>
          <FrameName>body</FrameName>
        </ol>
      </div>

      <details className="border-t border-rule-subtle px-4 py-1 sm:px-6">
        <summary className={DISCLOSURE_SUMMARY}>
          <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Whole chain</span>
          <span className="text-sm text-muted">
            one product from body to ECEF: T[ecef←body] = T[ecef←{convention}] · T[{convention}←body]
          </span>
        </summary>
        <div className="space-y-4 pb-4">
          <div>
            <span className="block font-mono text-sm font-bold text-ink">T[ecef←body]</span>
            <ScrollableMatrix ariaLabel="T[ecef←body] matrix, scrollable" hint="scroll for the translation column">
              <MatrixLines m={ecefFromBody.m} />
            </ScrollableMatrix>
          </div>
          <div>
            <span className="block font-mono text-sm font-bold text-ink">
              T[body←ecef] — factors inverted, order reversed
            </span>
            <ScrollableMatrix ariaLabel="T[body←ecef] matrix, scrollable" hint="scroll for the translation column">
              <MatrixLines m={bodyFromEcef.m} />
            </ScrollableMatrix>
          </div>
        </div>
      </details>
    </nav>
  );
}
