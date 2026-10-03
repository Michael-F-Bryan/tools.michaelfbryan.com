"use client";

import { FIELD_CLASS, FIELD_LABEL } from "./controls";
import { OFFSET_PRESETS } from "./types";

export type OffsetFieldProps = Readonly<{
  idPrefix: string;
  label: string;
  value: number;
  onChange: (offsetMinutes: number) => void;
}>;

export function OffsetField({ idPrefix, label, value, onChange }: OffsetFieldProps) {
  return (
    <label className="min-w-0">
      <span className={FIELD_LABEL}>{label}</span>
      <select
        id={`${idPrefix}-preset`}
        aria-label={label}
        className={FIELD_CLASS}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {OFFSET_PRESETS.map((preset) => (
          <option key={preset.offsetMinutes} value={preset.offsetMinutes}>
            {preset.label}
          </option>
        ))}
      </select>
    </label>
  );
}
