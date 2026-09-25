"use client";

import { useEffect, useMemo, useState } from "react";
import { availability, localNow, type Window } from "./hours";
import { places, type Place } from "./places";
import { PlacesMap } from "./places-map";
import styles from "./morning.module.css";

const origins = [
  { name: "Fed Square", coordinates: [144.9691, -37.8179] },
  { name: "State Library", coordinates: [144.9655, -37.8098] },
  { name: "NGV International", coordinates: [144.9687, -37.8229] },
] as const;
const categories = ["All", "Art", "Museum", "Library"] as const;
const zone = "Australia/Melbourne";

function walkingMinutes(from: readonly [number, number], to: readonly [number, number]) {
  const radians = Math.PI / 180;
  const a = Math.sin((to[1] - from[1]) * radians / 2) ** 2 +
    Math.cos(from[1] * radians) * Math.cos(to[1] * radians) *
    Math.sin((to[0] - from[0]) * radians / 2) ** 2;
  const metres = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.round(metres * 1.35 / 80));
}

export default function MelbourneMorning() {
  const [originIndex, setOriginIndex] = useState(0);
  const [position, setPosition] = useState<readonly [number, number] | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [window, setWindow] = useState<Window | null>(null);
  const [category, setCategory] = useState<(typeof categories)[number]>("All");
  const [query, setQuery] = useState("");
  const [hideClosed, setHideClosed] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const origin = position ?? origins[originIndex].coordinates;

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      const now = localNow(zone);
      const afterSix = now.time >= "18:00";
      const tomorrow = afterSix ? new Date(`${now.date}T12:00:00Z`) : null;
      if (tomorrow) tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      setWindow({
        date: tomorrow ? tomorrow.toISOString().slice(0, 10) : now.date,
        from: afterSix ? "09:00" : now.time,
        until: afterSix || now.time >= "12:00" ? "18:00" : "12:00",
      });
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, []);

  const validWindow = window && window.from < window.until;
  const visible = useMemo(() => {
    if (!validWindow) return [];
    const ranked = places.map((place) => ({ place, status: availability(place, window) }));
    return ranked.filter(({ place, status }) =>
      (category === "All" || place.category === category) &&
      (!hideClosed || status.kind !== "closed") &&
      `${place.name} ${place.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ).sort((a, b) => {
      const rank = { open: 0, later: 1, closed: 2 };
      return rank[a.status.kind] - rank[b.status.kind] || a.status.starts - b.status.starts || a.place.name.localeCompare(b.place.name);
    });
  }, [validWindow, window, category, query, hideClosed]);
  const selectedPlace: Place | undefined = visible.find(({ place }) => place.id === selected)?.place;
  const selectedStatus = visible.find(({ place }) => place.id === selected)?.status;

  function locate() {
    if (!navigator.geolocation) {
      setLocationMessage("Location unavailable; using your chosen start.");
      return;
    }
    setLocationMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPosition([coords.longitude, coords.latitude]);
        setLocationMessage("Using your location. Walking times are estimates.");
      },
      () => { setPosition(null); setLocationMessage("Location unavailable or denied; using your chosen start."); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  return <div className={styles.workspace}>
    <div className={styles.controls} aria-label="Plan your time">
      <label>Start near
        <select value={originIndex} onChange={(event) => { setOriginIndex(Number(event.target.value)); setPosition(null); setLocationMessage(""); }}>
          {origins.map((item, index) => <option value={index} key={item.name}>{item.name}</option>)}
        </select>
      </label>
      <label>Day
        <input type="date" value={window?.date ?? ""} onChange={(event) => setWindow((old) => old ? { ...old, date: event.target.value } : old)} />
      </label>
      <label>From
        <input type="time" value={window?.from ?? ""} onChange={(event) => setWindow((old) => old ? { ...old, from: event.target.value } : old)} />
      </label>
      <label>Until
        <input type="time" value={window?.until ?? ""} onChange={(event) => setWindow((old) => old ? { ...old, until: event.target.value } : old)} />
      </label>
      <button type="button" onClick={locate}>Use my location</button>
    </div>
    {!validWindow && window ? <p role="alert" className="text-error">Choose an end time later than the start time.</p> : null}
    {locationMessage ? <p role="status" className={styles.note}>{locationMessage}</p> : null}
    <PlacesMap places={visible.map(({ place }) => place)} origin={origin} selected={selected} onSelect={setSelected} />
    <div className={styles.results}>
      <div className={styles.filter} aria-label="Filter by category">
        {categories.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      <label className="text-sm text-secondary">Search places
        <input className="mt-1 block h-11 w-full border border-rule bg-surface px-3 text-ink" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or description" />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm text-secondary">
        <input type="checkbox" checked={hideClosed} onChange={(event) => setHideClosed(event.target.checked)} /> Hide places closed for this window
      </label>
      <p className={styles.note}>{visible.length} places · times in Melbourne ({zone}) · walking estimates, not routes</p>
      {selectedPlace && selectedStatus ? <section className={styles.detail} aria-label={`${selectedPlace.name} details`}>
        <h2 className="text-xl font-bold">{selectedPlace.name}</h2>
        <p className="text-secondary">{selectedPlace.description}</p>
        <p><strong>{selectedStatus.label}</strong> · {walkingMinutes(origin, selectedPlace.coordinates)} min walk approx.</p>
        <p className={styles.note}>Usual hours: {selectedPlace.hours.map((hours) => `${hours.opens}–${hours.closes}`).join(", ")} · {selectedPlace.timezone}. Holiday hours can differ.</p>
        <p className={styles.note}>Tip: {selectedPlace.tip}</p>
        <p className={styles.note}><a href={selectedPlace.source} target="_blank" rel="noopener noreferrer">Check venue hours</a> · <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedPlace.coordinates[1]},${selectedPlace.coordinates[0]}`)}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a></p>
      </section> : null}
      <div className={styles.list} role="list" aria-label="Places worth visiting">
        {visible.map(({ place, status }) => <button className={styles.row} data-selected={place.id === selected} type="button" role="listitem" key={place.id} onClick={() => setSelected(place.id)}>
          <span><strong>{place.name}</strong><small>{place.category} · {status.label}</small></span>
          <small>{walkingMinutes(origin, place.coordinates)} min walk*</small>
        </button>)}
        {!visible.length && validWindow ? <p className="py-4 text-secondary">No places match this window and these filters.</p> : null}
      </div>
      <p className={styles.note}>*Straight-line walking estimate, not a route. Curated venue hours checked September 2026; special dates may differ. Check with the venue before travelling. Map © OpenStreetMap contributors (ODbL).</p>
    </div>
  </div>;
}
