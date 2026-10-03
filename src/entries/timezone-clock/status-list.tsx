import { formatClockTime, formatOffset, localMinuteFor, minuteInSpan, relativeDayOffset } from "./clock-math";
import type { Person } from "./types";

/**
 * Offsets span up to 28 hours apart, so the day delta isn't always -1/0/1 —
 * e.g. UTC+14 vs UTC-12 can be two full days apart depending on the instant.
 */
function dayOffsetLabel(offset: number): string | null {
  if (offset === 0) return null;
  if (offset === 1) return "next day";
  if (offset === -1) return "previous day";
  const direction = offset > 0 ? "ahead" : "behind";
  return `${Math.abs(offset)} days ${direction}`;
}

export type StatusListProps = Readonly<{
  referenceOffsetMinutes: number;
  selectedMinuteUtc: number;
  people: readonly Person[];
}>;

export function StatusList({ referenceOffsetMinutes, selectedMinuteUtc, people }: StatusListProps) {
  return (
    <ul className="grid gap-2" aria-label="Each person's status at the selected time">
      {people.map((person) => {
        const localMinute = localMinuteFor(selectedMinuteUtc, person.offsetMinutes);
        const available = person.spans.some((span) => minuteInSpan(localMinute, span));
        const dayOffset = relativeDayOffset(selectedMinuteUtc, person.offsetMinutes, referenceOffsetMinutes);

        return (
          <li key={person.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border border-rule-subtle bg-surface px-3 py-2">
            <div className="flex items-center gap-2 overflow-hidden">
              <span aria-hidden="true" className="size-3 flex-none" style={{ backgroundColor: person.color }} />
              <span className="truncate font-bold text-ink">{person.name || "Unnamed"}</span>
              <span className="flex-none text-sm text-muted">{formatOffset(person.offsetMinutes)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-mono text-ink">{formatClockTime(localMinute)}</span>
              <span className={available ? "font-bold text-success" : "font-bold text-error"}>
                {available ? "Available" : "Unavailable"}
              </span>
              {dayOffsetLabel(dayOffset) ? <span className="text-muted">({dayOffsetLabel(dayOffset)})</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
