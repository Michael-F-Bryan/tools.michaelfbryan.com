"use client";

import { useEffect, useRef, useState } from "react";

import { anchorMinuteFor, formatClockTime, localMinuteFor, parseClockTime, snapMinute } from "./clock-math";
import { FIELD_CLASS, FIELD_LABEL, PRIMARY_BUTTON } from "./controls";
import { Dial } from "./dial";
import { DEFAULT_ARRANGEMENT } from "./default-arrangement";

import { PeopleEditor } from "./people-editor";
import { searchForArrangement, type ParseResult } from "./serialization";
import { StatusList } from "./status-list";
import { useUrlHydration } from "./use-url-hydration";
import type { Arrangement } from "./types";

const URL_SYNC_DEBOUNCE_MS = 400;

export function Clock() {
  const hydrationResult = useUrlHydration();
  const [arrangement, setArrangement] = useState<Arrangement>(DEFAULT_ARRANGEMENT);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `hydrationResult` starts as a stable "absent" placeholder (matching the
  // server render) and, once mounted in the browser, settles to the real
  // parse of the URL. Applying that single transition here — by comparing
  // against the previously-seen result and adjusting state during render,
  // the same idiom `use-synced-draft.ts` uses in the coordinate-frame
  // visualiser entry — keeps the update out of a `useEffect` body, which
  // `react-hooks/set-state-in-effect` disallows for state-setting effects.
  const [appliedResult, setAppliedResult] = useState<ParseResult | null>(null);
  if (hydrationResult && appliedResult !== hydrationResult) {
    setAppliedResult(hydrationResult);
    if (hydrationResult.kind === "ok") {
      setArrangement(hydrationResult.arrangement);
      setUrlError(null);
    } else if (hydrationResult.kind === "error") {
      setArrangement(DEFAULT_ARRANGEMENT);
      setUrlError(hydrationResult.message);
    } else {
      setArrangement(DEFAULT_ARRANGEMENT);
      setUrlError(null);
    }
  }
  const hydrated = appliedResult !== null;

  // Edits replace the current history entry's URL (never push a new one),
  // debounced so a drag doesn't write on every pointermove tick.
  useEffect(() => {
    if (!hydrated) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      const url = new URL(window.location.href);
      url.search = searchForArrangement(arrangement);
      window.history.replaceState(window.history.state, "", url);
    }, URL_SYNC_DEBOUNCE_MS);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [arrangement, hydrated]);

  async function copyLink() {
    const url = new URL(window.location.href);
    url.search = searchForArrangement(arrangement);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyStatus("Copied the link to this arrangement.");
    } catch {
      setCopyStatus("Couldn't copy the link — copy it from the address bar instead.");
    }
  }

  const referencePerson = arrangement.people.find((person) => person.id === arrangement.referencePersonId)
    ?? arrangement.people.find((person) => person.offsetMinutes === arrangement.referenceOffsetMinutes)
    ?? arrangement.people[0];
  const referenceLocalMinute = localMinuteFor(arrangement.selectedMinuteUtc, referencePerson.offsetMinutes);

  return (
    <div data-clock-ready={hydrated} className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <div className="grid gap-4">
        {urlError ? (
          <div role="alert" className="border border-error bg-error/5 px-4 py-3 text-sm text-ink">
            <p>{urlError}</p>
            <button type="button" className="mt-2 text-sm font-bold underline" onClick={() => setUrlError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        <Dial
          referenceOffsetMinutes={referencePerson.offsetMinutes}
          selectedMinuteUtc={arrangement.selectedMinuteUtc}
          people={arrangement.people}
          onSelect={(selectedMinuteUtc) => setArrangement((prev) => ({ ...prev, selectedMinuteUtc }))}
        />

        <label className="text-sm">
          <span className="block font-bold text-ink">Selected time (reference zone)</span>
          <input
            type="time"
            step={300}
            className="mt-1 min-h-11 border border-rule bg-surface px-3 py-2 text-base sm:min-h-0 sm:py-1.5 sm:text-sm"
            value={formatClockTime(referenceLocalMinute)}
            onChange={(event) => {
              const minute = parseClockTime(event.target.value);
              if (minute === null) return;
              setArrangement((prev) => ({
                ...prev,
                selectedMinuteUtc: anchorMinuteFor(snapMinute(minute), referencePerson.offsetMinutes),
              }));
            }}
          />
        </label>

        <label className="min-w-0">
          <span className={FIELD_LABEL}>Clock shown for</span>
          <select
            id="reference-person"
            className={FIELD_CLASS}
            value={referencePerson.id}
            onChange={(event) => {
              const person = arrangement.people.find((person) => person.id === event.target.value)!;
              setArrangement((prev) => ({ ...prev, referencePersonId: person.id, referenceOffsetMinutes: person.offsetMinutes }));
            }}
          >
            {arrangement.people.map((person) => <option key={person.id} value={person.id}>{person.name || "Unnamed"}</option>)}
          </select>
        </label>

        <div className="grid gap-2">
          <button type="button" className={PRIMARY_BUTTON} onClick={copyLink}>
            Copy link to this arrangement
          </button>
          <p role="status" className="min-h-5 text-sm text-secondary">
            {copyStatus}
          </p>

        </div>
      </div>

      <div className="grid gap-6">
        <section aria-label="Status at the selected time">
          <h2 className="text-lg font-bold text-ink">At the selected time</h2>
          <div className="mt-3">
            <StatusList
              referenceOffsetMinutes={referencePerson.offsetMinutes}
              selectedMinuteUtc={arrangement.selectedMinuteUtc}
              people={arrangement.people}
            />
          </div>
        </section>

        <section aria-label="People">
          <h2 className="text-lg font-bold text-ink">People</h2>
          <div className="mt-3">
            <PeopleEditor people={arrangement.people} onChange={(people) => {
              const reference = people.find((person) => person.id === referencePerson.id) ?? people[0];
              setArrangement((prev) => ({ ...prev, people, referencePersonId: reference.id, referenceOffsetMinutes: reference.offsetMinutes }));
            }} />
          </div>
        </section>
      </div>
    </div>
  );
}
