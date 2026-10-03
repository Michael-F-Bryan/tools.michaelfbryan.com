"use client";

import { PALETTE } from "./types";

export type ColorSwatchesProps = Readonly<{
  label: string;
  value: string;
  unavailable: readonly string[];
  onChange: (hex: string) => void;
}>;

export function ColorSwatches({ label, value, unavailable, onChange }: ColorSwatchesProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {PALETTE.map((swatch) => {
        const selected = swatch.hex.toLowerCase() === value.toLowerCase();
        const disabled = !selected && unavailable.some((color) => color.toLowerCase() === swatch.hex.toLowerCase());
        return (
          <button
            key={swatch.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={swatch.name}
            title={disabled ? `${swatch.name} — in use` : swatch.name}
            disabled={disabled}
            onClick={() => onChange(swatch.hex)}
            className="size-7 border-2 transition-transform disabled:cursor-not-allowed disabled:grayscale disabled:opacity-25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
