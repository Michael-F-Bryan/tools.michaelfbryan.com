import { useState } from "react";

import { cn } from "@/lib/utils";

import { formatMetres, formatSigned, parseUserNumber } from "./format";
import { type Geodetic, geodeticToEcef, invertTransform, type LocalConvention, transformEcefFromLocal, WGS84_A, WGS84_INV_F } from "./math";
import { TransformTable } from "./matrix-table";
import { useSyncedDraft } from "./use-synced-draft";

type PositionInspectorProps = Readonly<{
  anchor: Geodetic;
  convention: LocalConvention;
  onConventionChange: (convention: LocalConvention) => void;
  onAnchorCommit: (anchor: Geodetic) => void;
}>;

function GeodeticField({
  label,
  hint,
  value,
  onCommit,
  validate,
}: Readonly<{
  label: string;
  hint: string;
  value: number;
  onCommit: (value: number) => void;
  validate: (value: number) => string | null;
}>) {
  const [draft, setDraft, resetDraft] = useSyncedDraft(value.toString());
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const parsed = parseUserNumber(draft);
    if (parsed === null) {
      setError("Enter a number.");
      resetDraft();
      return;
    }
    const problem = validate(parsed);
    if (problem) {
      setError(problem);
      resetDraft();
      return;
    }
    setError(null);
    onCommit(parsed);
  }

  return (
    <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-sm text-secondary">
        {label} <small className="font-mono text-xs text-muted">{hint}</small>
      </span>
      <span className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          className="w-28 border border-rule bg-surface px-2 py-1 text-right font-mono text-sm tabular-nums"
        />
      </span>
      {error ? (
        <p role="alert" className="col-span-2 text-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MeridianInset() {
  return (
    <figure className="mt-4 max-w-[16rem]">
      <svg viewBox="0 0 200 125" role="img" aria-hidden="true" className="block w-full">
        <ellipse cx="90" cy="65" rx="80" ry="55" fill="none" className="stroke-ink" strokeWidth={1} />
        <line x1="4" y1="65" x2="186" y2="65" className="stroke-rule-subtle" strokeWidth={1} />
        <line x1="90" y1="8" x2="90" y2="122" className="stroke-rule-subtle" strokeWidth={1} />
        <line x1="90" y1="65" x2="151.3" y2="100.4" className="stroke-rule" strokeWidth={1} strokeDasharray="3 3" />
        <line x1="122.4" y1="65" x2="165.2" y2="117.4" className="stroke-accent" strokeWidth={1.5} />
        <path d="M 134 65 A 12 12 0 0 1 130 74" fill="none" className="stroke-accent" strokeWidth={1.25} />
        <circle cx="151.3" cy="100.4" r="2.5" className="fill-accent" />
        <circle cx="90" cy="65" r="2" className="fill-ink" />
        <text x="137" y="79" className="fill-accent font-mono text-[10px] font-bold">
          φ
        </text>
        <text x="163" y="110" className="fill-accent font-mono text-[9px]">
          h
        </text>
        <text x="12" y="60" className="fill-muted text-[9px]">
          equator
        </text>
        <text x="93" y="18" className="fill-muted text-[9px]">
          pole
        </text>
        <text x="70" y="78" className="fill-muted text-[9px]" textAnchor="end">
          centre
        </text>
      </svg>
      <figcaption className="mt-2 text-xs leading-5 text-muted">
        φ is the angle between the equatorial plane and the ellipsoid normal at the anchor; the normal does not pass
        through the centre. h is measured along that normal, above the ellipsoid. Flattening exaggerated.
      </figcaption>
    </figure>
  );
}

export function PositionInspector({ anchor, convention, onConventionChange, onAnchorCommit }: PositionInspectorProps) {
  const [inverted, setInverted] = useState(false);
  const ecef = geodeticToEcef(anchor);
  const forward = transformEcefFromLocal(anchor, convention);
  const shown = inverted ? invertTransform(forward) : forward;
  const localNames = convention === "ned" ? (["N", "E", "D"] as const) : (["E", "N", "U"] as const);
  const columnHeaders: readonly [string, string, string, string] = inverted
    ? ["X", "Y", "Z", "origin"]
    : [...localNames, "anchor"];
  const rowHeaders: readonly [string, string, string] = inverted ? localNames : (["X", "Y", "Z"] as const);
  const rows = shown.m.slice(0, 3).map(
    (row) =>
      [formatSigned(row[0], 4), formatSigned(row[1], 4), formatSigned(row[2], 4), formatMetres(row[3])] as readonly [
        string,
        string,
        string,
        string,
      ],
  );

  return (
    <div className="min-w-0">
      <div className="px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Frame</span>
          <span className="font-mono text-xs text-muted">shared with the orientation mode</span>
        </div>
        <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
          <span className="text-sm text-secondary">Local</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex border border-rule" role="group" aria-label="Local frame convention">
              {(["ned", "enu"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={convention === candidate}
                  onClick={() => onConventionChange(candidate)}
                  className={cn(
                    "px-2 py-1 text-xs uppercase focus-visible:outline-2 focus-visible:outline-accent",
                    convention === candidate ? "bg-accent text-paper" : "text-secondary",
                  )}
                >
                  {candidate.toUpperCase()}
                </button>
              ))}
            </span>
            <span className="font-mono text-xs text-muted">changes which rows the matrix below has, not where the anchor is</span>
          </span>
        </div>
      </div>

      <div className="border-t border-rule-subtle px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Geodetic</span>
          <span className="font-mono text-xs text-muted">
            WGS84 · a {formatMetres(WGS84_A)} m · 1/f {WGS84_INV_F.toFixed(6)}
          </span>
        </div>
        <GeodeticField
          label="latitude"
          hint="φ · negative is south"
          value={anchor.latitudeDeg}
          onCommit={(latitudeDeg) => onAnchorCommit({ ...anchor, latitudeDeg })}
          validate={(v) => (Math.abs(v) > 90 ? "Latitude must be between −90° and 90°." : null)}
        />
        <GeodeticField
          label="longitude"
          hint="λ · negative is west"
          value={anchor.longitudeDeg}
          onCommit={(longitudeDeg) => onAnchorCommit({ ...anchor, longitudeDeg })}
          validate={(v) => (Math.abs(v) > 180 ? "Longitude must be between −180° and 180°." : null)}
        />
        <GeodeticField
          label="height"
          hint="h · above the ellipsoid, not sea level"
          value={anchor.heightM}
          onCommit={(heightM) => onAnchorCommit({ ...anchor, heightM })}
          validate={() => null}
        />
        <MeridianInset />
      </div>

      <div className="border-t border-rule-subtle px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">ECEF</span>
          <span className="border border-accent px-2 py-0.5 font-mono text-xs uppercase tracking-label text-accent">
            a function, not a matrix
          </span>
        </div>
        <div className="mt-3 grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-y-2">
          {(["X", "Y", "Z"] as const).map((label, index) => (
            <span key={label} className="contents">
              <span className="text-sm text-secondary">{label}</span>
              <span className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  aria-label={`ECEF ${label}`}
                  value={formatMetres([ecef.x, ecef.y, ecef.z][index])}
                  className="w-32 border border-rule-subtle bg-panel px-2 py-1 text-right font-mono text-sm tabular-nums text-secondary"
                />
                <span className="font-mono text-xs text-muted">m</span>
              </span>
            </span>
          ))}
        </div>
        <pre className="mt-3 whitespace-pre-wrap font-mono text-sm leading-6 text-secondary">
          {"X = (Rₙ + h) cos φ cos λ\nY = (Rₙ + h) cos φ sin λ\nZ = (Rₙ(1 − e²) + h) sin φ\nRₙ(φ) = a / √(1 − e² sin² φ)"}
        </pre>
        <p className="mt-2 max-w-[38rem] text-sm text-muted">
          φ and λ appear inside sines and cosines and under a square root. There is no 3×3 or 4×4 that turns (φ, λ,
          h) into (X, Y, Z). Going the other way is iterative.
        </p>
      </div>

      <div className="border-t border-rule-subtle px-4 py-4 sm:px-6">
        <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Local tangent</span>
        <div className="mt-3">
          <TransformTable
            name={inverted ? `T[${convention}←ecef]` : `T[ecef←${convention}]`}
            takes={inverted ? "ECEF coordinates" : `${convention.toUpperCase()} coordinates measured at the anchor, with a fourth coordinate of 1`}
            gives={inverted ? `${convention.toUpperCase()} coordinates` : "ECEF coordinates"}
            columnHeaders={columnHeaders}
            rowHeaders={rowHeaders}
            rows={rows}
            ariaLabel="Homogeneous transform between ECEF and the local tangent frame"
            onInvert={() => setInverted((v) => !v)}
            invertLabel={inverted ? `Invert → T[ecef←${convention}]` : `Invert → T[${convention}←ecef]`}
            invertNote={inverted ? "rotation transposed, last column becomes −Rᵀ·p" : "rotation transposed, last column becomes −Rᵀ·p_anchor"}
            copyText={`T[${inverted ? `${convention}←ecef` : `ecef←${convention}`}]\n${shown.m
              .map((row) => row.map((v) => formatSigned(v, 4)).join("  "))
              .join("\n")}`}
          />
        </div>
        <p className="mt-2 max-w-[38rem] text-sm text-muted">
          The tinted block is the rotation: its columns are the local frame&rsquo;s basis vectors written in ECEF,
          and they depend only on φ and λ. The last column is the anchor&rsquo;s ECEF position above.
        </p>
      </div>
    </div>
  );
}
