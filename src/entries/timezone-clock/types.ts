/**
 * Domain types for the timezone availability clock. Offsets are fixed
 * minutes from UTC chosen explicitly by whoever is editing an entry — there
 * is no IANA timezone database and no date/DST logic, so "PST" and "PDT"
 * (for example) are just two differently labelled fixed offsets a person
 * picks between by hand depending on the time of year.
 */

export type Span = Readonly<{
  id: string;
  /** Minutes after local midnight, 0–1439, inclusive start. */
  startMinute: number;
  /**
   * Minutes after local midnight, exclusive end. Can exceed 1439 (up to
   * `startMinute + 1440`) to represent a span that crosses midnight.
   */
  endMinute: number;
}>;

export type Person = Readonly<{
  id: string;
  name: string;
  /** Fixed minutes offset from UTC, e.g. 480 for AWST (UTC+8). */
  offsetMinutes: number;
  /** One of `PALETTE`'s hex values. */
  color: string;
  spans: readonly Span[];
}>;

export type Arrangement = Readonly<{
  referencePersonId?: string;
  /** The offset whose local midnight sits at the top of the dial. */
  referenceOffsetMinutes: number;
  /** The selected instant, as a UTC time-of-day in 0–1439 minutes. */
  selectedMinuteUtc: number;
  people: readonly Person[];
}>;

export const MINUTES_PER_DAY = 1440;

export type ColorSwatch = Readonly<{ id: string; name: string; hex: string }>;

/** Okabe–Ito categorical palette: distinguishable under common colour-vision deficiencies. */
export const PALETTE: readonly ColorSwatch[] = [
  { id: "blue", name: "Blue", hex: "#0072B2" },
  { id: "orange", name: "Orange", hex: "#E69F00" },
  { id: "green", name: "Green", hex: "#009E73" },
  { id: "vermillion", name: "Vermillion", hex: "#D55E00" },
  { id: "pink", name: "Pink", hex: "#CC79A7" },
  { id: "sky", name: "Sky", hex: "#56B4E9" },
  { id: "yellow", name: "Yellow", hex: "#F0E442" },
  { id: "grey", name: "Grey", hex: "#999999" },
] as const;

export type OffsetPreset = Readonly<{ label: string; offsetMinutes: number }>;

/** A representative spread of fixed offsets, including named half/quarter-hour and DST-pair examples. */
export const OFFSET_PRESETS: readonly OffsetPreset[] = [
  { label: "UTC−12:00 — Baker Island", offsetMinutes: -720 },
  { label: "UTC−11:00 — Samoa Standard (SST)", offsetMinutes: -660 },
  { label: "UTC−10:00 — Hawaii Standard (HST)", offsetMinutes: -600 },
  { label: "UTC−09:30 — Marquesas", offsetMinutes: -570 },
  { label: "UTC−09:00 — Alaska Standard (AKST)", offsetMinutes: -540 },
  { label: "UTC−08:00 — US Pacific Standard (PST)", offsetMinutes: -480 },
  { label: "UTC−07:00 — US Pacific Daylight (PDT) / Mountain Standard (MST)", offsetMinutes: -420 },
  { label: "UTC−06:00 — US Central Standard (CST) / Mountain Daylight (MDT)", offsetMinutes: -360 },
  { label: "UTC−05:00 — US Eastern Standard (EST) / Central Daylight (CDT)", offsetMinutes: -300 },
  { label: "UTC−04:00 — US Eastern Daylight (EDT)", offsetMinutes: -240 },
  { label: "UTC−03:30 — Newfoundland Standard (NST)", offsetMinutes: -210 },
  { label: "UTC−03:00 — Argentina (ART)", offsetMinutes: -180 },
  { label: "UTC+00:00 — UTC / Western European (GMT)", offsetMinutes: 0 },
  { label: "UTC+01:00 — Central European Standard (CET)", offsetMinutes: 60 },
  { label: "UTC+02:00 — Central European Summer (CEST)", offsetMinutes: 120 },
  { label: "UTC+03:00 — Moscow (MSK)", offsetMinutes: 180 },
  { label: "UTC+05:00 — Pakistan (PKT)", offsetMinutes: 300 },
  { label: "UTC+05:30 — India (IST)", offsetMinutes: 330 },
  { label: "UTC+05:45 — Nepal (NPT)", offsetMinutes: 345 },
  { label: "UTC+08:00 — Australian Western Standard (AWST)", offsetMinutes: 480 },
  { label: "UTC+09:30 — Australian Central Standard (ACST)", offsetMinutes: 570 },
  { label: "UTC+10:00 — Australian Eastern Standard (AEST)", offsetMinutes: 600 },
  { label: "UTC+10:30 — Lord Howe Island Standard", offsetMinutes: 630 },
  { label: "UTC+11:00 — Australian Eastern Daylight (AEDT)", offsetMinutes: 660 },
  { label: "UTC+12:00 — New Zealand Standard (NZST)", offsetMinutes: 720 },
  { label: "UTC+12:45 — Chatham Islands Standard", offsetMinutes: 765 },
  { label: "UTC+13:00 — New Zealand Daylight (NZDT)", offsetMinutes: 780 },
  { label: "UTC+14:00 — Kiribati (Line Islands)", offsetMinutes: 840 },
] as const;

export const MIN_OFFSET_MINUTES = -720;
export const MAX_OFFSET_MINUTES = 840;

let counter = 0;

/** A React-key-stable id for client-created people/spans. Never serialised into the URL. */
export function createId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

const DEFAULT_SPAN_LENGTH = 1020 - 540;

export function createSpan(startMinute: number, endMinute: number = startMinute + DEFAULT_SPAN_LENGTH): Span {
  return { id: createId("span"), startMinute, endMinute };
}

export function createPerson(partial: Omit<Person, "id">): Person {
  return { id: createId("person"), ...partial };
}
