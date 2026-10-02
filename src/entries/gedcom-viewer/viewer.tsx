"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { parseGedcom, type Person, type Tree } from "./parser";
import styles from "./viewer.module.css";

const MAX_BYTES = 2 * 1024 * 1024;
const COLOURS = ["#7ca8ee", "#d494aa", "#83b7a3", "#e4b879", "#b5a5d9", "#78b9c4"];
type Point = { x: number; y: number; vx: number; vy: number };
type View = { x: number; y: number; scale: number };
const facts = (p: Person) => [p.birth.date, p.birth.place, p.death.date, p.death.place].filter(Boolean).join(" · ");

export default function Viewer() {
  const [tree, setTree] = useState<Tree | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [size, setSize] = useState({ width: 900, height: 650 });
  const [view, setView] = useState<View>({ x: 450, y: 325, scale: 1 });
  const [positions, setPositions] = useState(new Map<string, Point>());
  const [heat, setHeat] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const points = useRef(new Map<string, Point>());
  const drag = useRef<{ id: number; x: number; y: number; node?: string; moved: boolean } | null>(null);
  const people = useMemo(() => tree?.people ?? [], [tree]);
  const byId = useMemo(() => new Map(people.map(p => [p.id, p])), [people]);
  const current = selected ? byId.get(selected) : undefined;
  const related = useMemo(() => new Set(current ? [current.id, ...current.parents, ...current.partners, ...current.children] : []), [current]);
  const colours = useMemo(() => new Map([...new Set(people.map(p => p.surname).filter(Boolean))].sort().map((name, i) => [name, COLOURS[i % COLOURS.length]])), [people]);
  const links = useMemo(() => people.flatMap(p => [
    ...p.children.map(id => ({ from: p.id, to: id, kind: "parent" as const })),
    ...p.partners.filter(id => p.id < id).map(id => ({ from: p.id, to: id, kind: "partner" as const }))
  ]), [people]);
  // The overview retains every point and link. Only a bounded active set is simulated.
  const active = useMemo(() => {
    if (people.length <= 300) return new Set(people.map(p => p.id));
    if (!selected) return new Set(people.filter(p => p.parents.length || p.partners.length || p.children.length).slice(0, 300).map(p => p.id));
    const ids = new Set([selected, ...related]);
    for (const p of people) if (ids.size < 300 && (p.parents.some(id => related.has(id)) || p.partners.some(id => related.has(id)))) ids.add(p.id);
    return ids;
  }, [people, selected, related]);

  function seed(people: Person[]) {
    const map = new Map<string, Point>();
    // A spiral seeded from record order gives unconnected records room without a huge grid.
    people.forEach((p, i) => {
      const radius = 54 * Math.sqrt(i), angle = i * 2.39996;
      map.set(p.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 });
    });
    points.current = map;
    setPositions(map);
  }


  useEffect(() => {
    if (!tree) return;
    let animation = 0, step = 0;
    const ids = [...active], liveLinks = links.filter(l => active.has(l.from) && active.has(l.to));
    const tick = () => {
      const map = points.current;
      // Bounded pairwise repulsion, elastic family links, mild central gravity and damping.
      for (let i = 0; i < ids.length; i++) {
        const a = map.get(ids[i]); if (!a) continue;
        for (let j = i + 1; j < ids.length; j++) {
          const b = map.get(ids[j]); if (!b) continue;
          const dx = b.x - a.x, dy = b.y - a.y, d2 = Math.max(100, dx * dx + dy * dy);
          if (d2 > 300 * 300) continue;
          const force = Math.min(.75, 2100 / d2) / Math.sqrt(d2);
          a.vx -= dx * force; a.vy -= dy * force;
          b.vx += dx * force; b.vy += dy * force;
        }
      }
      for (const link of liveLinks) {
        const a = map.get(link.from), b = map.get(link.to);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.max(1, Math.hypot(dx, dy));
        const force = (dist - (link.kind === "partner" ? 130 : 165)) * .006;
        const fx = dx / dist * force, fy = dy / dist * force;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      let moving = false;
      for (const id of ids) {
        const p = map.get(id); if (!p) continue;
        if (drag.current?.node === id) { p.vx = 0; p.vy = 0; continue; }
        p.vx = (p.vx - p.x * .00035) * .83;
        p.vy = (p.vy - p.y * .00035) * .83;
        p.x += p.vx; p.y += p.vy;
        if (Math.abs(p.vx) + Math.abs(p.vy) > .025) moving = true;
      }
      setPositions(new Map(map));
      if ((moving || drag.current?.node) && step++ < 160) animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [tree, active, links, heat]);

  useEffect(() => {
    const element = sceneRef.current;
    if (!element || !tree) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize(old => {
        if (old.width === width && old.height === height) return old;
        setView(v => ({ ...v, x: v.x + (width - old.width) / 2, y: v.y + (height - old.height) / 2 }));
        return { width, height };
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [tree]);

  function fit() {
    const values = [...points.current.values()];
    if (!values.length) return;
    const minX = Math.min(...values.map(p => p.x)), maxX = Math.max(...values.map(p => p.x));
    const minY = Math.min(...values.map(p => p.y)), maxY = Math.max(...values.map(p => p.y));
    const scale = Math.min(1.35, (size.width - 90) / (maxX - minX + 100), (size.height - 140) / (maxY - minY + 100));
    setView({ x: size.width / 2 - (minX + maxX) / 2 * scale, y: size.height / 2 - (minY + maxY) / 2 * scale, scale });
    setSelected(null); setSheetOpen(false);
  }
  function select(id: string) {
    const p = points.current.get(id); if (!p) return;
    const family = byId.get(id);
    if (family) [...family.parents, ...family.partners, ...family.children].forEach((other, i) => {
      const neighbour = points.current.get(other);
      if (neighbour && Math.hypot(neighbour.x - p.x, neighbour.y - p.y) > 250) {
        const angle = i * 2.39996;
        neighbour.x = p.x + Math.cos(angle) * 155; neighbour.y = p.y + Math.sin(angle) * 155;
        neighbour.vx = 0; neighbour.vy = 0;
      }
    });
    setHeat(n => n + 1);
    const scale = Math.max(1.2, Math.min(1.4, view.scale));
    setView({ x: size.width / 2 - p.x * scale, y: size.height * .37 - p.y * scale, scale });
    setSelected(id); setSheetOpen(true); setQuery("");
  }
  function zoom(factor: number, x = size.width / 2, y = size.height / 2) {
    setView(v => {
      const scale = Math.max(.025, Math.min(4, v.scale * factor));
      return { x: x - (x - v.x) * scale / v.scale, y: y - (y - v.y) * scale / v.scale, scale };
    });
  }
  async function load(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_BYTES) throw new Error("File exceeds the 2 MiB limit.");
      const imported = parseGedcom(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
      seed(imported.people);
      setTree(imported); setFilename(file.name); setSelected(null); setSheetOpen(false); setQuery(""); setError("");
      const values = [...points.current.values()];
      const maxX = Math.max(...values.map(p => Math.abs(p.x))), maxY = Math.max(...values.map(p => Math.abs(p.y)));
      const width = window.innerWidth, height = window.innerHeight;
      setSize({ width, height });
      setView({ x: width / 2, y: height / 2, scale: Math.min(1.25, (width - 90) / (2 * maxX + 100), (height - 140) / (2 * maxY + 100)) });
    } catch (cause) {
      setError(cause instanceof TypeError ? "Unreadable bytes: use a UTF-8 GEDCOM file." : cause instanceof Error ? cause.message : "Could not read this file.");
    }
  }
  const results = query.trim() ? people.filter(p => {
    const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return normalize(query.trim()).split(/\s+/).every(word => normalize(`${p.name} ${facts(p)}`).includes(word));
  }).slice(0, 12) : [];
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    const node = (event.target as Element).closest("[data-person-node]")?.getAttribute("data-id") ?? undefined;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, node, moved: false };
    if (node) setHeat(n => n + 1);
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - d.x) * size.width / rect.width, dy = (event.clientY - d.y) * size.height / rect.height;
    if (dx || dy) d.moved = true;
    if (d.node) {
      const p = points.current.get(d.node);
      if (p) { p.x += dx / view.scale; p.y += dy / view.scale; setPositions(new Map(points.current)); }
    } else setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
    d.x = event.clientX; d.y = event.clientY;
  }
  function pointerEnd(event: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (d.node && !d.moved && event.type !== "pointercancel") select(d.node);
  }
  useEffect(() => {
    const svg = svgRef.current; if (!svg || !tree) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, point.x, point.y);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  });
  useEffect(() => {
    if (!tree) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [tree]);
  function relationship(label: string, ids: string[]) {
    return <section className={styles.relation}><h4>{label}</h4>{ids.length ? <ul>{ids.map(id => <li key={id}><button type="button" onClick={() => select(id)}><span className={styles.avatar}>{byId.get(id)?.name.split(/\s+/).map(s => s[0]).slice(0, 2).join("")}</span><span>{byId.get(id)?.name}</span><small>{byId.get(id)?.birth.date}</small></button></li>)}</ul> : <p>None recorded</p>}</section>;
  }
  return <div className={`${styles.viewer} ${tree ? styles.loaded : ""}`}>
    {!tree ? <><div className={styles.importBar}><label className={styles.upload}>Load GEDCOM<input type="file" accept=".ged,.gedcom,text/plain" onChange={load} aria-label="Load GEDCOM" /></label><span>UTF-8 GEDCOM 5.5.1 · up to 2 MiB / 2,000 people</span><strong>Private to this tab</strong></div><div className={styles.empty}><h2>Start with your GEDCOM file</h2><p>Choose a .ged or .gedcom file to explore its people and relationships. Processing stays in this browser tab; nothing is uploaded or saved.</p></div></> : <>
      <div className={styles.scene} ref={sceneRef}>
        <svg ref={svgRef} viewBox={`0 0 ${size.width} ${size.height}`} aria-label="Family relationship graph" role="img" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
          <rect width={size.width} height={size.height} fill="transparent" />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {links.map(l => { const a = positions.get(l.from), b = positions.get(l.to); if (!a || !b) return null; const highlighted = selected && (l.from === selected || l.to === selected); return <line key={`${l.kind}-${l.from}-${l.to}`} data-parent-edge={l.kind === "parent" ? "" : undefined} data-partner-edge={l.kind === "partner" ? "" : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={highlighted ? "#d9e7ff" : "#8995a4"} strokeWidth={highlighted ? 2.5 : 1.2} strokeDasharray={l.kind === "partner" ? "6 5" : undefined} opacity={selected ? highlighted ? .95 : .1 : .35} />; })}
            {people.map(p => { const point = positions.get(p.id); if (!point) return null; const prominent = selected === p.id || related.has(p.id), showLabel = selected ? prominent : people.length <= 12 && view.scale >= .6; return <g key={p.id} data-person-node="" data-id={p.id} transform={`translate(${point.x} ${point.y})`} opacity={selected && !prominent ? .15 : 1}>
              <circle r={selected === p.id ? 13 : 9} fill={colours.get(p.surname) ?? "#a6b3c2"} stroke={selected === p.id ? "#dfeaff" : "none"} strokeWidth="3" />
              {showLabel && <text y="31" textAnchor="middle" fontSize="13" fill="#f1f5fb" stroke="#111a21" strokeWidth="3" paintOrder="stroke" pointerEvents="none">{p.name.length > 24 ? p.name.slice(0, 23) + "…" : p.name}</text>}
              <circle role="button" tabIndex={0} data-node-target="" aria-label={`${p.name} (${p.id})`} onClick={e => { if (e.detail === 0) select(p.id); }} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.id); } }} r="24" fill="transparent" className={styles.nodeTarget} />
            </g>; })}
          </g>
        </svg>
        <header className={styles.appBar}><span className={styles.appTitle}>Family tree <small role="status">{filename} · {people.length} people loaded</small></span><label className={styles.reload}>Load another GEDCOM<input type="file" accept=".ged,.gedcom,text/plain" onChange={load} aria-label="Load GEDCOM" /></label></header>
        <div className={styles.toolbar}><div className={styles.search}><label htmlFor="ged-search">Find someone</label><input id="ged-search" type="search" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setQuery(""); if (e.key === "Enter" && results.length) select(results[0].id); }} placeholder="Name, place or year" />{query.trim() && <div className={styles.results} role="region" aria-label="Search results">{results.length ? <ul>{results.map(p => <li key={p.id}><button type="button" onClick={() => select(p.id)}>{p.name}<small>{facts(p) || p.id}</small></button></li>)}</ul> : <p>No one matches “{query}”</p>}</div>}</div><div className={styles.controls}><button type="button" onClick={() => zoom(1.25)} aria-label="Zoom in">+</button><button type="button" onClick={() => zoom(.8)} aria-label="Zoom out">−</button><button type="button" onClick={fit}>Fit whole tree</button></div></div>
        <p className={styles.legend}>Solid lines: parent → child · Dashed: partners · Drag a person or pan the field</p>
      </div>
      {tree.warnings.length > 0 && <details className={styles.warnings}><summary>Import diagnostics ({tree.warnings.length} warnings)</summary><ul>{tree.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
      <aside className={`${styles.details} ${current && sheetOpen ? styles.openDetails : ""}`} aria-label="Person details" role="region">{current && sheetOpen ? <><div className={styles.detailHead}><h2>{current.name}</h2><button type="button" onClick={() => { setSheetOpen(false); setSelected(null); }} aria-label="Close details">×</button></div><p className={styles.life}>{current.birth.date || current.birth.place ? <>Born {facts({ ...current, death: {} })}</> : "No birth recorded"}</p>{current.death.date || current.death.place ? <p className={styles.life}>Died {[current.death.date, current.death.place].filter(Boolean).join(" · ")}</p> : null}{relationship("Parents", current.parents)}{relationship("Partners", current.partners)}{relationship("Children", current.children)}{current.notes.length > 0 && <section><h4>Notes</h4>{current.notes.map((note, i) => <p key={i}>{note}</p>)}</section>}{current.sources.length > 0 && <section><h4>Source references in file</h4>{current.sources.map((source, i) => <p key={i}>{source}</p>)}</section>}</> : null}</aside>
    </>}
    {error && <p role="alert" className={styles.error}>{error} The current tree has not changed.</p>}
  </div>;
}
