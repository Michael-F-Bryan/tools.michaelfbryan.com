import { useState } from "react";

import { cn } from "@/lib/utils";

import { DISCLOSURE_SUMMARY, READONLY_FIELD, SEGMENT_BUTTON, segmentTone, TEXT_FIELD } from "./controls";
import { formatFixed, formatSigned, parseUserNumber } from "./format";
import {
  applyToPoint,
  type LocalConvention,
  invertTransform,
  type Mat3,
  normaliseQuaternion,
  quaternionFromRotation,
  type Quaternion,
  transformFromRotation,
  transpose,
} from "./math";
import { RotationTable, TransformTable } from "./matrix-table";
import type { PoseState } from "./pose";
import { activeOrigin, activeProbe } from "./pose";
import { useSyncedDraft } from "./use-synced-draft";

type OrientationInspectorProps = Readonly<{
  state: PoseState;
  /** The rotation the scene is drawing (the scrubbed pose), which every number here describes. */
  rotation: Mat3;
  focusedStage: 0 | 1 | 2 | 3;
  showProbe: boolean;
  onShowProbeChange: (show: boolean) => void;
  onConventionChange: (convention: LocalConvention) => void;
  onQuaternionCommit: (q: Quaternion) => void;
  onProbeEdit: (field: 0 | 1 | 2, value: number) => void;
  onOriginEdit: (field: 0 | 1 | 2, value: number) => void;
}>;

const LOCAL_NAMES: Record<LocalConvention, readonly [string, string, string]> = {
  ned: ["N", "E", "D"],
  enu: ["E", "N", "U"],
};

function Kicker({ children }: Readonly<{ children: React.ReactNode }>) {
  return <span className="font-mono text-xs font-bold uppercase tracking-label text-accent">{children}</span>;
}

function QuaternionGroup({
  rotation,
  onCommit,
}: Readonly<{ rotation: Mat3; onCommit: (q: Quaternion) => void }>) {
  const [componentOrder, setComponentOrder] = useState<"wxyz" | "xyzw">("wxyz");
  const derived = quaternionFromRotation(rotation);
  const signature = `${derived.w.toFixed(6)},${derived.x.toFixed(6)},${derived.y.toFixed(6)},${derived.z.toFixed(6)}`;

  // Adjusting state when a prop changes: compare against the previous
  // signature during render (not in an effect) and reset the draft then.
  const [previousSignature, setPreviousSignature] = useState(signature);
  const [draft, setDraft] = useState({ w: derived.w, x: derived.x, y: derived.y, z: derived.z });
  if (previousSignature !== signature) {
    setPreviousSignature(signature);
    setDraft({ w: derived.w, x: derived.x, y: derived.y, z: derived.z });
  }
  const [note, setNote] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  function setField(field: keyof Quaternion, text: string) {
    const value = Number(text);
    setDraft((prev) => ({ ...prev, [field]: text === "" ? NaN : value }));
  }

  function commit() {
    const result = normaliseQuaternion(draft);
    if (!result.ok) {
      setNote({
        kind: "error",
        text: result.reason === "zero" ? "A zero quaternion has no direction. Kept the last valid pose." : "Enter finite numbers. Kept the last valid pose.",
      });
      setDraft({ w: derived.w, x: derived.x, y: derived.y, z: derived.z });
      return;
    }
    onCommit(result.quaternion);
    if (Math.abs(result.originalNorm - 1) > 1e-6) {
      setNote({ kind: "info", text: `Normalised from |q| = ${result.originalNorm.toFixed(4)}` });
    } else {
      setNote(null);
    }
  }

  const order: readonly (keyof Quaternion)[] = componentOrder === "wxyz" ? ["w", "x", "y", "z"] : ["x", "y", "z", "w"];

  return (
    <div className="mt-2">
      <div className="inline-flex border border-rule" role="group" aria-label="Component order">
        {(["wxyz", "xyzw"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={componentOrder === candidate}
            onClick={() => setComponentOrder(candidate)}
            className={cn(SEGMENT_BUTTON, "font-mono text-xs", segmentTone(componentOrder === candidate))}
          >
            {candidate === "wxyz" ? "w x y z" : "x y z w"}
          </button>
        ))}
      </div>
      <div
        className="mt-3 flex flex-wrap gap-3"
        onBlur={(event) => {
          // Commit once focus leaves the whole group of four fields, not on
          // every hop between them, so w/x/y/z commit together.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
        }}
      >
        {order.map((field) => (
          <label key={field} className="flex items-center gap-1 font-mono text-xs text-muted">
            {field}
            <input
              type="text"
              inputMode="decimal"
              aria-label={field}
              value={Number.isNaN(draft[field]) ? "" : draft[field]}
              onChange={(event) => setField(field, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
              }}
              className={cn(TEXT_FIELD, "w-20")}
            />
          </label>
        ))}
      </div>
      <p
        role={note?.kind === "error" ? "alert" : "status"}
        className={cn("mt-2 max-w-[38rem] text-sm", note?.kind === "error" ? "text-error" : "text-muted")}
      >
        {note?.text ??
          "Same rotation as R. Non-unit input is normalised on commit; a zero or non-finite quaternion is rejected. Committing one finishes the sequence."}
      </p>
    </div>
  );
}

export function OrientationInspector({
  state,
  rotation,
  focusedStage,
  showProbe,
  onShowProbeChange,
  onConventionChange,
  onQuaternionCommit,
  onProbeEdit,
  onOriginEdit,
}: OrientationInspectorProps) {
  const [rInverted, setRInverted] = useState(false);
  const [tInverted, setTInverted] = useState(false);

  const origin = activeOrigin(state);
  const probe = activeProbe(state);
  const names = LOCAL_NAMES[state.convention];
  const bodyNames = ["x", "y", "z"] as const;
  // Row headers stay the bare letter; column headers get a "body" prefix so
  // a body x/y/z column can never be confused with an ECEF X/Y/Z one.
  const bodyColumnHeaders = ["body x", "body y", "body z"] as const;
  const scrubbed = focusedStage < 3;
  const local = state.convention.toUpperCase();

  const displayed = rInverted ? transpose(rotation) : rotation;
  const rColumnHeaders: readonly [string, string, string] = rInverted ? names : bodyColumnHeaders;
  const rRowHeaders: readonly [string, string, string] = rInverted ? bodyNames : names;
  const rName = rInverted ? `R[body←${state.convention}]` : `R[${state.convention}←body]`;
  const rTakes = rInverted ? `${local} coordinates` : "body coordinates";
  const rGives = rInverted ? "body coordinates" : `${local} coordinates`;
  const rRows = displayed.map((row) => row.map((v) => formatSigned(v)) as unknown as readonly [string, string, string]);

  const bodyTransform = transformFromRotation({ to: state.convention, from: "body" as const, m: rotation }, origin);
  const localFromBody = tInverted ? invertTransform(bodyTransform) : bodyTransform;
  const tName = tInverted ? `T[body←${state.convention}]` : `T[${state.convention}←body]`;
  const tTakes = tInverted ? `${local} coordinates of a point, with a fourth coordinate of 1` : "body coordinates of a point, with a fourth coordinate of 1";
  const tGives = tInverted ? "body coordinates" : `${local} coordinates`;
  const tColumnHeaders: readonly [string, string, string, string] = tInverted ? [...names, "origin"] : [...bodyColumnHeaders, "origin"];
  const tRowHeaders: readonly [string, string, string] = tInverted ? bodyNames : names;
  const tRows = localFromBody.m.slice(0, 3).map(
    (row) => row.map((v) => formatSigned(v, 3)) as unknown as readonly [string, string, string, string],
  );

  const probeBody = applyToPoint(invertTransform(bodyTransform), probe);

  return (
    <div className="min-w-0">
      <div className="px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Kicker>Frame</Kicker>
          <span className="font-mono text-xs text-muted">shared with the position mode</span>
        </div>
        <div className="mt-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
          <span className="text-sm text-secondary">Local</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex border border-rule" role="group" aria-label="Local frame convention">
              {(["ned", "enu"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={state.convention === candidate}
                  onClick={() => onConventionChange(candidate)}
                  className={cn(SEGMENT_BUTTON, "text-xs uppercase", segmentTone(state.convention === candidate))}
                >
                  {candidate.toUpperCase()}
                </button>
              ))}
            </span>
            <span className="font-mono text-xs text-muted">tangent frame at the anchor</span>
          </span>
          <span className="text-sm text-secondary">Body</span>
          <span className="font-mono text-xs text-muted">x forward · y right · z down</span>
        </div>
      </div>

      <div className="border-t border-rule-subtle px-4 py-4 sm:px-6" data-body-axes-readout>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Kicker>Body axes in {local}</Kicker>
          <span className="font-mono text-xs text-muted">the columns of R[{state.convention}←body]</span>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-sm tabular-nums">
          {bodyNames.map((bodyName, column) => (
            <div key={bodyName} className="contents">
              <dt className="font-bold text-accent">body {bodyName}</dt>
              <dd className="flex flex-wrap gap-x-3 text-secondary">
                {names.map((localName, row) => (
                  <span key={localName}>
                    <span className="text-muted">{localName}</span> {formatSigned(rotation[row][column], 3)}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        {scrubbed ? (
          <p role="status" className="mt-3 max-w-[38rem] text-sm text-secondary">
            These numbers describe the body as drawn: {focusedStage === 0 ? "at the start, before any rotation" : `after stage ${focusedStage} of 3`}.
            Scrub to the end for the full rotation.
          </p>
        ) : null}
      </div>

      <details className="border-t border-rule-subtle px-4 py-2 sm:px-6">
        <summary className={DISCLOSURE_SUMMARY}>
          <Kicker>Rotation matrix</Kicker>
          <span className="text-sm text-muted">{rName} · 3×3 · invert and copy</span>
        </summary>
        <div className="mt-2 pb-2">
          <RotationTable
            name={rName}
            takes={rTakes}
            gives={rGives}
            columnHeaders={rColumnHeaders}
            rowHeaders={rRowHeaders}
            rows={rRows}
            ariaLabel={`Rotation matrix, currently showing ${rName}`}
            onInvert={() => setRInverted((v) => !v)}
            invertLabel={rInverted ? `Invert → R[${state.convention}←body]` : `Invert → R[body←${state.convention}]`}
            copyText={`${rName}\n${displayed.map((row) => row.map((v) => formatSigned(v)).join("  ")).join("\n")}`}
          />
        </div>
      </details>

      <details className="border-t border-rule-subtle px-4 py-2 sm:px-6">
        <summary className={DISCLOSURE_SUMMARY}>
          <Kicker>Quaternion</Kicker>
          <span className="text-sm text-muted">the same rotation as four numbers · editable</span>
        </summary>
        <div className="pb-2">
          <QuaternionGroup rotation={rotation} onCommit={onQuaternionCommit} />
        </div>
      </details>

      <details
        className="border-t border-rule-subtle px-4 py-2 sm:px-6"
        open={showProbe}
        onToggle={(event) => onShowProbeChange(event.currentTarget.open)}
      >
        <summary className={DISCLOSURE_SUMMARY}>
          <Kicker>Point P</Kicker>
          <span className="text-sm text-muted">one point, two descriptions · also draws P in the scene</span>
        </summary>
        <div className="mt-2 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-y-2 pb-2">
          <span className="text-sm text-secondary">P in {local}</span>
          <span className="flex flex-wrap gap-3">
            {names.map((name, index) => (
              <label key={name} className="flex items-center gap-1 font-mono text-xs text-muted">
                {name}
                <NumberField value={probe[index]} onCommit={(v) => onProbeEdit(index as 0 | 1 | 2, v)} label={`local ${name}`} />
              </label>
            ))}
            <span className="font-mono text-xs text-muted">m</span>
          </span>
          <span className="text-sm text-secondary">P in body</span>
          <span className="flex flex-wrap gap-3">
            {bodyNames.map((name, index) => (
              <label key={name} className="flex items-center gap-1 font-mono text-xs text-muted">
                {name}
                <input type="text" readOnly aria-label={`body ${name}`} value={formatFixed(probeBody[index], 3)} className={cn(READONLY_FIELD, "w-20")} />
              </label>
            ))}
            <span className="font-mono text-xs text-muted">m</span>
          </span>
          <p className="col-span-2 mt-1 max-w-[38rem] text-sm text-muted">
            Body coordinates are R[body←{local}] · (P − origin). Turn the body and the {local} triple stays put while the
            body triple changes.
          </p>
        </div>
      </details>

      <details className="border-t border-rule-subtle px-4 py-2 sm:px-6">
        <summary className={DISCLOSURE_SUMMARY}>
          <Kicker>Pose T</Kicker>
          <span className="text-sm text-muted">4×4 · carries R and the body origin</span>
        </summary>
        <div className="mt-2 pb-2">
          <TransformTable
            name={tName}
            takes={tTakes}
            gives={tGives}
            columnHeaders={tColumnHeaders}
            rowHeaders={tRowHeaders}
            rows={tRows}
            ariaLabel={`Homogeneous transform, currently showing ${tName}`}
            onInvert={() => setTInverted((v) => !v)}
            invertLabel={tInverted ? `Invert → T[${state.convention}←body]` : `Invert → T[body←${state.convention}]`}
            invertNote="rotation transposed, origin becomes −Rᵀ·t"
            copyText={`${tName}\n${localFromBody.m.map((row) => row.map((v) => formatSigned(v, 3)).join("  ")).join("\n")}`}
          />
          {!tInverted ? (
            <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
              <span className="text-sm text-secondary">Origin</span>
              <span className="flex flex-wrap gap-3">
                {names.map((name, index) => (
                  <label key={name} className="flex items-center gap-1 font-mono text-xs text-muted">
                    {name}
                    <NumberField value={origin[index]} onCommit={(v) => onOriginEdit(index as 0 | 1 | 2, v)} label={`origin ${name}`} />
                  </label>
                ))}
                <span className="font-mono text-xs text-muted">m · body origin in {local}</span>
              </span>
            </div>
          ) : null}
          <p className="mt-3 max-w-[38rem] text-sm text-muted">R never becomes T; T contains R.</p>
        </div>
      </details>
    </div>
  );
}

function NumberField({
  value,
  onCommit,
  label,
}: Readonly<{ value: number; onCommit: (value: number) => void; label: string }>) {
  const [draft, setDraft, resetDraft] = useSyncedDraft(value.toFixed(2));

  function commit() {
    const parsed = parseUserNumber(draft);
    if (parsed === null) {
      resetDraft();
      return;
    }
    onCommit(parsed);
  }

  return (
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
      className={cn(TEXT_FIELD, "w-20")}
    />
  );
}
