import { useId, useState } from "react";

import { Label } from "@/components/label";

import { decimalsOf, formatDisplay, toDisplay } from "./format";
import { CAR_COUNT_SLIDER, DRIVER_SLIDERS, PRESETS, ROAD, VARIATION_SLIDER } from "./parameters";
import styles from "./experiment.module.css";
import type { DriverParamKey, ExperimentConfig, SliderSpec, StartArrangement } from "./types";

/** At most a short phrase per control; the labels themselves come from the model. */
const DRIVER_HINTS: Record<DriverParamKey, string> = {
  desiredSpeed: "on an empty road",
  timeGap: "how far behind, in seconds",
  reactionDelay: "how old what they act on is",
  maxAcceleration: "hardest they speed up",
  comfortableBraking: "not an emergency limit",
};

/** "Time gap" alone is easily confused with the reaction delay; say which gap. */
const LABEL_OVERRIDES: Partial<Record<DriverParamKey, string>> = { timeGap: "Following time gap" };

const DRIVER_ORDER: readonly DriverParamKey[] = ["desiredSpeed", "timeGap", "reactionDelay", "maxAcceleration", "comfortableBraking"];

const STARTS: readonly { value: StartArrangement; label: string }[] = [
  { value: "even", label: "Even" },
  { value: "jumbled", label: "Slightly jumbled" },
];

function Slider({ spec, label = spec.label, value, hint, onChange }: Readonly<{ spec: SliderSpec; label?: string; value: number; hint: string; onChange: (si: number) => void }>) {
  const id = useId();
  return (
    <div className={styles.slider}>
      <span className={styles.sliderName}>
        <label htmlFor={id}>{label}</label>
        <small id={`${id}-hint`}>{hint}</small>
      </span>
      <output htmlFor={id}>{formatDisplay(spec, value)}</output>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={toDisplay(spec, value)}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(Number(Number(event.currentTarget.value).toFixed(decimalsOf(spec.step))) / spec.displayPerSI)}
      />
    </div>
  );
}

/** The seed as typed: a half-typed or empty number does not restart anything. */
function SeedField({ seed, onSeed }: Readonly<{ seed: number; onSeed: (seed: number) => void }>) {
  const id = useId();
  const [draft, setDraft] = useState(String(seed));
  const [shown, setShown] = useState(seed);
  if (shown !== seed) {
    setShown(seed);
    setDraft(String(seed));
  }
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldName}>
        Seed <small>restarts</small>
      </label>
      <div className={styles.seed}>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={draft}
          onChange={(event) => {
            const text = event.currentTarget.value;
            setDraft(text);
            const next = Number(text);
            if (text !== "" && Number.isSafeInteger(next) && next >= 0 && next !== seed) onSeed(next);
          }}
        />
        <button type="button" className={styles.button} onClick={() => onSeed(Math.floor(Math.random() * 1_000_000))}>
          New seed
        </button>
      </div>
    </div>
  );
}

function density(carCount: number): string {
  const perKm = carCount / (ROAD.length / 1000);
  const gap = ROAD.length / carCount - ROAD.vehicleLength;
  return `${Math.round(perKm)} cars/km · ${gap.toFixed(1)} m gaps`;
}

type PresetsProps = Readonly<{ config: ExperimentConfig; onPreset: (config: ExperimentConfig) => void }>;

/** The curated experiments: the one-tap main path, so they live with the transport rather than with the detail controls. */
export function Presets({ config, onPreset }: PresetsProps) {
  const id = useId();
  const current = JSON.stringify(config);
  return (
    <section className={styles.experiments} aria-labelledby={id}>
      <Label id={id} tone="muted">Experiments · restart the run</Label>
      <div className={styles.presets}>
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={styles.button}
            aria-pressed={JSON.stringify(preset.config) === current}
            onClick={() => onPreset(preset.config)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </section>
  );
}

type ControlsProps = Readonly<{
  config: ExperimentConfig;
  onRestartWith: (change: Partial<ExperimentConfig>) => void;
  onDriver: (key: DriverParamKey, si: number) => void;
  onVariation: (variation: number) => void;
}>;

export function Controls({ config, onRestartWith, onDriver, onVariation }: ControlsProps) {
  const idBase = useId();

  return (
    <div className={styles.controls}>
      <section className={styles.group} aria-labelledby={`${idBase}-road`}>
        <Label id={`${idBase}-road`} tone="muted">Road · restarts the run</Label>
        <Slider spec={CAR_COUNT_SLIDER} value={config.carCount} hint={density(config.carCount)} onChange={(carCount) => onRestartWith({ carCount: Math.round(carCount) })} />
        <div className={styles.field} role="group" aria-labelledby={`${idBase}-start`}>
          <span id={`${idBase}-start`} className={styles.fieldName}>Start</span>
          <div className={styles.segmented}>
            {STARTS.map((start) => (
              <button
                key={start.value}
                type="button"
                className={styles.button}
                aria-pressed={config.start === start.value}
                onClick={() => onRestartWith({ start: start.value })}
              >
                {start.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.group} aria-labelledby={`${idBase}-drivers`}>
        <Label id={`${idBase}-drivers`} tone="muted">Drivers · changes apply live</Label>
        {DRIVER_ORDER.map((key) => (
          <Slider key={key} spec={DRIVER_SLIDERS[key]} label={LABEL_OVERRIDES[key]} value={config.driver[key]} hint={DRIVER_HINTS[key]} onChange={(si) => onDriver(key, si)} />
        ))}
        <details className={styles.details}>
          <summary>Driver variation</summary>
          <Slider spec={VARIATION_SLIDER} value={config.variation} hint="spread between drivers" onChange={onVariation} />
          <SeedField seed={config.seed} onSeed={(seed) => onRestartWith({ seed })} />
        </details>
      </section>
    </div>
  );
}
