export type Place = Readonly<{
  id: string;
  name: string;
  category: "Art" | "Museum" | "Library";
  coordinates: readonly [number, number]; // longitude, latitude
  description: string;
  tip: string;
  timezone: string;
  source: string;
  hours: readonly { days: readonly number[]; opens: string; closes: string }[]; // Sunday = 0
}>;

// Curated, not a live venue feed. Hours from venue pages (checked 25 Sep 2026),
// coordinates from OpenStreetMap Nominatim. Holiday exceptions are not encoded.
export const places: readonly Place[] = [
  {
    id: "acmi", name: "ACMI", category: "Museum", coordinates: [144.9690684, -37.8174356],
    description: "A museum of film, television, videogames and art at Fed Square.",
    tip: "General entry is free; some exhibitions and screenings are ticketed.",
    timezone: "Australia/Melbourne", source: "https://www.acmi.net.au/plan-your-visit/",
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "10:00", closes: "17:00" }],
  },
  {
    id: "ngv-australia", name: "NGV Australia", category: "Art", coordinates: [144.9699764, -37.8175803],
    description: "Australian art, including Indigenous and non-Indigenous work, at Fed Square.",
    tip: "General entry is free; special exhibitions may need a ticket.",
    timezone: "Australia/Melbourne", source: "https://www.ngv.vic.gov.au/plan-your-visit/",
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "10:00", closes: "17:00" }],
  },
  {
    id: "ngv-international", name: "NGV International", category: "Art", coordinates: [144.9686548, -37.8229117],
    description: "International art and design on St Kilda Road.",
    tip: "General entry is free; special exhibitions may need a ticket.",
    timezone: "Australia/Melbourne", source: "https://www.ngv.vic.gov.au/plan-your-visit/",
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "10:00", closes: "17:00" }],
  },
  {
    id: "state-library", name: "State Library Victoria", category: "Library", coordinates: [144.9655352, -37.8097696],
    description: "A public library with reading rooms and exhibitions on Swanston Street.",
    tip: "Check the Library site for holiday closures before setting off.",
    timezone: "Australia/Melbourne", source: "https://www.slv.vic.gov.au/visit/opening-hours",
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "10:00", closes: "18:00" }],
  },
];
