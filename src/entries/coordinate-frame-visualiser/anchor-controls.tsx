import { useState } from "react";

import { cn } from "@/lib/utils";

import { RANGE_INPUT, TEXT_FIELD } from "./controls";
import { parseUserNumber } from "./format";
import type { Geodetic } from "./math";
import { useSyncedDraft } from "./use-synced-draft";

type AnchorControlsProps = Readonly<{
  anchor: Geodetic;
  onAnchorChange: (anchor: Geodetic) => void;
}>;

function GeodeticRow({
  label,
  hint,
  unit,
  value,
  decimals,
  slider,
  onCommit,
  validate,
}: Readonly<{
  label: string;
  hint: string;
  unit: string;
  value: number;
  decimals: number;
  /** Slider range, when the quantity has one; height has none. */
  slider?: Readonly<{ min: number; max: number }>;
  onCommit: (value: number) => void;
  validate: (value: number) => string | null;
}>) {
  const [draft, setDraft, resetDraft] = useSyncedDraft(value.toFixed(decimals));
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
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-x-2">
      <span className="col-span-3 text-sm text-secondary">
        {label} <small className="font-mono text-xs text-muted">{hint}</small>
      </span>
      {slider ? (
        <input
          type="range"
          min={slider.min}
          max={slider.max}
          step={0.01}
          value={value}
          aria-label={`${label}, slider`}
          onChange={(event) => {
            setError(null);
            onCommit(Number(event.target.value));
          }}
          className={RANGE_INPUT}
        />
      ) : (
        <span />
      )}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className={cn(TEXT_FIELD, "w-full")}
      />
      <span className="font-mono text-xs text-muted">{unit}</span>
      {error ? (
        <p role="alert" className="col-span-3 mt-1 text-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Latitude and longitude sliders plus exact fields: the anchor's controls beneath the globe. */
export function AnchorControls({ anchor, onAnchorChange }: AnchorControlsProps) {
  return (
    <div role="group" aria-label="Anchor" className="border-t border-rule px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">Anchor</span>
        <span className="font-mono text-xs text-muted">drag it on the globe, or set it here</span>
      </div>
      <GeodeticRow
        label="latitude"
        hint="φ · negative is south"
        unit="°"
        value={anchor.latitudeDeg}
        decimals={4}
        slider={{ min: -90, max: 90 }}
        onCommit={(latitudeDeg) => onAnchorChange({ ...anchor, latitudeDeg })}
        validate={(v) => (Math.abs(v) > 90 ? "Latitude must be between −90° and 90°." : null)}
      />
      <GeodeticRow
        label="longitude"
        hint="λ · negative is west"
        unit="°"
        value={anchor.longitudeDeg}
        decimals={4}
        slider={{ min: -180, max: 180 }}
        onCommit={(longitudeDeg) => onAnchorChange({ ...anchor, longitudeDeg })}
        validate={(v) => (Math.abs(v) > 180 ? "Longitude must be between −180° and 180°." : null)}
      />
      <GeodeticRow
        label="height"
        hint="h · above the ellipsoid, not sea level"
        unit="m"
        value={anchor.heightM}
        decimals={0}
        onCommit={(heightM) => onAnchorChange({ ...anchor, heightM })}
        validate={() => null}
      />
    </div>
  );
}
