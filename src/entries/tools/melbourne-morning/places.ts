export type Place = Readonly<{
  id: string;
  name: string;
  category: "Art" | "Museum" | "Library" | "Outdoors" | "Books" | "Food" | "Cinema" | "Wellness";
  coordinates: readonly [number, number]; // longitude, latitude
  description: string;
  tip: string;
  timezone: string;
  source: string;
  hours: readonly { days: readonly number[]; opens: string; closes: string }[] | null; // Sunday = 0; null = no dependable hours
  hoursNote?: string;
  uncertainDates?: readonly string[]; // no trustworthy special-date hours; do not infer from the weekly schedule
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
    uncertainDates: ["2026-09-25"],
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
  {
    id: "brunswick-street-gallery", name: "Brunswick Street Gallery", category: "Art", coordinates: [144.978782, -37.7976732],
    description: "Independent exhibitions by contemporary Australian artists in Fitzroy.",
    tip: "Upstairs access only; the gallery also closes during exhibition installs. Check current shows first.",
    timezone: "Australia/Melbourne", source: "https://brunswickstreetgallery.com.au/pages/contact",
    hours: [
      { days: [2, 3, 4, 5, 6], opens: "10:00", closes: "17:00" },
      { days: [0], opens: "11:00", closes: "16:00" },
    ],
  },
  {
    id: "heartattack-and-vine", name: "Heartattack and Vine", category: "Food", coordinates: [144.9672504, -37.7976471],
    description: "Walk-in Carlton café and neighbourhood bar on Lygon Street.",
    tip: "No bookings; its site says 8am till late but does not publish a closing time or holiday exception.",
    timezone: "Australia/Melbourne", source: "https://www.heartattackandvine.com.au/",
    hours: null, hoursNote: "Listed from 8am daily; closing and holiday hours unknown",
  },
  {
    id: "kathleen-syme", name: "Kathleen Syme Library", category: "Library", coordinates: [144.9652521, -37.7987135],
    description: "Carlton neighbourhood library and community space on Faraday Street.",
    tip: "Library access differs from community-centre room hours; council libraries close on Victorian public holidays.",
    timezone: "Australia/Melbourne", source: "https://www.melbourne.vic.gov.au/library-locations-and-opening-hours",
    hours: [
      { days: [1, 2, 3, 4], opens: "10:00", closes: "19:00" },
      { days: [5], opens: "13:00", closes: "18:00" },
      { days: [6], opens: "10:00", closes: "16:00" },
      { days: [0], opens: "12:00", closes: "16:00" },
    ],
    exceptions: { "2026-09-25": null },
  },
  {
    id: "melbourne-city-baths", name: "Melbourne City Baths", category: "Wellness", coordinates: [144.963295, -37.8071077],
    description: "Historic indoor pool and fitness centre on Swanston Street.",
    tip: "Casual entry costs extra; pool, spa and sauna close 15 minutes before the building.",
    timezone: "Australia/Melbourne", source: "https://www.melbourne.vic.gov.au/melbourne-city-baths",
    hours: [
      { days: [1, 2, 3, 4], opens: "06:00", closes: "22:00" },
      { days: [5], opens: "06:00", closes: "20:00" },
      { days: [0, 6], opens: "08:00", closes: "18:00" },
    ],
    uncertainDates: ["2026-09-25"],
  },
  {
    id: "chinese-museum", name: "Chinese Museum", category: "Museum", coordinates: [144.969209, -37.8107366],
    description: "Chinese Australian history and culture in Chinatown.",
    tip: "The museum closes on public holidays; enter via Cohen Place off Lonsdale or Little Bourke Street.",
    timezone: "Australia/Melbourne", source: "https://www.chinesemuseum.com.au/location-hours",
    hours: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: "10:00", closes: "16:00" }],
    exceptions: { "2026-09-25": null },
  },
  {
    id: "fitzroy-gardens", name: "Fitzroy Gardens", category: "Outdoors", coordinates: [144.9805054, -37.812684],
    description: "Tree-lined paths, flowers and heritage features in East Melbourne.",
    tip: "The City of Melbourne links a self-guided walk. The Conservatory inside has separate opening and closure dates.",
    timezone: "Australia/Melbourne", source: "https://www.melbourne.vic.gov.au/fitzroy-gardens",
    hours: null, hoursNote: "Outdoor garden; access hours not published",
  },
];
