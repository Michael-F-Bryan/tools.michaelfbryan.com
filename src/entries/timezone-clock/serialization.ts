/**
 * The clock's entire state round-trips through a single query parameter so
 * a URL is a complete, re-editable snapshot. The wire format is deliberately
 * separate from the in-memory `Arrangement`/`Person`/`Span` types: ids are a
 * local React-key concern and are never serialised, which keeps links
 * shorter and means two different sessions loading the same link don't
 * fight over identity.
 */
import { MINUTES_PER_DAY, type Arrangement, type Person, type Span, createId } from "./types";

const SCHEMA_VERSION = 1;
export const PARAM_NAME = "tz";

// Exported so the editor UI can enforce the exact same limits the URL
// parser accepts — every state the editor can reach must also reopen from
// its own shared link.
export const MAX_PEOPLE = 12;
export const MAX_SPANS_PER_PERSON = 12;
export const MAX_NAME_LENGTH = 60;
const MIN_OFFSET = -720;
const MAX_OFFSET = 840;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type WireSpan = readonly [number, number];
type WirePerson = Readonly<{ n: string; o: number; c: string; s: readonly WireSpan[] }>;
type WireArrangement = Readonly<{ v: number; r: number; t: number; p: readonly WirePerson[] }>;

function toWire(arrangement: Arrangement): WireArrangement {
  return {
    v: SCHEMA_VERSION,
    r: arrangement.referenceOffsetMinutes,
    t: arrangement.selectedMinuteUtc,
    p: arrangement.people.map((person) => ({
      n: person.name,
      o: person.offsetMinutes,
      c: person.color,
      s: person.spans.map((span) => [span.startMinute, span.endMinute] as const),
    })),
  };
}

export function serializeArrangement(arrangement: Arrangement): string {
  return JSON.stringify(toWire(arrangement));
}

/** The full `?tz=...` query string (including the leading `?`) for a given arrangement. */
export function searchForArrangement(arrangement: Arrangement): string {
  const params = new URLSearchParams();
  params.set(PARAM_NAME, serializeArrangement(arrangement));
  return `?${params.toString()}`;
}

export type ParseResult =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "ok"; arrangement: Arrangement }>
  | Readonly<{ kind: "error"; message: string }>;

const UNREADABLE = "This link's arrangement data couldn't be read, so this starts from the example arrangement instead.";

export function parseArrangementFromSearch(search: string): ParseResult {
  const params = new URLSearchParams(search);
  const raw = params.get(PARAM_NAME);
  if (raw === null) return { kind: "absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "error", message: UNREADABLE };
  }

  const arrangement = validateArrangement(parsed);
  if (!arrangement) return { kind: "error", message: UNREADABLE };
  return { kind: "ok", arrangement };
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.trunc(value) === value;
}

function validateArrangement(value: unknown): Arrangement | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.v !== SCHEMA_VERSION) return null;
  if (!isFiniteInt(record.r) || record.r < MIN_OFFSET || record.r > MAX_OFFSET) return null;
  if (!isFiniteInt(record.t) || record.t < 0 || record.t >= MINUTES_PER_DAY) return null;
  if (!Array.isArray(record.p) || record.p.length < 1 || record.p.length > MAX_PEOPLE) return null;

  const people: Person[] = [];
  for (const rawPerson of record.p) {
    const person = validatePerson(rawPerson);
    if (!person) return null;
    people.push(person);
  }

  return { referenceOffsetMinutes: record.r, selectedMinuteUtc: record.t, people };
}

function validatePerson(value: unknown): Person | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.n !== "string" || record.n.length > MAX_NAME_LENGTH) return null;
  if (!isFiniteInt(record.o) || record.o < MIN_OFFSET || record.o > MAX_OFFSET) return null;
  if (typeof record.c !== "string" || !HEX_COLOR.test(record.c)) return null;
  if (!Array.isArray(record.s) || record.s.length > MAX_SPANS_PER_PERSON) return null;

  const spans: Span[] = [];
  for (const rawSpan of record.s) {
    const span = validateSpan(rawSpan);
    if (!span) return null;
    spans.push(span);
  }

  return { id: createId("person"), name: record.n, offsetMinutes: record.o, color: record.c, spans };
}

function validateSpan(value: unknown): Span | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [start, end] = value;
  if (!isFiniteInt(start) || start < 0 || start >= MINUTES_PER_DAY) return null;
  if (!isFiniteInt(end) || end <= start || end > start + MINUTES_PER_DAY) return null;
  return { id: createId("span"), startMinute: start, endMinute: end };
}
