"use client";

import { beyondWaterline, depthOf, floodOffset, floodTime, hasBuilt, isDark, reach, tideElapsed, waterline, BANDS, BAND_NAMES, CREEP_MS, TURN_MS, type Band, type State } from "./model";
import styles from "./scene.module.css";

/** The flat seen from the shore: the wreck at the top (sea), the shingle at the bottom. */
export const SCENE_W = 360;
export const SCENE_H = 240;
const BAND_H = SCENE_H / 4;
const WAVE = "M0 0 C 10 -4 20 4 30 0 S 50 -4 60 0 S 80 4 90 0 S 110 -4 120 0";
/** A wave line the full width of the scene at a given y. */
function waveAt(y: number) {
  let d = `M0 ${y}`;
  for (let x = 0; x < SCENE_W; x += 30) d += ` C ${x + 10} ${y - 3} ${x + 20} ${y + 3} ${x + 30} ${y}`;
  return d;
}

/** Top edge (y) of a band in scene space. Band 3 (wreck) is at the top. */
export function bandTop(band: Band) {
  return (3 - band) * BAND_H;
}

/** Where the water's edge sits right now, in scene y: the engine's continuous waterline (bands exposed, 1..4) mapped onto the terraces. */
export function waterEdge(state: State): number {
  return (4 - waterline(state)) * BAND_H;
}

export type Figure = {
  id: number;
  name: string;
  band: Band;
  /** 0..1 of the current job, or null when idle. */
  progress: number | null;
  queued: boolean;
  hungry: boolean;
};

export function Scene({ state, figures, selected, onSelect }: {
  state: State;
  figures: readonly Figure[];
  selected: Band | null;
  onSelect: (band: Band) => void;
}) {
  const depth = depthOf(state);
  const dark = isDark(state.tide);
  const edge = waterEdge(state);
  const rising = depth > 1 && tideElapsed(state) > TURN_MS - CREEP_MS;
  const elapsed = tideElapsed(state);

  return (
    <div className={styles.scene} data-dark={dark || undefined} data-rising={rising || undefined} data-waterline={waterline(state).toFixed(2)}>
      <svg viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true" className={styles.svg}>
        <defs>
          <pattern id="lt-pebbles" width="14" height="10" patternUnits="userSpaceOnUse">
            <ellipse cx="4" cy="3" rx="3" ry="2" className={styles.pebble} />
            <ellipse cx="11" cy="8" rx="2.5" ry="1.6" className={styles.pebble} />
          </pattern>
          <pattern id="lt-mud" width="18" height="8" patternUnits="userSpaceOnUse">
            <path d="M1 4 H7 M11 2 H16" className={styles.mudMark} />
          </pattern>
          <pattern id="lt-reef" width="16" height="12" patternUnits="userSpaceOnUse">
            <path d="M0 10 L4 4 L8 10 L12 4 L16 10" className={styles.reefMark} />
          </pattern>
          <pattern id="lt-waves" width="120" height="24" patternUnits="userSpaceOnUse">
            <path d={WAVE} transform="translate(0 12)" className={styles.wave} />
          </pattern>
        </defs>

        {/* Ground: four terraces. */}
        <rect x="0" y={bandTop(3)} width={SCENE_W} height={BAND_H} className={styles.wreckBed} />
        <rect x="0" y={bandTop(3)} width={SCENE_W} height={BAND_H} fill="url(#lt-mud)" opacity=".5" />
        <rect x="0" y={bandTop(2)} width={SCENE_W} height={BAND_H} className={styles.reefBed} />
        <rect x="0" y={bandTop(2)} width={SCENE_W} height={BAND_H} fill="url(#lt-reef)" />
        <rect x="0" y={bandTop(1)} width={SCENE_W} height={BAND_H} className={styles.mudBed} />
        <rect x="0" y={bandTop(1)} width={SCENE_W} height={BAND_H} fill="url(#lt-mud)" />
        <rect x="0" y={bandTop(0)} width={SCENE_W} height={BAND_H} className={styles.shingleBed} />
        <rect x="0" y={bandTop(0)} width={SCENE_W} height={BAND_H} fill="url(#lt-pebbles)" />
        {/* Terrace lips. */}
        {[1, 2, 3].map(band => (
          <path key={band} d={`M0 ${bandTop(band as Band) + BAND_H} C 60 ${bandTop(band as Band) + BAND_H - 5} 120 ${bandTop(band as Band) + BAND_H + 4} 180 ${bandTop(band as Band) + BAND_H} S 300 ${bandTop(band as Band) + BAND_H - 4} 360 ${bandTop(band as Band) + BAND_H}`} className={styles.lip} />
        ))}

        {/* The wreck: ribs and a keel, always there, under water or not. */}
        <g className={styles.wreck}>
          <path d="M230 52 C 250 60 290 60 310 50" />
          <path d="M240 54 L236 18" />
          <path d="M258 58 L258 10" />
          <path d="M276 58 L280 14" />
          <path d="M296 54 L304 22" />
          <path d="M250 30 L300 26" />
        </g>
        {/* Reef heads. */}
        <g className={styles.reefHeads}>
          <ellipse cx="60" cy="86" rx="22" ry="7" />
          <ellipse cx="170" cy="104" rx="16" ry="5" />
          <ellipse cx="300" cy="90" rx="26" ry="8" />
        </g>

        {/* Camp on the shingle: hut, then everything built grows beside it. */}
        <Camp state={state} />

        {/* Flooded bands dim before the water sweeps over them, as the rules say. */}
        {BANDS.filter(band => band > 0).map(band => {
          const flood = floodTime(state, band);
          const flooded = flood !== undefined && flood !== null && state.time >= flood;
          return flooded || flood === undefined ? <rect key={band} x="0" y={bandTop(band)} width={SCENE_W} height={BAND_H} className={styles.wet} /> : null;
        })}

        {/* The water. Its edge is animated by CSS between ticks. */}
        <g className={styles.water} style={{ transform: `translateY(${edge - SCENE_H}px)` }}>
          <rect x="0" y="0" width={SCENE_W} height={SCENE_H} className={styles.sea} />
          <rect x="0" y="0" width={SCENE_W} height={SCENE_H} fill="url(#lt-waves)" className={styles.waves} />
          <path d={waveAt(SCENE_H - 1)} className={styles.foam} />
        </g>

        {/* Bands under water but within reach (waders, raft): outlined, so wading is a visible option. */}
        {BANDS.filter(band => band >= depth && beyondWaterline(state, band) <= reach(state)).map(band => (
          <g key={band}>
            <rect x="3" y={bandTop(band) + 3} width={SCENE_W - 6} height={BAND_H - 6} className={styles.reachable} />
            <text x={SCENE_W / 2} y={bandTop(band) + BAND_H / 2 + 4} textAnchor="middle" className={styles.reachLabel}>
              {beyondWaterline(state, band) === 1 ? "WADE · 1.5× TIME" : "RAFT · 2× TIME"}
            </text>
          </g>
        ))}

        {/* The low-water mark for this tide, so you can see how far out it will go / has gone. */}
        <line x1="0" x2={SCENE_W} y1={(4 - depth) * BAND_H} y2={(4 - depth) * BAND_H} className={styles.lowMark} />

        {/* Crew. */}
        {figures.map(figure => <Person key={figure.id} figure={figure} index={figure.id} />)}

        {/* Night. */}
        {dark ? (
          <g className={styles.night}>
            <rect x="0" y="0" width={SCENE_W} height={SCENE_H} className={styles.nightShade} />
            <circle cx="320" cy="26" r="11" className={styles.moon} />
            <circle cx="314" cy="22" r="10" className={styles.moonBite} />
            {hasBuilt(state, "lantern") ? <circle cx="52" cy="206" r="34" className={styles.lanternGlow} /> : null}
          </g>
        ) : null}

        {/* Flood clocks drawn on the bands themselves. */}
        {BANDS.filter(band => band > 0 && band < depth).map(band => {
          const offset = floodOffset(depth, band, reach(state));
          if (typeof offset !== "number") return null;
          const left = offset - elapsed;
          if (left <= 0 || left > 60_000) return null;
          return (
            <text key={band} x={SCENE_W - 10} y={bandTop(band) + 16} textAnchor="end" className={styles.clock} data-soon={left < 15_000 || undefined}>
              {Math.ceil(left / 1000)}s
            </text>
          );
        })}
      </svg>

      {/* Tap targets: one per band, stacked over the drawing, in reading order from the sea to the shore. */}
      <div className={styles.targets}>
        {[...BANDS].reverse().map(band => (
          <button
            key={band}
            type="button"
            className={styles.target}
            aria-pressed={selected === band}
            aria-label={`${BAND_NAMES[band]}: ${describeBand(state, band)}`}
            onClick={() => onSelect(band)}
          >
            <span className={styles.targetName}>{BAND_NAMES[band]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Camp({ state }: { state: State }) {
  const built = (name: Parameters<typeof hasBuilt>[1]) => hasBuilt(state, name);
  return (
    <g className={styles.camp}>
      {/* Hut. */}
      <path d="M24 226 L24 208 L40 196 L56 208 L56 226 Z" className={styles.hut} />
      <rect x="36" y="214" width="8" height="12" className={styles.door} />
      {built("shelter") ? <path d="M62 226 L62 212 L74 203 L86 212 L86 226 Z" className={styles.hut} /> : null}
      {built("kiln") ? <><path d="M96 226 L98 206 L112 206 L114 226 Z" className={styles.kiln} /><rect x="103" y="198" width="4" height="8" className={styles.kiln} /></> : null}
      {built("fishTrap") ? <path d="M120 226 L120 212 L128 212 L128 226 M124 212 L124 204 M118 206 Q124 200 130 206" className={styles.netLines} /> : null}
      {built("sled") ? <path d="M132 222 L142 222 Q146 222 146 218 M134 218 L144 218" className={styles.netLines} /> : null}
      {built("winch") ? <><rect x="210" y="212" width="14" height="10" className={styles.kiln} /><circle cx="217" cy="209" r="4" className={styles.netLines} /></> : null}
      {built("net") ? <path d="M146 226 L146 206 M146 206 L170 206 M170 206 L170 226 M150 210 L166 222 M166 210 L150 222" className={styles.netLines} /> : null}
      {built("raft") ? <rect x="178" y="214" width="26" height="8" className={styles.raft} /> : null}
      {built("bellTower") || built("beacon") ? (
        <g>
          <path d="M318 226 L320 182 L340 182 L342 226 Z" className={styles.tower} />
          <path d="M320 196 L340 196 M319 210 L341 210" className={styles.towerLines} />
          {built("beacon") ? <><path d="M324 182 L330 170 L336 182 Z" className={styles.flame} /><circle cx="330" cy="178" r="16" className={styles.flameGlow} /></> : null}
        </g>
      ) : null}
    </g>
  );
}

function Person({ figure, index }: { figure: Figure; index: number }) {
  const x = 40 + ((index * 73) % 220) + (figure.band === 0 ? 100 : 0);
  const y = bandTop(figure.band) + BAND_H * 0.55;
  const r = 13;
  const circumference = 2 * Math.PI * r;
  return (
    <g className={styles.person} data-queued={figure.queued || undefined} data-hungry={figure.hungry || undefined} transform={`translate(${x} ${y})`}>
      {figure.progress !== null ? (
        <>
          <circle r={r} className={styles.ringTrack} />
          <circle r={r} className={styles.ring} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - figure.progress)} transform="rotate(-90)" />
        </>
      ) : null}
      <circle cy="-5" r="3.2" className={styles.head} />
      <rect x="-2.6" y="-1.5" width="5.2" height="9" rx="1.5" className={styles.body} />
      <text y="24" textAnchor="middle" className={styles.name}>{figure.name}</text>
    </g>
  );
}

export function describeBand(state: State, band: Band): string {
  const flood = floodTime(state, band);
  if (flood === undefined) return "under water this tide";
  if (flood === null) {
    if (band === 0 || band < depthOf(state)) return "dry all tide";
    return beyondWaterline(state, band) === 1 ? "under water · wade, 1.5× time" : "under water · by raft, 2× time";
  }
  const left = flood - state.time;
  if (left <= 0) return "flooded";
  const s = Math.ceil(left / 1000);
  return `floods in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
