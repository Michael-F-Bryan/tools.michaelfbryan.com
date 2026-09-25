export type Place = Readonly<{
  id: string;
  name: string;
  category: "Art" | "Museum" | "Library" | "Outdoors" | "Books" | "Food" | "Cinema";
  coordinates: readonly [number, number]; // longitude, latitude
  description: string;
  tip: string;
  timezone: string;
  source: string;
  hours: readonly { days: readonly number[]; opens: string; closes: string }[] | null; // Sunday = 0; null = no dependable hours
  hoursNote?: string;
  exceptions?: Readonly<Record<string, readonly { days: readonly number[]; opens: string; closes: string }[] | null>>;
}>;

// Curated, not a live venue feed. Hours from venue pages (checked 25 Sep 2026),
// coordinates from OpenStreetMap Nominatim. Holiday exceptions are not generally encoded.
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
  {
    id: "melbourne-museum", name: "Melbourne Museum", category: "Museum", coordinates: [144.9723488, -37.8032298],
    description: "Natural history, First Peoples stories and changing exhibitions beside Carlton Gardens.",
    tip: "General entry is ticketed for adults; some temporary exhibitions cost extra.",
    timezone: "Australia/Melbourne", source: "https://museumsvictoria.com.au/melbournemuseum/plan-your-visit/",
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "09:00", closes: "17:00" }],
  },
  {
    id: "carlton-gardens", name: "Carlton Gardens", category: "Outdoors", coordinates: [144.9712331, -37.8062583],
    description: "Walk past the Royal Exhibition Building, fountains, lakes and tree-lined paths.",
    tip: "The City of Melbourne has a self-guided heritage walk; this is an outdoor stop, not entry to the Exhibition Building.",
    timezone: "Australia/Melbourne", source: "https://www.melbourne.vic.gov.au/carlton-gardens",
    hours: null, hoursNote: "Public garden; access hours not published",
  },
  {
    id: "imax-melbourne", name: "IMAX Melbourne", category: "Cinema", coordinates: [144.9706364, -37.8035056],
    description: "Large-format films next to Melbourne Museum.",
    tip: "Only worth a detour if a session fits your window; check the film times first.",
    timezone: "Australia/Melbourne", source: "https://imaxmelbourne.com.au/about_imax/contact_us/",
    hours: null, hoursNote: "Opens around scheduled screenings; check sessions",
  },
  {
    id: "old-melbourne-gaol", name: "Old Melbourne Gaol", category: "Museum", coordinates: [144.9652682, -37.8078185],
    description: "Explore the historic gaol and its self-guided exhibition on Russell Street.",
    tip: "Ticketed entry; the venue recommends arriving well before closing.",
    timezone: "Australia/Melbourne", source: "https://www.oldmelbournegaol.com.au/visit-and-contact/",
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "10:00", closes: "17:00" }],
  },
  {
    id: "readings-carlton", name: "Readings Carlton", category: "Books", coordinates: [144.967187, -37.798052],
    description: "Browse an independent bookshop on Lygon Street.",
    tip: "Browse local writing and new releases; check holiday hours before visiting.",
    timezone: "Australia/Melbourne", source: "https://www.readings.com.au/shops/carlton",
    exceptions: { "2026-09-25": [{ days: [5], opens: "10:00", closes: "21:00" }] },
    hours: [
      { days: [1, 2, 3, 4], opens: "09:00", closes: "21:00" },
      { days: [5, 6], opens: "09:00", closes: "22:00" },
      { days: [0], opens: "10:00", closes: "21:00" },
    ],
  },
  {
    id: "lune-fitzroy", name: "Lune Fitzroy", category: "Food", coordinates: [144.979943, -37.7959622],
    description: "Croissants and pastries from the Fitzroy bakery on Rose Street.",
    tip: "Popular items can sell out before the listed closing time; public holidays open from 8am.",
    timezone: "Australia/Melbourne", source: "https://lunecroissanterie.com/contact/",
    exceptions: { "2026-09-25": [{ days: [5], opens: "08:00", closes: "15:00" }] },
    hours: [
      { days: [1, 2, 3, 4, 5], opens: "07:30", closes: "15:00" },
      { days: [0, 6], opens: "08:00", closes: "15:00" },
    ],
  },
];
