"use client";

import { useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Place } from "./places";
import styles from "./morning.module.css";

export function PlacesMap({ places, origin, selected, onSelect }: {
  places: readonly Place[];
  origin: readonly [number, number];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const initialOrigin = useRef(origin);
  const markers = useRef<maplibregl.Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { if (mapReady) map.current?.flyTo({ center: [origin[0], origin[1]], essential: true }); }, [mapReady, origin]);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    import("maplibre-gl").then(({ default: MapLibre }) => {
      if (disposed || !container.current) return;
      const instance = new MapLibre.Map({
        container: container.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        center: [initialOrigin.current[0], initialOrigin.current[1]], zoom: 14.1,
        attributionControl: { compact: false },
      });
      map.current = instance;
      setMapReady(true);
      instance.addControl(new MapLibre.NavigationControl({ showCompass: false }), "top-right");
    });
    return () => { disposed = true; markers.current.forEach((marker) => marker.remove()); markers.current = []; map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    let cancelled = false;
    import("maplibre-gl").then(({ default: MapLibre }) => {
      if (cancelled) return;
      markers.current.forEach((marker) => marker.remove());
      const originEl = document.createElement("div");
      originEl.className = styles.originPin;
      originEl.setAttribute("aria-label", "Starting point");
      markers.current = [new MapLibre.Marker({ element: originEl }).setLngLat([origin[0], origin[1]]).addTo(instance)];
      for (const place of places) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `${styles.pin} ${styles[place.category.toLowerCase()]}`;
        button.textContent = place.category.slice(0, 1);
        button.title = place.name;
        button.setAttribute("aria-label", place.name);
        if (place.id === selected) button.dataset.selected = "true";
        // MapLibre suppresses marker clicks after a map drag; no pointerdown selection.
        button.addEventListener("click", (event) => { event.stopPropagation(); onSelectRef.current(place.id); });
        markers.current.push(new MapLibre.Marker({ element: button, anchor: "bottom" }).setLngLat([place.coordinates[0], place.coordinates[1]]).addTo(instance));
      }
    });
    return () => { cancelled = true; };
  }, [mapReady, places, origin, selected]);

  // The origin can move without resetting the user's pan/zoom.
  return <div ref={container} className={styles.map} role="region" aria-label="Map of nearby places" />;
}
