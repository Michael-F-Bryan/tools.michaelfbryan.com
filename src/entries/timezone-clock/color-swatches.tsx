"use client";

import { PALETTE } from "./types";

export type ColorSwatchesProps = Readonly<{
  label: string;
  value: string;
  onChange: (hex: string) => void;
}>;

export function ColorSwatches({ label, value, onChange }: ColorSwatchesProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {PALETTE.map((swatch) => {
        const selected = swatch.hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={swatch.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={swatch.name}
            title={swatch.name}
            onClick={() => onChange(swatch.hex)}
            className="size-7 border-2 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{
              backgroundColor: swatch.hex,
              borderColor: selected ? "var(--ink)" : "transparent",
              transform: selected ? "scale(1.1)" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
