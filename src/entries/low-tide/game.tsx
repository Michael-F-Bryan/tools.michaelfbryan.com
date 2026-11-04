"use client";

import { useEffect, useRef, useState } from "react";

import {
  availableJobs, canCombine, depthOf, floodTime, forecast, isDark, recipeHints, recipeKey, tideElapsed, totalFood,
  BAND_NAMES, BANDS, BUILT_LABELS, RECIPES, RESOURCES, TIDE_MS,
  type Band, type Built, type Crew, type Item, type Resource, type State,
} from "./model";
import { useGame } from "./use-game";
import styles from "./game.module.css";

const BLURB: Record<Band, string> = {
  3: "Brass, iron and oil, when the water lets you near it.",
  2: "Kelp, fish and the odd pearl.",
  1: "Clay, reeds and clams.",
  0: "Driftwood and stone, always dry.",
};

function bandName(band: Band) {
  return `The ${BAND_NAMES[band].toLowerCase()}`;
}

function itemName(item: Item) {
  return (item in RESOURCES ? RESOURCES[item as Resource].label : BUILT_LABELS[item as Built]).toLowerCase();
}

function recipeFor(key: string) {
  return RECIPES.find(recipe => recipeKey(recipe.inputs[0], recipe.inputs[1]) === key) ?? null;
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function seconds(ms: number) {
  return `${Math.round(ms / 1000)}s`;
}

export function Game() {
  const { state, best, dispatch } = useGame();
  if (!state) {
    return (
      <div className={styles.game}>
        <p className={styles.loading} role="status">Reading the tide table…</p>
      </div>
    );
  }
  return <Camp state={state} best={best} dispatch={dispatch} />;
}

type Props = { state: State } & Omit<ReturnType<typeof useGame>, "state">;

function Camp({ state, best, dispatch }: Props) {
  const [picked, setTray] = useState<Item[]>([]);
  const [showCodex, setShowCodex] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const endingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const scroller = logRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [state.log]);

  useEffect(() => {
    if (state.ended) endingRef.current?.focus({ preventScroll: true });
  }, [state.ended]);

  // Items can vanish from under the tray (combined, or a structure consumed), so the tray is derived from what is still held.
  const seen: Partial<Record<Item, number>> = {};
  const tray = picked.filter(item => {
    seen[item] = (seen[item] ?? 0) + 1;
    return holdings(state, item) >= seen[item]!;
  });

  const elapsed = tideElapsed(state);
  const depth = depthOf(state);
  const dark = isDark(state.tide);
  const idle = state.crew.filter(member => !state.jobs.some(job => job.crew === member.id));
  // Who a tap sends: a free, fed person first; otherwise whoever is back soonest gets the job queued.
  const actor = idle.find(member => member.fed) ?? idle[0] ?? soonestBack(state);
  const queuing = !idle.length;
  const options = actor ? availableJobs(state, actor.id) : [];
  const hungry = state.crew.filter(member => !member.fed);
  const food = totalFood(state);
  const spoiling = state.built.includes("smokehouse") ? 0 : state.food.filter(lot => state.tide - lot.tide >= 1).reduce((sum, lot) => sum + lot.amount, 0);
  const inventory = (Object.keys(state.inventory) as Item[]).filter(item => (state.inventory[item] ?? 0) > 0).sort();
  const combinable = [...inventory, ...[...new Set(state.built)].filter(built => RECIPES.some(recipe => recipe.inputs.includes(built)))];
  const trayKey = tray.length === 2 ? recipeKey(tray[0], tray[1]) : null;
  const known = trayKey !== null && state.codex.includes(trayKey);
  const recipe = tray.length === 2 ? canCombine(state, tray[0], tray[1]) : null;
  const knownRecipe = trayKey ? recipeFor(trayKey) : null;
  const inTray = (item: Item) => tray.filter(entry => entry === item).length;
  const hints = recipeHints(state);

  function toggleTray(item: Item) {
    const count = inTray(item);
    if (tray.length < 2 && count < holdings(state, item)) setTray([...tray, item]);
    else {
      const index = tray.lastIndexOf(item);
      setTray(index >= 0 ? tray.filter((_, i) => i !== index) : tray);
    }
  }

  function combine() {
    if (tray.length !== 2) return;
    dispatch({ type: "combine", a: tray[0], b: tray[1] });
    setTray([]);
  }

  function send(band: Band, resource: Resource) {
    if (!actor) return;
    dispatch({ type: queuing ? "queue" : "send", crew: actor.id, band, resource });
  }

  if (state.ended) {
    const end = state.ended;
    return (
      <div className={styles.game}>
        <section className={styles.ending} aria-labelledby="low-tide-ending">
          <p className={styles.label}>{end.reason === "beacon" ? "The beacon is lit" : "The twelfth tide is in"}</p>
          <h2 id="low-tide-ending" ref={endingRef} tabIndex={-1}>
            {end.reason === "beacon" ? `A harbour, on tide ${state.tide + 1}` : "The flat is under water"}
          </h2>
          <p className={styles.score}>
            <span>Score</span> <strong>{end.score}</strong>
            {best ? <span className={styles.best}>{best.score > end.score ? `best on this browser ${best.score}` : best.score === end.score && end.score > 0 ? "your best so far" : ""}</span> : null}
          </p>
          <dl className={styles.breakdown}>
            <dt>Salvage on the tarp</dt><dd>{end.salvage}</dd>
            <dt>{state.built.length} structures standing</dt><dd>{end.structures}</dd>
            {end.beacon ? <><dt>Beacon</dt><dd>{end.beacon}</dd></> : null}
            {end.tidesLeft ? <><dt>{end.tidesLeft} tides to spare</dt><dd>{end.tidesLeftBonus}</dd></> : null}
          </dl>
          <p className={styles.muted}>
            {state.built.length ? `Built: ${state.built.map(itemName).join(", ")}. ` : "Nothing built. "}
            {end.discovered} of {RECIPES.length} recipes in the codex{hungry.length ? `. ${hungry.length} went to bed hungry` : ""}.
          </p>
          <button type="button" className={styles.primary} onClick={() => { dispatch({ type: "newRun" }); setTray([]); }}>Work the flat again</button>
          <p className={styles.footnote}>The codex remembers every recipe you have found, so the next run can race for the beacon from the first tide. Nothing leaves your browser.</p>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.game} data-paused={state.paused || undefined}>
      <header className={styles.tide} data-night={dark || undefined}>
        <div className={styles.tideRow}>
          <p className={styles.tideLabel}>
            <span className={styles.tideNumber}>Tide {state.tide + 1} <span className={styles.of}>of {state.tides.length}</span></span>
            <span className={styles.phase}>{phase(state, elapsed, depth, dark)}</span>
          </p>
          <button type="button" className={styles.pause} aria-pressed={state.paused} onClick={() => dispatch({ type: state.paused ? "resume" : "pause" })}>
            {state.paused ? (state.time === 0 ? "Start" : "Resume") : "Pause"}
          </button>
        </div>
        <div className={styles.progress} aria-hidden="true"><span style={{ width: `${(elapsed / TIDE_MS) * 100}%` }} /></div>
        <ol className={styles.forecast} aria-label="Tide forecast">
          {forecast(state, 4).map((info, i) => (
            <li key={info.tide} aria-current={info.current ? "step" : undefined} data-night={info.dark || undefined}>
              <span className={styles.bars} aria-hidden="true">{[1, 2, 3, 4].map(level => <i key={level} data-on={level <= info.depth || undefined} />)}</span>
              <span className={styles.forecastText} aria-hidden="true">{i === 0 ? "now" : i === 1 ? "next" : `+${i}`}{info.dark ? " · dark" : ""}</span>
              <span className="sr-only">{`Tide ${info.tide + 1}: water out to ${bandName((info.depth - 1) as Band).toLowerCase()}${info.dark ? ", in the dark" : ""}`}</span>
            </li>
          ))}
        </ol>
        {state.paused ? (
          <p className={styles.pausedNote} role="status">
            {state.time === 0
              ? "Two of you, twelve tides, and a flat the sea only half gives back. Send people out while the water is low and combine what they carry home. The prize is a beacon: a lantern on a tower, lit before the twelfth tide. Reeds and driftwood are a start."
              : "Paused. The water waits for you."}
          </p>
        ) : null}
      </header>

      <div className={styles.columns}>
        <section className={styles.flat} aria-label="The flat">
          {[...BANDS].reverse().map(band => {
            const floodsAt = floodTime(state, band);
            const workable = floodsAt !== undefined && (floodsAt === null || state.time < floodsAt);
            const floodIn = typeof floodsAt === "number" ? floodsAt - state.time : null;
            const working = state.jobs.filter(job => job.band === band);
            const here = options.filter(option => option.band === band);
            return (
              <article key={band} className={styles.band} data-exposed={workable || undefined} data-flooding={floodIn !== null && floodIn > 0 && floodIn < 15_000 || undefined} aria-labelledby={`low-tide-band-${band}`}>
                <div className={styles.bandHead}>
                  <h2 id={`low-tide-band-${band}`}>{bandName(band)}</h2>
                  <p className={styles.bandState}>
                    {floodsAt === undefined ? "under water" : !workable ? "flooded" : floodIn !== null ? `floods in ${clock(floodIn)}` : band >= depth ? "reached by raft" : "dry all tide"}
                  </p>
                </div>
                {workable ? <p className={styles.blurb}>{BLURB[band]}</p> : null}
                {working.length ? (
                  <ul className={styles.working} aria-label={`Working on ${bandName(band).toLowerCase()}`}>
                    {working.map(job => {
                      const done = Math.min(1, Math.max(0, (state.time - job.startedAt) / (job.finishesAt - job.startedAt)));
                      const member = state.crew.find(c => c.id === job.crew);
                      return (
                        <li key={job.id}>
                          <span className={styles.jobText}>{member?.name} · {itemName(job.resource)} · back in {clock(job.finishesAt - state.time)}</span>
                          <span className={styles.jobBar} aria-hidden="true"><span style={{ width: `${done * 100}%` }} /></span>
                          <button type="button" className={styles.recall} onClick={() => dispatch({ type: "recall", job: job.id })}>Recall {member?.name}</button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {workable && actor ? (
                  <div className={styles.options}>
                    {here.map(option => {
                      const tight = option.feasible && typeof option.floodsAt === "number" && state.time + option.duration > option.floodsAt - 8_000;
                      const disabled = !queuing && !option.feasible;
                      const alreadyQueued = queuing && actor.queued?.band === band && actor.queued.resource === option.resource;
                      return (
                        <button
                          key={option.resource}
                          type="button"
                          disabled={disabled || alreadyQueued}
                          data-tight={tight || undefined}
                          aria-label={`${queuing ? "Queue" : "Send"} ${actor.name} for ${itemName(option.resource)}, ${seconds(option.duration)}${option.yield > 1 ? `, brings ${option.yield}` : ""}${disabled ? `. ${option.blocked}` : ""}`}
                          onClick={() => send(band, option.resource)}
                        >
                          <span>{itemName(option.resource)}{option.yield > 1 ? ` ×${option.yield}` : ""}</span>
                          <span className={styles.duration}>
                            {seconds(option.duration)}{disabled ? ` · ${option.blocked.replace(/\.$/, "").toLowerCase()}` : alreadyQueued ? " · queued" : queuing ? ` · queue ${actor.name}` : tight ? " · tight" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>

        <section className={styles.camp} aria-label="The camp">
          <div className={styles.section}>
            <h2 className={styles.label}>Crew <span>{idle.length ? `${idle.length} free` : `all out · taps queue for ${actor?.name ?? "nobody"}`}</span></h2>
            <ul className={styles.chips} aria-label="Crew">
              {state.crew.map(member => {
                const job = state.jobs.find(j => j.crew === member.id);
                return (
                  <li key={member.id} data-state={job ? "busy" : "idle"} data-hungry={!member.fed || undefined}>
                    <span>{member.name} · {job ? `on the ${BAND_NAMES[job.band].toLowerCase()}` : "free"}{!member.fed ? " · hungry, half speed" : ""}</span>
                    {member.queued ? (
                      <button type="button" className={styles.unqueue} onClick={() => dispatch({ type: "unqueue", crew: member.id })}>
                        then {itemName(member.queued.resource)} <span aria-hidden="true">×</span><span className="sr-only">, cancel</span>
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className={styles.muted} data-low={food < state.crew.length || undefined}>
              Food {food} for {state.crew.length} {state.crew.length === 1 ? "mouth" : "mouths"} when the tide turns{spoiling ? ` · ${spoiling} goes off after this tide` : ""}.
            </p>
          </div>

          <div className={styles.section}>
            <h2 className={styles.label}>Camp <span>tap two things to combine them</span></h2>
            {combinable.length ? (
              <ul className={styles.chips} aria-label="Salvage">
                {combinable.map(item => (
                  <li key={item}>
                    <button type="button" aria-pressed={inTray(item) > 0} onClick={() => toggleTray(item)}>
                      {itemName(item)} <span className={styles.count}>{(state.inventory[item] ?? 0) > 0 ? `×${state.inventory[item]}` : "built"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>Nothing on the tarp yet. Send someone out.</p>
            )}
            <div className={styles.tray} data-ready={tray.length === 2 || undefined}>
              <span className={styles.slot}>{tray[0] ? itemName(tray[0]) : "…"}</span>
              <span className={styles.plus} aria-hidden="true">+</span>
              <span className={styles.slot}>{tray[1] ? itemName(tray[1]) : "…"}</span>
              <span className={styles.plus} aria-hidden="true">→</span>
              <span className={styles.slot} data-result={recipe ? "yes" : tray.length === 2 ? "no" : undefined}>
                {tray.length < 2 ? "?" : !known ? "untried" : knownRecipe ? knownRecipe.label.toLowerCase() : "nothing"}
              </span>
              <button type="button" className={styles.primary} disabled={tray.length !== 2 || (known && !recipe)} onClick={combine}>
                {known ? "Make it" : "Try it"}
              </button>
            </div>
            {known && knownRecipe && !recipe ? (
              <p className={styles.muted}>{knownRecipe.requires && !state.built.includes(knownRecipe.requires) ? `Needs a ${itemName(knownRecipe.requires)} first.` : knownRecipe.out === "shelter" ? "There is no one else out here to shelter." : "You can't make that right now."}</p>
            ) : null}
            {state.built.length ? (
              <ul className={styles.built} aria-label="Built">
                {state.built.map((item, index) => <li key={`${item}-${index}`}><strong>{itemName(item)}</strong> <span>{RECIPES.find(r => r.out === item)?.effect}</span></li>)}
              </ul>
            ) : null}
            {state.built.includes("beacon") ? (
              <button type="button" className={styles.primary} onClick={() => dispatch({ type: "ring" })}>Ring the beacon</button>
            ) : (
              <p className={styles.muted}>Goal: a beacon, which is a lantern on a bell tower. Everything else buys time or reach.</p>
            )}
            <button type="button" className={styles.linkish} aria-expanded={showCodex} onClick={() => setShowCodex(open => !open)}>
              Codex · {state.codex.length} of {RECIPES.length} recipes{hints.some(hint => hint.held) ? ` · ${hints.filter(hint => hint.held).length} within reach` : ""}
            </button>
            {showCodex ? (
              <ul className={styles.codex} aria-label="Codex">
                {state.codex.map(key => {
                  const found = recipeFor(key);
                  return <li key={key}><span>{key.split("+").map(part => itemName(part as Item)).join(" + ")} → <strong>{found ? found.label.toLowerCase() : "?"}</strong></span>{found ? <span className={styles.muted}>{found.effect}</span> : null}</li>;
                })}
                {hints.map(({ recipe, held }) => (
                  <li key={recipe.out} data-hint>
                    <span>{held ? `${itemName(held)} + ?` : "? + ?"} → <strong>{recipe.label.toLowerCase()}</strong></span>
                    <span className={styles.muted}>{recipe.effect}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div ref={logRef} className={styles.log} role="log" aria-label="The tides so far">
            {state.log.map((entry, index) => (
              <p key={`${entry.time}-${index}`} data-kind={entry.kind}><span className={styles.stamp}>T{Math.min(state.tides.length, Math.floor(entry.time / TIDE_MS) + 1)}</span>{entry.text}</p>
            ))}
          </div>
          <p className={styles.footnote}>Game time runs only while this page is open and unpaused. Nothing you do here leaves your browser.</p>
        </section>
      </div>
    </div>
  );
}

function holdings(state: State, item: Item) {
  return (state.inventory[item] ?? 0) + state.built.filter(built => built === item).length;
}

function soonestBack(state: State): Crew | undefined {
  const unqueued = state.jobs.filter(job => !state.crew.find(member => member.id === job.crew)?.queued);
  const pool = unqueued.length ? unqueued : state.jobs;
  const job = [...pool].sort((a, b) => a.finishesAt - b.finishesAt)[0];
  return job ? state.crew.find(member => member.id === job.crew) : undefined;
}

function phase(state: State, elapsed: number, depth: number, dark: boolean): string {
  const where = depth > 1 ? `out to ${bandName((depth - 1) as Band).toLowerCase()}` : "barely off the shingle";
  const left = TIDE_MS - elapsed;
  const turn = floodTime(state, (depth - 1) as Band);
  if (typeof turn === "number" && state.time >= turn) return `Rising · turns in ${clock(left)}`;
  return `${dark ? "Dark, water" : "Water"} ${where} · ${clock(left)} left`;
}
