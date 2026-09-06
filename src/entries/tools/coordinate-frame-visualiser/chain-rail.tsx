import { cn } from "@/lib/utils";

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

/** A compact "→" shown only at narrow widths, standing in for the full link name that's hidden there. */
function MobileLinkArrow() {
  return (
    <span aria-hidden="true" className="sm:hidden">
      →
    </span>
  );
}

export function ChainRail({ mode, onModeChange, convention, anchor, rNedBody, originNed }: ChainRailProps) {
  const localLabel = convention === "ned" ? "local NED" : "local ENU";
  const bodyLinkName = convention === "ned" ? "T[ned←body]" : "T[enu←body]";

  const { ecefFromBody, bodyFromEcef } = wholeChain(anchor, convention, rNedBody, originNed);

  return (
    <nav aria-label="Transform chain" className="border-b border-rule">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-4 pt-3 sm:px-6">
        <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Chain</span>
        <p className="text-sm text-muted">
          Left to right is nesting. The direction a matrix maps is printed on the matrix, not here.
        </p>
        <div className="inline-flex border border-rule" role="group" aria-label="Mode">
          {(["orientation", "position"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => onModeChange(candidate)}
              className={cn(
                "px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-accent",
                mode === candidate ? "bg-accent text-paper" : "text-secondary",
              )}
            >
              {candidate === "orientation" ? "Orientation" : "Position"}
            </button>
          ))}
        </div>
      </div>

      <ol aria-label="Frames" className="flex items-center gap-1 overflow-x-auto px-4 py-3 sm:px-6">
        <li>
          <button
            type="button"
            aria-pressed={mode === "position"}
            onClick={() => onModeChange("position")}
            className={cn(
              "whitespace-nowrap border-b-2 pb-0.5 font-mono text-sm font-bold focus-visible:outline-2 focus-visible:outline-accent",
              mode === "position" ? "border-accent text-accent" : "border-transparent text-ink",
            )}
          >
            geodetic
          </button>
        </li>
        <li className={cn("mx-1 font-mono text-xs sm:mx-2", mode === "position" ? "text-accent" : "text-muted")}>
          <span className="hidden sm:inline">f(φ, λ, h) →</span>
          <MobileLinkArrow />
        </li>
        <li>
          <button
            type="button"
            aria-pressed={mode === "position"}
            onClick={() => onModeChange("position")}
            className={cn(
              "whitespace-nowrap border-b-2 pb-0.5 font-mono text-sm font-bold focus-visible:outline-2 focus-visible:outline-accent",
              mode === "position" ? "border-accent text-accent" : "border-transparent text-ink",
            )}
          >
            ECEF
          </button>
        </li>
        <li className={cn("mx-1 font-mono text-xs sm:mx-2", mode === "position" ? "text-accent" : "text-muted")}>
          <span className="hidden sm:inline">T[ecef←{convention}] ↔</span>
          <MobileLinkArrow />
        </li>
        <li>
          <button
            type="button"
            aria-pressed={mode === "orientation"}
            onClick={() => onModeChange("orientation")}
            className={cn(
              "whitespace-nowrap border-b-2 pb-0.5 font-mono text-sm font-bold focus-visible:outline-2 focus-visible:outline-accent",
              mode === "orientation" ? "border-accent text-accent" : "border-transparent text-ink",
            )}
          >
            {localLabel}
          </button>
        </li>
        <li className={cn("mx-1 font-mono text-xs sm:mx-2", mode === "orientation" ? "text-accent" : "text-muted")}>
          <span className="hidden sm:inline">{bodyLinkName} ↔</span>
          <MobileLinkArrow />
        </li>
        <li>
          <button
            type="button"
            aria-pressed={mode === "orientation"}
            onClick={() => onModeChange("orientation")}
            className={cn(
              "whitespace-nowrap border-b-2 pb-0.5 font-mono text-sm font-bold focus-visible:outline-2 focus-visible:outline-accent",
              mode === "orientation" ? "border-accent text-accent" : "border-transparent text-ink",
            )}
          >
            body
          </button>
        </li>
      </ol>

      <details className="border-t border-rule-subtle">
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
          <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Whole chain</span>
          <span className="text-sm text-muted">
            One product from body to ECEF: T[ecef←body] = T[ecef←{convention}] · T[{convention}←body].
          </span>
        </summary>
        <div className="space-y-4 px-4 pb-4 sm:px-6">
          <div>
            <span className="block font-mono text-sm font-bold text-ink">T[ecef←body]</span>
            <ScrollableMatrix ariaLabel="T[ecef←body] matrix, scrollable">
              <MatrixLines m={ecefFromBody.m} />
            </ScrollableMatrix>
          </div>
          <div>
            <span className="block font-mono text-sm font-bold text-ink">
              T[body←ecef] — factors inverted, order reversed
            </span>
            <ScrollableMatrix ariaLabel="T[body←ecef] matrix, scrollable">
              <MatrixLines m={bodyFromEcef.m} />
            </ScrollableMatrix>
          </div>
        </div>
      </details>
    </nav>
  );
}
