"use client";

import { useState } from "react";

import { FIELD_CLASS, FIELD_ERROR, FIELD_LABEL } from "./controls";
import { MAX_OFFSET_MINUTES, MIN_OFFSET_MINUTES, OFFSET_PRESETS } from "./types";

const CUSTOM = "__custom__";

function offsetToHoursText(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

export type OffsetFieldProps = Readonly<{
  idPrefix: string;
  label: string;
  value: number;
  onChange: (offsetMinutes: number) => void;
}>;

/**
 * A preset dropdown of named fixed offsets (including half/quarter-hour and
 * same-number DST-pair examples) next to an always-available exact-hours
 * field, since the offset itself — not which name was picked — is the
 * source of truth. The exact field keeps its own typed draft so an
 * in-progress entry like "-" or "5." isn't clobbered by the parent's
 * last-committed numeric value, and an invalid or out-of-range draft is
 * reported inline rather than silently rounded or clamped — the last valid
 * committed offset is left in place until the draft is corrected.
 */
export function OffsetField({ idPrefix, label, value, onChange }: OffsetFieldProps) {
  const matchingPreset = OFFSET_PRESETS.find((preset) => preset.offsetMinutes === value);

  const [previousValue, setPreviousValue] = useState(value);
  const [draft, setDraft] = useState(() => offsetToHoursText(value));
  const [error, setError] = useState<string | null>(null);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(offsetToHoursText(value));
    setError(null);
  }

  function handlePresetChange(event: React.ChangeEvent<HTMLSelectElement>) {
    if (event.target.value === CUSTOM) return;
    setError(null);
    onChange(Number(event.target.value));
  }

  function handleExactChange(event: React.ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;
    setDraft(text);
    if (text.trim() === "") {
      setError("Enter an offset in hours.");
      return;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      setError("Enter a number of hours, e.g. 8 or -3.5.");
      return;
    }
    const minutes = Math.round(parsed * 60);
    if (minutes < MIN_OFFSET_MINUTES || minutes > MAX_OFFSET_MINUTES) {
      setError(`Must be between ${MIN_OFFSET_MINUTES / 60} and ${MAX_OFFSET_MINUTES / 60} hours.`);
      return;
    }
    setError(null);
    onChange(minutes);
  }

  const errorId = `${idPrefix}-exact-error`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
      <label className="min-w-0">
        <span className={FIELD_LABEL}>{label}</span>
        <select
          id={`${idPrefix}-preset`}
          className={FIELD_CLASS}
          value={matchingPreset ? String(matchingPreset.offsetMinutes) : CUSTOM}
          onChange={handlePresetChange}
        >
          <option value={CUSTOM}>Custom — use the exact field</option>
          {OFFSET_PRESETS.map((preset) => (
            <option key={preset.label} value={String(preset.offsetMinutes)}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0">
        <span className={FIELD_LABEL}>Exact (h)</span>
        <input
          id={`${idPrefix}-exact`}
          type="text"
          inputMode="decimal"
          className={FIELD_CLASS}
          value={draft}
          onChange={handleExactChange}
          aria-label={`${label}, exact offset in hours from UTC`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error ? (
        <p id={errorId} role="alert" className={`${FIELD_ERROR} col-span-2`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
