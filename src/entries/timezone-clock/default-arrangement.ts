import { PALETTE, type Arrangement } from "./types";

/**
 * A generic, synthetic starting example — city labels standing in for
 * people, not anyone real — that demonstrates overlap across three offsets,
 * a second span, and an overnight on-call span in one screen.
 *
 * Ids here are static (not `createId`) so this object is identical between
 * the server render and the client's first paint; only post-hydration edits
 * use the counter-based ids.
 */
export const DEFAULT_ARRANGEMENT: Arrangement = {
  referenceOffsetMinutes: 480, // AWST, UTC+8
  selectedMinuteUtc: 60, // 09:00 AWST
  people: [
    {
      id: "person-perth",
      name: "Perth",
      offsetMinutes: 480,
      color: PALETTE[0].hex,
      spans: [{ id: "span-perth-1", startMinute: 540, endMinute: 1020 }], // 09:00–17:00
    },
    {
      id: "person-london",
      name: "London",
      offsetMinutes: 0,
      color: PALETTE[1].hex,
      spans: [{ id: "span-london-1", startMinute: 540, endMinute: 1050 }], // 09:00–17:30
    },
    {
      id: "person-new-york",
      name: "New York",
      offsetMinutes: -300,
      color: PALETTE[2].hex,
      spans: [
        { id: "span-new-york-1", startMinute: 480, endMinute: 990 }, // 08:00–16:30
        { id: "span-new-york-2", startMinute: 1320, endMinute: 1560 }, // 22:00–02:00 on-call, crosses midnight
      ],
    },
  ],
};
