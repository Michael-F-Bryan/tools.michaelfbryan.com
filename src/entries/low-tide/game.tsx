"use client";

import { useEffect, useRef, useState } from "react";

import {
  availableJobs, buildOptions, depthOf, floodTime, hasBuilt, isDark, itemLabel, planTrade, producers, score, tideElapsed,
  BAND_NAMES, BANDS, CARGO, CARGO_VALUE, TIDE_MS,
  type Band, type BuildOption, type Cargo, type Crew, type Item, type State,
} from "./model";
import { Scene, describeBand, type Figure } from "./scene";
import { TideChart } from "./tide-chart";
import { useGame } from "./use-game";
import styles from "./game.module.css";

function itemName(item: Item) {
  return itemLabel(item).toLowerCase();
}

/** What a piece of this kind sells for at the turn, or null for building stock, which never sells. */
function priceOf(item: Item): number | null {
  return (CARGO as readonly string[]).includes(item) ? CARGO_VALUE[item as Cargo] : null;
}

/** Cargo as a short list: "2 pearls, brass". A count shows only when there is more than one. */
function cargoList(items: readonly Cargo[]): string {
  return CARGO.map(kind => [kind, items.filter(item => item === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => (count > 1 ? `${count} ${itemName(kind)}${kind === "pearl" ? "s" : ""}` : itemName(kind)))
    .join(", ");
}

/** Kinds as prose: "brass and oil", "iron". */
function joinKinds(kinds: readonly Cargo[]): string {
  const names = kinds.map(itemName);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function seconds(ms: number) {
  return `${Math.round(ms / 1000)}s`;
}

function holdings(state: State, item: Item) {
  return (state.inventory[item] ?? 0) + state.built.filter(built => built === item).length;
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
  const [picked, setPicked] = useState<Band | null>(null);
  const [showLog, setShowLog] = useState(false);
  const endingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state.ended) endingRef.current?.focus({ preventScroll: true });
  }, [state.ended]);

  const elapsed = tideElapsed(state);
  const depth = depthOf(state);
  const dark = isDark(state.tide);
  const idle = state.crew.filter(member => !state.jobs.some(job => job.crew === member.id));
  // Who a tap sends: a free, fed person first; otherwise whoever is back soonest gets the job queued.
  const actor = idle.find(member => member.fed) ?? idle[0] ?? soonestBack(state);
  const queuing = !idle.length;
  const options = actor ? availableJobs(state, actor.id) : [];
  const workable = (band: Band) => {
    const flood = floodTime(state, band);
    return flood !== undefined && (flood === null || state.time < flood);
  };
  const deepest = [...BANDS].reverse().find(workable) ?? 0;
  const selected: Band = picked !== null && workable(picked) ? picked : deepest;
  const food = state.food;
  const hungry = state.crew.filter(member => !member.fed);
  const stock = (Object.keys(state.inventory) as Item[]).filter(item => (state.inventory[item] ?? 0) > 0).sort();
  const plans = buildOptions(state);
  const buildable = plans.filter(plan => plan.ok).length;
  const making = producers(state);
  const trade = planTrade(state);
  const sold = score(state);
  const trading = [
    { id: "ship", label: "Ship", stands: hasBuilt(state, "beacon"), items: trade.ship, value: trade.value.ship, list: cargoList(trade.ship) },
    { id: "trader", label: "Trader", stands: true, items: trade.trader, value: trade.value.trader, list: cargoList(trade.trader) },
    { id: "boat", label: "Boat", stands: hasBuilt(state, "boat"), items: trade.boat, value: trade.value.boat, list: cargoList(trade.boat) },
  ].filter(row => row.stands);

  const figures: Figure[] = state.crew.map(member => {
    const job = state.jobs.find(j => j.crew === member.id);
    return {
      id: member.id,
      name: member.name,
      band: job ? job.band : member.queued ? member.queued.band : 0,
      progress: job ? Math.min(1, Math.max(0, (state.time - job.startedAt) / (job.finishesAt - job.startedAt))) : null,
      queued: !job && member.queued !== null,
      hungry: !member.fed,
    };
  });

  if (state.ended) {
    const end = state.ended;
    const left = CARGO.filter(kind => (end.leftover[kind] ?? 0) > 0).map(kind => `${end.leftover[kind]} ${itemName(kind)}${kind === "pearl" && end.leftover[kind]! > 1 ? "s" : ""}`);
    return (
      <div className={styles.game}>
        <section className={styles.ending} aria-labelledby="low-tide-ending">
          <p className={styles.label}>The twelfth tide is in</p>
          <h2 id="low-tide-ending" ref={endingRef} tabIndex={-1}>Twelve tides worked</h2>
          <p className={styles.score}>
            <span>Score</span> <strong>{end.score}</strong>
            {best ? <span className={styles.best}>{best.score > end.score ? `best on this browser ${best.score}` : best.score === end.score && end.score > 0 ? "your best so far" : ""}</span> : null}
          </p>
          <dl className={styles.breakdown}>
            <dt>Bought by ships</dt><dd>{end.ship}</dd>
            <dt>Bought by the trader</dt><dd>{end.trader}</dd>
            <dt>Carried by your boat</dt><dd>{end.boat}</dd>
          </dl>
          <p className={styles.muted}>{left.length ? `Left on the tarp: ${left.join(", ")}.` : "Nothing left on the tarp."}</p>
          <p className={styles.muted}>
            {state.built.length ? `Built: ${state.built.map(itemName).join(", ")}. ` : "Nothing built. "}
            {hungry.length ? `${hungry.length} went to bed hungry.` : ""}
          </p>
          <button type="button" className={styles.primary} onClick={() => dispatch({ type: "newRun" })}>Work the flat again</button>
          <p className={styles.footnote}>Nothing leaves your browser.</p>
        </section>
      </div>
    );
  }

  const working = state.jobs.filter(job => job.band === selected);
  const here = options.filter(option => option.band === selected);

  return (
    <div className={styles.game} data-paused={state.paused || undefined}>
      <header className={styles.top} data-night={dark || undefined}>
        <TideChart tides={state.tides} current={state.tide} />
      </header>

      <div className={styles.stage}>
        <div className={styles.sceneWrap}>
          <div className={styles.topRow}>
            <p className={styles.tideLabel}>
              <span className={styles.tideNumber}>Tide {state.tide + 1} <span className={styles.of}>of {state.tides.length}</span></span>
              <span className={styles.sold}>Sold {sold}</span>
              <span className={styles.phase}>{phase(state, elapsed, depth, dark)}</span>
            </p>
            {state.paused && state.time === 0 ? null : (
              <button type="button" className={styles.pause} aria-pressed={state.paused} onClick={() => dispatch({ type: state.paused ? "resume" : "pause" })}>
                {state.paused ? "Resume" : "Pause"}
              </button>
            )}
          </div>
          <div className={styles.progress} aria-hidden="true"><span style={{ width: `${(elapsed / TIDE_MS) * 100}%` }} /></div>
          <div className={styles.sceneBox}>
          <Scene state={state} figures={figures} selected={selected} onSelect={setPicked} />
          {state.paused ? (
            <div className={styles.veil} role="status">
              {state.time === 0 ? (
                <>
                  <p><strong>Two of you, twelve tides.</strong> Reef and wreck finds are cargo: at every turn a trader buys your best piece, a boat of your own carries three more, and a lit beacon brings a ship that buys two of every kind. The sooner they stand, the more turns they earn, but the sea only bares the reef and the wreck when the tide is low.</p>
                  <button type="button" className={styles.primary} onClick={() => dispatch({ type: "resume" })}>Begin at low water</button>
                </>
              ) : (
                <p><strong>Paused.</strong> The water waits for you.</p>
              )}
            </div>
          ) : null}
          </div>
        </div>

        <div className={styles.panel}>
          {state.notice ? (
            <p className={styles.notice} role="status">
              {state.notice}{" "}
              <button type="button" className={styles.linkish} onClick={() => dispatch({ type: "dismissNotice" })}>Dismiss</button>
            </p>
          ) : null}
          <section className={styles.section} aria-label={`${BAND_NAMES[selected]} jobs`}>
            <h2 className={styles.label}>
              {BAND_NAMES[selected]} <span>{describeBand(state, selected)}</span>
            </h2>
            {working.length ? (
              <ul className={styles.working} aria-label={`Working on the ${BAND_NAMES[selected].toLowerCase()}`}>
                {working.map(job => {
                  const member = state.crew.find(c => c.id === job.crew);
                  return (
                    <li key={job.id}>
                      <span>{member?.name} · {itemName(job.resource)} · back in {clock(job.finishesAt - state.time)}</span>
                      <button type="button" className={styles.recall} onClick={() => dispatch({ type: "recall", job: job.id })}>Recall {member?.name}</button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {actor ? (
              <div className={styles.options}>
                {here.map(option => {
                  const tight = option.feasible && typeof option.floodsAt === "number" && state.time + option.duration > option.floodsAt - 8_000;
                  // Busy crew, or a job the water or the turn would beat, can still be lined up: it starts the moment it can finish.
                  const later = queuing || !option.feasible;
                  const alreadyQueued = later && actor.queued?.band === selected && actor.queued.resource === option.resource;
                  const why = option.blocked.replace(/\.$/, "").toLowerCase();
                  const price = priceOf(option.resource);
                  const sells = price === null ? null : `sells for ${price}${option.yield > 1 ? " each" : ""}`;
                  return (
                    <button
                      key={option.resource}
                      type="button"
                      disabled={alreadyQueued}
                      data-tight={tight || undefined}
                      data-later={later || undefined}
                      aria-label={`${later ? "Queue" : "Send"} ${actor.name} for ${itemName(option.resource)}, ${seconds(option.duration)}${option.yield > 1 ? `, brings ${option.yield}` : ""}${sells ? `, ${sells}` : ""}${later && !queuing ? `. ${option.blocked} Starts when it can.` : ""}`}
                      onClick={() => dispatch({ type: later ? "queue" : "send", crew: actor.id, band: selected, resource: option.resource })}
                    >
                      <span className={styles.optionName}>{itemName(option.resource)}{option.yield > 1 ? ` ×${option.yield}` : ""}</span>
                      <span className={styles.duration}>
                        {seconds(option.duration)}{alreadyQueued ? " · queued" : queuing ? ` · queue ${actor.name}` : later ? ` · ${why} · queue` : tight ? " · tight" : ""}
                      </span>
                      {sells ? <span className={styles.price}>{sells}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <p className={styles.hint}>Tap another band in the picture to send people there.</p>
          </section>

          <section className={styles.section} aria-label="Crew">
            <ul className={styles.crew} aria-label="Crew">
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
              <li className={styles.food} data-low={food < state.crew.length || undefined}>
                <span>Food {food} · {state.crew.length} {state.crew.length === 1 ? "eats" : "eat"} at the turn</span>
              </li>
            </ul>
            <ul className={styles.producers} aria-label="At the turn">
              {trading.map(row => (
                <li key={row.id} data-ready={row.items.length > 0 || undefined}>
                  <strong>{row.label}</strong> · {row.items.length ? `${row.list} · ${row.value}` : "nothing to sell yet"}
                </li>
              ))}
              {making.map(producer => <li key={producer.id} data-ready={producer.ready || undefined}><strong>{producer.label}</strong> · {producer.next}</li>)}
              {trading.length === 1 ? <li className={styles.quiet}>No boat or beacon yet: only the trader calls, for one piece.</li> : null}
              {trade.held.length ? <li className={styles.quiet}>Traders leave your last {joinKinds(trade.held)} for the workbench until the final turn.</li> : null}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="low-tide-workbench">
            <h2 id="low-tide-workbench" className={styles.label}>Workbench <span>{buildable ? `${buildable} ready to build` : "gather what the plans need"}</span></h2>
            {([1, 2, 3] as const).map(tier => {
              const rows = plans.filter(plan => plan.blueprint.tier === tier);
              const locked = rows.every(plan => plan.locked);
              const list = (
                <ul className={styles.plans} aria-label={`Tier ${tier} blueprints`}>
                  {rows.map(plan => <PlanRow key={plan.blueprint.out} plan={plan} state={state} onBuild={() => dispatch({ type: "build", out: plan.blueprint.out })} />)}
                </ul>
              );
              if (!locked) return <div key={tier}>{list}</div>;
              return (
                <details key={tier} className={styles.tierGroup}>
                  <summary>Tier {tier} · {rows.map(plan => plan.blueprint.label.toLowerCase()).join(", ")} · build something from tier {tier - 1} first</summary>
                  {list}
                </details>
              );
            })}
          </section>

          <section className={styles.section} aria-label="Stock">
            <h2 className={styles.label}>On the tarp</h2>
            {stock.length ? (
              <ul className={styles.stock} aria-label="Salvage">
                {stock.map(item => {
                  const price = priceOf(item);
                  return (
                    <li key={item} data-cargo={price !== null || undefined}>
                      {itemName(item)} <span className={styles.count}>×{state.inventory[item]}</span>
                      {price !== null ? <span className={styles.tag}>cargo · sells {price}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.muted}>Nothing yet. Send someone out.</p>
            )}
          </section>

          <section className={styles.section} aria-label="Log">
            <div className={styles.log} role="log" aria-label="The tides so far">
              {(showLog ? state.log : state.log.slice(-3)).map((entry, index) => (
                <p key={`${entry.time}-${index}`} data-kind={entry.kind}><span className={styles.stamp}>T{Math.min(state.tides.length, Math.floor(entry.time / TIDE_MS) + 1)}</span>{entry.text}</p>
              ))}
            </div>
            {state.log.length > 3 ? (
              <button type="button" className={styles.linkish} aria-expanded={showLog} onClick={() => setShowLog(open => !open)}>{showLog ? "Fewer lines" : "Whole log"}</button>
            ) : null}
            <p className={styles.footnote}>Game time runs only while this page is open and unpaused. Nothing you do here leaves your browser.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function PlanRow({ plan, state, onBuild }: { plan: BuildOption; state: State; onBuild: () => void }) {
  const inputs = (Object.entries(plan.blueprint.inputs) as [Item, number][]).map(([item, need]) => ({ item, need, have: holdings(state, item) }));
  const why = plan.standing || plan.locked || plan.ok || plan.missing.length ? null : plan.why.replace(/\.$/, "").toLowerCase();
  return (
    <li data-ok={plan.ok || undefined} data-standing={plan.standing || undefined} data-locked={plan.locked || undefined}>
      <div className={styles.planText}>
        <strong>{plan.blueprint.label}</strong>
        {plan.standing ? null : <span className={styles.effect}>{plan.blueprint.effect}</span>}
        {plan.standing ? null : (
          <span className={styles.needs}>
            {inputs.map(input => (
              <span key={input.item} className={styles.need} data-have={input.have >= input.need || undefined}>
                {itemName(input.item)}{input.need > 1 ? ` ×${input.need}` : ""} <span className={styles.count}>{Math.min(input.have, input.need)}/{input.need}</span>
              </span>
            ))}
            {why ? <span className={styles.why}>{why}</span> : null}
          </span>
        )}
      </div>
      {plan.standing ? (
        <span className={styles.standing}>built</span>
      ) : (
        <button type="button" className={styles.build} disabled={!plan.ok} aria-label={`Build ${plan.blueprint.label.toLowerCase()}${plan.ok ? "" : `. ${plan.why}`}`} onClick={onBuild}>
          Build
        </button>
      )}
    </li>
  );
}

function soonestBack(state: State): Crew | undefined {
  const unqueued = state.jobs.filter(job => !state.crew.find(member => member.id === job.crew)?.queued);
  const pool = unqueued.length ? unqueued : state.jobs;
  const job = [...pool].sort((a, b) => a.finishesAt - b.finishesAt)[0];
  return job ? state.crew.find(member => member.id === job.crew) : undefined;
}

function phase(state: State, elapsed: number, depth: number, dark: boolean): string {
  const where = depth > 1 ? `out to the ${BAND_NAMES[(depth - 1) as Band].toLowerCase()}` : "barely off the shingle";
  const left = TIDE_MS - elapsed;
  const turn = floodTime(state, (depth - 1) as Band);
  if (typeof turn === "number" && state.time >= turn) return `Rising · turns in ${clock(left)}`;
  return `${dark ? "Dark, water" : "Water"} ${where} · ${clock(left)} left`;
}
