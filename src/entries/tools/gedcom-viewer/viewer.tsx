"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { parseGedcom, type Person, type Tree } from "./parser";
import styles from "./viewer.module.css";

const MAX_BYTES = 2 * 1024 * 1024;

const DX = 145, DY = 125;
const EMPTY_PEOPLE: Person[] = [];
const BRANCH_COLOURS = ["#225a7a", "#7d3d66", "#477035", "#875125", "#5d5190", "#326a69"];

function facts(person: Person) {
  return [person.birth.date, person.birth.place, person.death.date, person.death.place].filter(Boolean).join(" · ");
}

export default function Viewer() {
  const [compact, setCompact] = useState(false);
  const WIDTH = compact ? 400 : 900, HEIGHT = compact ? 300 : 520;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [tree, setTree] = useState<Tree | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const previousSize = useRef({ width: 900, height: 520 });
  useEffect(() => {
    const old = previousSize.current;
    if (old.width === WIDTH && old.height === HEIGHT) return;
    setView((prior) => ({ ...prior, x: prior.x + (WIDTH - old.width) / 2, y: prior.y + (HEIGHT - old.height) / 2 }));
    previousSize.current = { width: WIDTH, height: HEIGHT };
  }, [WIDTH, HEIGHT]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (compact && sheetOpen) svgRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [compact, sheetOpen, selected]);
  const people = tree?.people ?? EMPTY_PEOPLE;
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const surnames = useMemo(() => new Map([...new Set(people.map((p) => p.surname).filter(Boolean))].sort().map((name, index) => [name, BRANCH_COLOURS[index % BRANCH_COLOURS.length]])), [people]);
  const current = selected ? byId.get(selected) : undefined;
  const positions = useMemo(() => {
    const levels = new Map<string, number>();
    const remaining = new Set(people.map((person) => person.id));
    // Traverse each component from a founder, so GED record order never determines generation.
    const founders = people.filter((person) => !person.parents.length);
    let founderIndex = 0, fallbackIndex = 0;
    while (remaining.size) {
      while (founderIndex < founders.length && !remaining.has(founders[founderIndex].id)) founderIndex++;
      while (fallbackIndex < people.length && !remaining.has(people[fallbackIndex].id)) fallbackIndex++;
      const founder = founders[founderIndex] ?? people[fallbackIndex];
      levels.set(founder.id, 0);
      const queue = [founder.id];
      remaining.delete(founder.id);
      for (let i = 0; i < queue.length; i++) {
        const person = byId.get(queue[i])!;
        for (const id of [...person.partners, ...person.children]) {
          if (!remaining.delete(id)) continue;
          levels.set(id, levels.get(person.id)! + (person.children.includes(id) ? 1 : 0));
          queue.push(id);
        }
      }
    }
    const rows = new Map<number, Person[]>();
    for (const person of people) {
      const level = levels.get(person.id)!;
      if (!rows.has(level)) rows.set(level, []);
      rows.get(level)!.push(person);
    }
    // Keep siblings and partners near their family, including when records are shuffled.
    const map = new Map<string, { x: number; y: number }>();
    for (const [level, row] of [...rows].sort(([a], [b]) => a - b)) {
      row.sort((a, b) => {
        const anchor = (p: Person) => p.parents[0] ?? p.partners[0] ?? p.id;
        return anchor(a).localeCompare(anchor(b), undefined, { numeric: true }) || a.id.localeCompare(b.id, undefined, { numeric: true });
      });
      row.forEach((person, i) => map.set(person.id, { x: i * DX + 75, y: level * DY + 65 }));
    }
    return map;
  }, [people, byId]);
  const bounds = useMemo(() => {
    const points = [...positions.values()];
    return { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) };
  }, [positions]);
  const fit = () => {
    const scale = Math.min(1.15, (WIDTH - 80) / (bounds.maxX - bounds.minX + DX), (HEIGHT - 80) / (bounds.maxY - bounds.minY + DY));
    setView({ x: WIDTH / 2 - (bounds.minX + bounds.maxX) / 2 * scale, y: HEIGHT / 2 - (bounds.minY + bounds.maxY) / 2 * scale, scale });
    setSelected(null);
  };
  const select = (id: string) => {
    const point = positions.get(id);
    if (!point) return;
    setSelected(id);
    setSheetOpen(true);
    setView({ x: WIDTH / 2, y: HEIGHT / 2, scale: compact ? 1 : 1.4 });
    setQuery("");
  };
  async function load(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_BYTES) throw new Error("File exceeds the 2 MiB limit.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const imported = parseGedcom(text);
      setTree(imported);
      setFilename(file.name);
      setSelected(imported.people[0].id);
      setSheetOpen(false);
      setQuery("");
      setView({ x: WIDTH / 2, y: HEIGHT / 2, scale: 1.4 });
      setError("");
    } catch (cause) {
      setError(cause instanceof TypeError ? "Unreadable bytes: use a UTF-8 GEDCOM file." : cause instanceof Error ? cause.message : "Could not read this file.");
    }
  }
  const results = query.trim() ? people.filter((person) => {
    const haystack = `${person.name} ${facts(person)}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
  }).slice(0, 12) : [];
  const edge = (from: string, to: string, kind: "parent" | "partner") => {
    const a = displayPosition(from), b = displayPosition(to);
    if (!a || !b) return null;
    const related = selected && (from === selected || to === selected);
    return <line key={`${kind}-${from}-${to}`} data-parent-edge={kind === "parent" ? "" : undefined} data-partner-edge={kind === "partner" ? "" : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth={related ? 2.5 : 1.3} strokeDasharray={kind === "partner" ? "6 5" : undefined} opacity={selected && !related ? 0.18 : 0.5} />;
  };
  const related = new Set(current ? [current.id, ...current.parents, ...current.partners, ...current.children] : []);
  const neighbourhood = new Map<string, { x: number; y: number }>();
  if (current) {
    neighbourhood.set(current.id, { x: 0, y: 0 });
    current.parents.forEach((id, i) => neighbourhood.set(id, { x: (i - (current.parents.length - 1) / 2) * DX, y: -(compact ? 100 : DY) }));
    current.partners.forEach((id, i) => neighbourhood.set(id, { x: (i + 1) * DX, y: 0 }));
    current.children.forEach((id, i) => neighbourhood.set(id, { x: (i - (current.children.length - 1) / 2) * DX, y: compact ? 100 : DY }));
  }
  const displayPosition = (id: string) => current ? neighbourhood.get(id) : positions.get(id);
  function zoom(multiplier: number, x = WIDTH / 2, y = HEIGHT / 2) {
    setView((prior) => {
      const scale = Math.max(0.02, Math.min(5, prior.scale * multiplier));
      return { x: x - (x - prior.x) * scale / prior.scale, y: y - (y - prior.y) * scale / prior.scale, scale };
    });
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest("[data-node-target]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
    const rect = event.currentTarget.getBoundingClientRect();
    setView((prior) => ({ ...prior, x: prior.x + dx * WIDTH / rect.width, y: prior.y + dy * HEIGHT / rect.height }));
    drag.current.x = event.clientX; drag.current.y = event.clientY;
  }
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !tree) return;
    const wheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
      setView((prior) => {
        const scale = Math.max(0.02, Math.min(5, prior.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
        return { x: point.x - (point.x - prior.x) * scale / prior.scale, y: point.y - (point.y - prior.y) * scale / prior.scale, scale };
      });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [tree, WIDTH, HEIGHT]);
  function pointerEnd(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function relationship(label: string, ids: string[]) {
    return <section className={styles.relation}><h4>{label}</h4>{ids.length ? <ul>{ids.map((id) => <li key={id}><button type="button" onClick={() => select(id)}>{byId.get(id)?.name}</button></li>)}</ul> : <p>None recorded</p>}</section>;
  }
  return <div className={`${styles.viewer} ${compact && sheetOpen ? styles.sheetVisible : ""}`}>
    <div className={styles.importBar}>
      <label className={styles.upload}> {tree ? "Load another GEDCOM" : "Load GEDCOM"}<input type="file" accept=".ged,.gedcom,text/plain" onChange={load} aria-label="Load GEDCOM" /></label>
      <span>UTF-8 GEDCOM 5.5.1 · up to 2 MiB / 2,000 people</span>
      <strong>Private to this tab</strong>
    </div>
    {error && <p role="alert" className={styles.error}>{error} The current tree has not changed.</p>}
    {!tree ? <div className={styles.empty}><h2>Start with your GEDCOM file</h2><p>Choose a .ged or .gedcom file to explore its people and relationships. Processing stays in this browser tab; nothing is uploaded or saved.</p></div> : <>
      <p className={styles.summary} role="status"><strong>{filename}</strong> · {people.length} people loaded</p>
      {tree.warnings.length > 0 && <details className={styles.warnings}><summary>Import diagnostics ({tree.warnings.length} warnings)</summary><ul>{tree.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
      <div className={styles.toolbar}>
        <div className={styles.search}><label htmlFor="ged-search">Find someone</label><input id="ged-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); if (e.key === "Enter" && results.length) select(results[0].id); }} placeholder="Name, place or year" />
          {query.trim() && <div className={styles.results} role="region" aria-label="Search results">{results.length ? <ul>{results.map((person) => <li key={person.id}><button type="button" onClick={() => select(person.id)}>{person.name} <small>{facts(person) || person.id}</small></button></li>)}</ul> : <p>No one matches “{query}”</p>}</div>}
        </div>
        <div className={styles.controls}><button type="button" onClick={() => zoom(1.25)} aria-label="Zoom in">+</button><button type="button" onClick={() => zoom(0.8)} aria-label="Zoom out">−</button><button type="button" onClick={fit}>Fit whole tree</button></div>
      </div>
      <div className={styles.workspace}>
        <div className={styles.scene}><svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label="Family relationship graph" role="img" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
          <rect width={WIDTH} height={HEIGHT} fill="transparent" />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {people.flatMap((person) => person.children.map((id) => edge(person.id, id, "parent")))}
            {people.flatMap((person) => person.partners.filter((id) => person.id < id).map((id) => edge(person.id, id, "partner")))}
            {people.map((person) => { const point = displayPosition(person.id); if (!point) return null; return <g key={person.id} data-person-node="" transform={`translate(${point.x} ${point.y})`} opacity={selected && !related.has(person.id) ? 0.32 : 1}>
              <circle r="24" fill="var(--surface)" stroke={selected === person.id ? "var(--accent)" : person.surname ? surnames.get(person.surname) : "var(--text-secondary)"} strokeWidth={selected === person.id ? 4 : 1.5} />
              <circle r="4" fill="var(--accent)" />
              {view.scale >= 0.6 && <text y="42" textAnchor="middle" fontSize={compact ? 17 : 13} fill="var(--ink)">{person.name.length > 22 ? person.name.slice(0, 21) + "…" : person.name}</text>}
              <circle role="button" tabIndex={0} data-node-target="" aria-label={`${person.name} (${person.id})`} onClick={() => select(person.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(person.id); } }} r="27" fill="transparent" className={styles.nodeTarget} />
            </g>; })}
          </g>
        </svg><p className={styles.legend}>Solid line: parent → child &nbsp;·&nbsp; Dashed line: partners &nbsp;·&nbsp; Node outline: surname (colours repeat) &nbsp;·&nbsp; {current ? `Showing ${related.size} close relatives of ${people.length} people loaded` : `${people.length} people loaded`}</p></div>
        <aside className={`${styles.details} ${current && sheetOpen ? styles.openDetails : ""}`} aria-label="Person details" role="region">{current ? <>
          <div className={styles.detailHead}><div><h2>{current.name}</h2><code>{current.id}</code></div><button type="button" onClick={() => { setSheetOpen(false); fit(); }}>Close details</button></div>
          {current.birth.date || current.birth.place ? <p><strong>Birth</strong> {current.birth.date} {current.birth.place}</p> : null}
          {current.death.date || current.death.place ? <p><strong>Death</strong> {current.death.date} {current.death.place}</p> : null}
          {relationship("Parents", current.parents)}{relationship("Partners", current.partners)}{relationship("Children", current.children)}
          {current.notes.length > 0 && <section><h4>Notes</h4>{current.notes.map((note, i) => <p key={i}>{note}</p>)}</section>}
          {current.sources.length > 0 && <section><h4>Source references in file</h4>{current.sources.map((source, i) => <p key={i}>{source}</p>)}</section>}
        </> : <p>Select a person in the graph or use search to inspect their details. Use the search and relationship buttons to navigate without the graph.</p>}</aside>
      </div>
    </>}
  </div>;
}
