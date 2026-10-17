"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import {
  ENDINGS, NOUNS, PLACES, PLACE_ORDER, REACH, SEARCH_TURNS, VERBS, WORDS,
  arrival, clock, decoyActive, initialState, placeActions, planSpell, reduce, split, topics, vaelAwake,
  type Action, type EndingId, type GameState, type Noun, type Verb,
} from "./model";
import { mountTowerScene, type TowerScene } from "./scene";
import styles from "./game.module.css";

type Session = { game: GameState; found: EndingId[] };

function session(state: Session, action: Action): Session {
  const game = reduce(state.game, action);
  const ending = game.ending;
  return { game, found: ending && !state.found.includes(ending) ? [...state.found, ending] : state.found };
}

export function Game() {
  const [{ game, found }, dispatch] = useReducer(session, undefined, () => ({ game: initialState(), found: [] }));
  const [verb, setVerb] = useState<Verb | null>(null);
  const [noun, setNoun] = useState<Noun | null>(null);
  const [share, setShare] = useState(false);
  const [spoken, setSpoken] = useState<{ id: number; text: string } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const tower = useRef<TowerScene | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const here = useRef<HTMLHeadingElement>(null);
  const endingHeading = useRef<HTMLHeadingElement>(null);
  const dispatchRef = useRef(dispatch);

  useEffect(() => {
    const host = canvasHost.current, root = stage.current;
    if (!host || !root) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const scene = mountTowerScene(host, { onSelect: place => dispatchRef.current({ type: "go", place }), reducedMotion: () => motion.matches });
    root.dataset.renderer = scene ? "webgl" : "unavailable";
    tower.current = scene;
    return () => {
      scene?.dispose();
      tower.current = null;
    };
  }, []);

  useEffect(() => {
    tower.current?.update(game);
    const scroller = log.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    // A one-off action's button disappears once used; keep keyboard focus in the game.
    if (game.ending) endingHeading.current?.focus({ preventScroll: true });
    else if (document.activeElement === document.body) here.current?.focus({ preventScroll: true });
  }, [game]);

  const act = (action: Action) => dispatch(action);
  const asleep = !vaelAwake(game);
  const sharing = share && !asleep;
  const plan = verb && noun ? planSpell(game, verb, noun, sharing) : null;
  const costs = plan ? split(plan.cost, sharing) : null;
  const lethal = Boolean(plan && costs && costs.rider >= game.energy);
  const vaelShort = Boolean(costs && costs.vael > 0 && costs.vael > game.vaelEnergy - 5);
  const confirming = Boolean(plan?.objection && game.objected.includes(plan.key));
  const left = Math.max(0, arrival(game) - game.minutes);
  const dawn = game.dawn;

  function cast() {
    if (!verb || !noun) return;
    const action: Action = { type: "cast", verb, noun, share: sharing };
    const next = reduce(game, action);
    act(action);
    if (next.minutes !== game.minutes || next.ending) {
      tower.current?.cast(verb);
      setSpoken({ id: next.log.length, text: `${WORDS[verb].word} ${WORDS[noun].word}` });
      setVerb(null);
      setNoun(null);
    }
  }

  function restart() {
    act({ type: "restart" });
    setVerb(null);
    setNoun(null);
    setShare(false);
    setSpoken(null);
    requestAnimationFrame(() => here.current?.focus());
  }

  return (
    <div className={styles.game}>
      <div ref={stage} className={styles.stage} data-renderer="loading" aria-label="The watchtower" role="region">
        <div ref={canvasHost} className={styles.canvas} />
        <p className={styles.fallback}>The tower can’t be drawn in this browser, but the night still plays out below.</p>
        <p className="sr-only">{describe(game)}</p>
        <div className={styles.hud} data-dawn={dawn && !game.ending ? true : undefined}>
          <p className={styles.time}>
            <span className={styles.clock}>{clock(game.minutes)}</span>
            <span>{game.ending ? "The night is over" : dawn ? `Dawn · turn ${dawn.turn + 1}` : left <= 60 ? `They arrive in ${duration(left)}` : `Dawn in ${duration(left)}`}</span>
          </p>
          <p className={styles.threat} data-alerted={game.alerted || undefined}>{threat(game)}</p>
          <div className={styles.night} aria-hidden="true"><span style={{ width: `${Math.min(100, (game.minutes / arrival(game)) * 100)}%` }} /></div>
          <Strength label="You" value={game.energy} />
          <Strength label="Vael" value={game.vaelEnergy} note={asleep ? "asleep" : undefined} />
          {dawn && !game.ending ? (
            <div className={styles.siege}>
              <p className={styles.threat}>{dawn.soldiers} soldiers · {dawn.found ? "coming up the hill" : `searching, ${Math.max(0, SEARCH_TURNS - dawn.turn)} turns of patience left`}</p>
              {dawn.found
                ? <Strength label="Nerve" value={dawn.nerve} />
                : <Strength label="Alarm" value={dawn.suspicion} />}
              <ol className={styles.track} aria-label="How close they are">
                {REACH.map((name, i) => <li key={name} aria-current={dawn.found && i === dawn.reach ? "step" : undefined} data-passed={dawn.found && i < dawn.reach || undefined}>{name}</li>)}
              </ol>
            </div>
          ) : null}
        </div>
        {spoken ? <p key={spoken.id} className={styles.spoken} aria-hidden="true" onAnimationEnd={() => setSpoken(null)}>{spoken.text}</p> : null}
      </div>

      <div className={styles.panel}>
        <div className={styles.scroll}>
          <div ref={log} className={styles.log} role="log" aria-label="The night so far">
            {game.log.map(entry => (
              <p key={entry.id} className={styles[entry.speaker]}>
                {entry.speaker === "vael" ? <span className={styles.speaker}>Vael</span> : null}
                {entry.text}
              </p>
            ))}
          </div>

          {game.ending ? (
            <section className={styles.ending} aria-labelledby="cost-ending">
              <p className={styles.label}>{ENDINGS[game.ending].survived ? "You survived the night" : "The night is over"}</p>
              <h2 id="cost-ending" ref={endingHeading} tabIndex={-1}>{ENDINGS[game.ending].title}</h2>
              <p>{ENDINGS[game.ending].text}</p>
              <p className={styles.muted}>{clock(game.minutes)} · {game.words.length} of 8 words learned · Endings found: {found.length} of 6</p>
              <ul className={styles.found} aria-label="Endings found">
                {(Object.keys(ENDINGS) as EndingId[]).map(id => (
                  <li key={id} data-found={found.includes(id)}>{found.includes(id) ? ENDINGS[id].title : "· · ·"}</li>
                ))}
              </ul>
              <p className={styles.muted}>There are four ways to see the morning.</p>
              <button type="button" className={styles.primary} onClick={restart}>Begin the night again</button>
            </section>
          ) : (
            <>
              <section className={styles.section} aria-labelledby="cost-words">
                <h2 id="cost-words" className={styles.label}>Words <span>{game.words.length} of 8 known</span></h2>
                <div className={styles.wordRows}>
                  <WordRow legend="Do" options={VERBS} known={game.words} selected={verb} onSelect={setVerb} />
                  <WordRow legend="To" options={NOUNS} known={game.words} selected={noun} onSelect={setNoun} />
                </div>
                {plan ? (
                  <div className={styles.plan} data-danger={lethal || vaelShort || undefined}>
                    <p><strong>{WORDS[verb!].word} {WORDS[noun!].word}</strong> · {plan.meaning}</p>
                    <p className={styles.cost}>
                      Cost {plan.cost}{sharing ? ` (you ${costs!.rider}, Vael ${costs!.vael})` : ""} · {dawn ? (plan.target && verb !== "still" ? "one turn, and loud" : "one turn") : `${plan.minutes} min`}
                      {lethal ? <strong> · This would kill you.</strong> : vaelShort ? <strong> · Vael can’t spare that.</strong> : null}
                    </p>
                  </div>
                ) : (
                  <p className={styles.muted}>Choose a word to do and a word to do it to. What they mean depends on where you stand.</p>
                )}
                <div className={styles.castRow}>
                  <label className={styles.share}>
                    <input type="checkbox" checked={sharing} disabled={asleep} onChange={event => setShare(event.target.checked)} />
                    Share the cost with Vael
                  </label>
                  <button type="button" className={styles.primary} disabled={!plan} onClick={cast}>{confirming ? "Speak anyway" : "Speak the words"}</button>
                </div>
              </section>

              <section className={styles.section} aria-labelledby="cost-here">
                <h2 id="cost-here" ref={here} tabIndex={-1} className={styles.label}>{PLACES[game.place].name}{dawn ? <span>at dawn</span> : null}</h2>
                {dawn ? <p className={styles.muted}>{dawn.found ? "Break their nerve before they reach the doorway. Every word, roar and step costs a turn." : "If they see nothing and hear nothing, they will give up. Every word but hesh carries in the quiet."}</p> : null}
                <div className={styles.buttons}>
                  {placeActions(game).map(choice => (
                    <button key={choice.id} type="button" onClick={() => act({ type: "do", id: choice.id })}>
                      {choice.label}{choice.minutes && !dawn ? <> <span>{choice.minutes} min</span></> : null}
                    </button>
                  ))}
                  {dawn ? null : <button type="button" onClick={() => act({ type: "wait" })}>Wait for dawn</button>}
                </div>
              </section>

              <section className={styles.section} aria-labelledby="cost-where">
                <h2 id="cost-where" className={styles.label}>Go to{dawn ? <span>a turn each</span> : null}</h2>
                <div className={styles.places}>
                  {PLACE_ORDER.map(place => (
                    <button key={place} type="button" aria-pressed={place === game.place} onClick={() => act({ type: "go", place })}>
                      {PLACES[place].name}
                    </button>
                  ))}
                </div>
              </section>

              <section className={styles.section} aria-labelledby="cost-vael">
                <h2 id="cost-vael" className={styles.label}>Speak with Vael <span>mind to mind</span></h2>
                {dawn ? <p className={styles.muted}>No time to talk. She is with you, every second of it.</p> : asleep ? <p className={styles.muted}>Vael is asleep.</p> : (
                  <div className={styles.buttons}>
                    {topics(game).map(choice => (
                      <button key={choice.id} type="button" onClick={() => act({ type: "talk", topic: choice.id })}>{choice.label}</button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          <p className={styles.footnote}>An original small game inspired by the Inheritance books. Its characters, words, and tower are invented. Nothing you do here leaves your browser.</p>
        </div>
      </div>
    </div>
  );
}

function WordRow<T extends Verb | Noun>({ legend, options, known, selected, onSelect }: { legend: string; options: readonly T[]; known: readonly string[]; selected: T | null; onSelect: (value: T | null) => void }) {
  return (
    <fieldset className={styles.words}>
      <legend>{legend}</legend>
      {options.map(id => known.includes(id) ? (
        <button key={id} type="button" aria-pressed={selected === id} onClick={() => onSelect(selected === id ? null : id)}>
          <span className={styles.ancient}>{WORDS[id].word}</span>{" "}
          <span className={styles.gloss}>{WORDS[id].gloss}</span>
        </button>
      ) : (
        <span key={id} className={styles.unknown}><span aria-hidden="true">· · ·</span><span className="sr-only">An undiscovered word</span></span>
      ))}
    </fieldset>
  );
}

function Strength({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <p className={styles.strength} data-low={value < 25 || undefined}>
      <span>{label}</span>
      <span className={styles.bar} aria-hidden="true"><span style={{ width: `${value}%` }} /></span>
      <span>{value}{note ? ` · ${note}` : ""}</span>
    </p>
  );
}

function threat(s: GameState): string {
  if (s.ending) return s.ending === "flight" ? "The sky" : "Dawn";
  if (s.dawn) return s.dawn.found ? "They have found you" : "They are searching the hill";
  if (s.alerted) return "They know you are here";
  if (s.torchesSnuffed) return "Their torches are out";
  if (s.minutes >= 90) return "Torches on the north road";
  return "The road is dark";
}

function duration(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function describe(s: GameState): string {
  const fire = { lit: "The campfire burns brightly.", hidden: "The campfire burns without light.", out: "The campfire is out.", gone: "The campfire is gone." }[s.fire];
  const stair = { open: "The outside stair is open.", blocked: "The outside stair is buried in rubble.", iced: "The outside stair is sheeted in ice." }[s.stair];
  const vael = `${s.vaelHidden ? "Vael is disguised as rubble" : "Vael lies against the wall"}, ${vaelAwake(s) ? "awake" : "asleep"}, her wing ${["badly broken", "half mended", "healed"][s.wing]}.`;
  const extras = [s.doorHidden && "The doorway is disguised as wall.", s.wallMended && "The breach is walled up.", decoyActive(s) && "A wandering light drifts in the valley."].filter(Boolean).join(" ");
  const siege = s.dawn ? (s.dawn.found ? ` ${s.dawn.soldiers} soldiers have reached the ${REACH[s.dawn.reach].toLowerCase()}.` : ` ${s.dawn.soldiers} soldiers are searching the foot of the hill.`) : "";
  return `You are at ${PLACES[s.place].name.toLowerCase()}. ${fire} ${stair} ${vael} ${extras}${siege}`;
}
