"use client";

import { formatClockTime, snapMinute, wrapMinute } from "./clock-math";
import { ColorSwatches } from "./color-swatches";
import { FIELD_CLASS, FIELD_HINT, FIELD_LABEL, LINK_BUTTON, SECONDARY_BUTTON } from "./controls";
import { OffsetField } from "./offset-field";
import { MAX_NAME_LENGTH, MAX_PEOPLE, MAX_SPANS_PER_PERSON } from "./serialization";
import { MINUTES_PER_DAY, PALETTE, createPerson, createSpan, type Person } from "./types";

export type PeopleEditorProps = Readonly<{
  people: readonly Person[];
  onChange: (people: readonly Person[]) => void;
}>;

function recomputeSpan(startMinute: number, endWallClock: number): { startMinute: number; endMinute: number } {
  return { startMinute, endMinute: endWallClock <= startMinute ? endWallClock + MINUTES_PER_DAY : endWallClock };
}

export function PeopleEditor({ people, onChange }: PeopleEditorProps) {
  function updatePerson(id: string, patch: Partial<Omit<Person, "id" | "spans">>) {
    onChange(people.map((person) => (person.id === id ? { ...person, ...patch } : person)));
  }

  function removePerson(id: string) {
    onChange(people.filter((person) => person.id !== id));
  }

  function addPerson() {
    if (people.length >= MAX_PEOPLE) return;
    const nextColor = PALETTE.find((swatch) => !people.some((person) => person.color.toLowerCase() === swatch.hex.toLowerCase()))?.hex;
    if (!nextColor) return;
    onChange([...people, createPerson({ name: `Person ${people.length + 1}`, offsetMinutes: 0, color: nextColor, spans: [createSpan(540, 1020)] })]);
  }

  function addSpan(personId: string) {
    onChange(
      people.map((person) =>
        person.id === personId && person.spans.length < MAX_SPANS_PER_PERSON
          ? { ...person, spans: [...person.spans, createSpan(540, 1020)] }
          : person,
      ),
    );
  }

  function updateSpan(personId: string, spanId: string, patch: { startMinute: number } | { endWallClock: number }) {
    onChange(
      people.map((person) => {
        if (person.id !== personId) return person;
        return {
          ...person,
          spans: person.spans.map((span) => {
            if (span.id !== spanId) return span;
            if ("startMinute" in patch) {
              return { ...span, ...recomputeSpan(patch.startMinute, wrapMinute(span.endMinute)) };
            }
            return { ...span, ...recomputeSpan(span.startMinute, patch.endWallClock) };
          }),
        };
      }),
    );
  }

  function removeSpan(personId: string, spanId: string) {
    onChange(
      people.map((person) => (person.id === personId ? { ...person, spans: person.spans.filter((span) => span.id !== spanId) } : person)),
    );
  }

  return (
    <div className="grid gap-5">
      {people.map((person) => (
        <fieldset key={person.id} className="grid min-w-0 gap-3 border border-rule-subtle bg-surface p-4">
          <div className="flex items-end justify-between gap-3">
            <label className="min-w-0 flex-1">
              <span className={FIELD_LABEL}>Name</span>
              <input
                type="text"
                className={FIELD_CLASS}
                value={person.name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => updatePerson(person.id, { name: event.target.value })}
              />
            </label>
            <button
              type="button"
              className={LINK_BUTTON}
              onClick={() => removePerson(person.id)}
              disabled={people.length <= 1}
              aria-label={`Remove ${person.name || "this person"}`}
            >
              Remove
            </button>
          </div>

          <OffsetField
            idPrefix={`offset-${person.id}`}
            label="Timezone"
            value={person.offsetMinutes}
            onChange={(offsetMinutes) => updatePerson(person.id, { offsetMinutes })}
          />

          <ColorSwatches label={`Colour for ${person.name || "this person"}`} value={person.color} unavailable={people.filter((other) => other.id !== person.id).map((other) => other.color)} onChange={(color) => updatePerson(person.id, { color })} />

          <div className="grid gap-2">
            <span className={FIELD_LABEL}>Available local spans</span>
            {person.spans.map((span) => {
              const crossesMidnight = span.endMinute > MINUTES_PER_DAY;
              return (
                <div key={span.id} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-sm">
                    <span className="text-muted">From</span>
                    <input
                      type="time"
                      step={300}
                      className="min-h-11 border border-rule bg-surface px-2 py-1 text-sm sm:min-h-0"
                      value={formatClockTime(span.startMinute)}
                      onChange={(event) => {
                        const minute = event.target.valueAsNumber;
                        if (!Number.isFinite(minute)) return;
                        updateSpan(person.id, span.id, { startMinute: snapMinute(minute / 60000) });
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <span className="text-muted">until</span>
                    <input
                      type="time"
                      step={300}
                      className="min-h-11 border border-rule bg-surface px-2 py-1 text-sm sm:min-h-0"
                      value={formatClockTime(span.endMinute)}
                      onChange={(event) => {
                        const minute = event.target.valueAsNumber;
                        if (!Number.isFinite(minute)) return;
                        updateSpan(person.id, span.id, { endWallClock: snapMinute(minute / 60000) });
                      }}
                    />
                  </label>
                  {crossesMidnight ? <span className="text-xs text-muted">(crosses into the next day)</span> : null}
                  <button
                    type="button"
                    className={LINK_BUTTON}
                    onClick={() => removeSpan(person.id, span.id)}
                    aria-label="Remove this span"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className={SECONDARY_BUTTON + " w-fit"}
              onClick={() => addSpan(person.id)}
              disabled={person.spans.length >= MAX_SPANS_PER_PERSON}
            >
              Add a span
            </button>
            {person.spans.length >= MAX_SPANS_PER_PERSON ? <p className={FIELD_HINT}>Up to {MAX_SPANS_PER_PERSON} spans per person.</p> : null}
          </div>
        </fieldset>
      ))}

      <button type="button" className={SECONDARY_BUTTON + " w-fit"} onClick={addPerson} disabled={people.length >= MAX_PEOPLE}>
        Add a person
      </button>
      {people.length >= MAX_PEOPLE ? <p className={FIELD_HINT}>Up to {MAX_PEOPLE} people.</p> : null}
    </div>
  );
}
