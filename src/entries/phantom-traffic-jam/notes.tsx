import type { ReactNode } from "react";

import { Prose } from "@/components/prose";
import { Section } from "@/components/section";

import { CORNER_BRAKING_ONSET } from "./driver";
import { DEFAULT_CONFIG, DEFAULT_CORNERING, DEFAULT_DT, DEFAULT_MERGING, ROAD } from "./parameters";
import {
  BRAKE_LIGHT_OFF,
  BRAKE_LIGHT_ON,
  HOLD_LIMIT,
  MERGE_CLEARANCE,
  PHYSICAL_BRAKING_LIMIT,
  TAP_DECELERATION,
  TAP_DURATION,
} from "./simulation";
import { cornerLimit, trackFor } from "./track";

const SOURCES = [
  {
    href: "https://doi.org/10.1088/1367-2630/10/3/033001",
    title: "Traffic jams without bottlenecks—experimental evidence for the physical mechanism of the formation of a jam",
    detail: "Sugiyama et al. (2008), New Journal of Physics 10, 033001",
  },
  {
    href: "https://arxiv.org/abs/cond-mat/0002177",
    title: "Congested traffic states in empirical observations and microscopic simulations",
    detail: "Treiber, Hennecke & Helbing (2000), Physical Review E 62, 1805",
  },
  {
    href: "https://arxiv.org/abs/cond-mat/0404736",
    title: "Delays, inaccuracies and anticipation in microscopic traffic models",
    detail: "Treiber, Kesting & Helbing (2006), Physica A 360, 71",
  },
  {
    href: "https://www.akesting.de/download/MOBIL_TGF07.pdf",
    title: "General lane-changing model MOBIL for car-following models",
    detail: "Kesting, Treiber & Helbing (2007), Transportation Research Record 1999, 86",
  },
] as const;

/** A display equation. It scrolls sideways on its own rather than widening the page. */
function Equation({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div
      className="max-w-measure overflow-x-auto py-1 font-serif text-lg leading-9 text-ink sm:text-xl"
      tabIndex={0}
      role="group"
      aria-label="Equation"
    >
      {children}
    </div>
  );
}

const sub = (text: string) => <sub>{text}</sub>;
const kmh = (ms: number) => Math.round(ms * 3.6);

/** Written notes beneath the experiment: definitions, the model, its limits, sources. */
export function Notes() {
  const b = trackFor("b");
  const merge = trackFor("merge");
  const junction = merge.junction!;
  const zoneLength = Math.round(junction.zoneMainEnd - junction.zoneMainStart);
  return (
    <div className="mt-16 space-y-16 sm:mt-20">
      <Section id="ptj-model" kicker="Notes" title="The driver model">
        <div className="space-y-6">
          <Prose>
            <p>
              Each driver follows the Intelligent Driver Model (Treiber, Hennecke &amp; Helbing, 2000). It asks
              for an acceleration
            </p>
          </Prose>
          <Equation>
            <span className="whitespace-nowrap"><var>a</var><sub>request</sub> = <var>a</var></span>{" "}
            <span className="whitespace-nowrap">[ 1 &minus; (<var>v</var>/<var>v</var>{sub("0")})<sup>4</sup></span>{" "}
            <span className="whitespace-nowrap">&minus; (<var>s</var>*/<var>s</var>)<sup>2</sup> ]</span>
          </Equation>
          <Prose>
            <p>where the gap the driver wants is</p>
          </Prose>
          <Equation>
            <span className="whitespace-nowrap"><var>s</var>* = <var>s</var>{sub("0")}</span>{" "}
            <span className="whitespace-nowrap">+ max( 0,</span>{" "}
            <span className="whitespace-nowrap"><var>v</var>&middot;<var>T</var></span>{" "}
            <span className="whitespace-nowrap">+ <var>v</var>&middot;&Delta;<var>v</var>/(2&radic;(<var>a</var><var>b</var>)) )</span>
          </Equation>
          <Prose size="base">
            <p>
              Here <var>v</var> is speed, <var>s</var> the gap to the car ahead, &Delta;<var>v</var> the closing
              speed, <var>v</var>{sub("0")} the desired speed, <var>T</var> the following time gap, <var>a</var> the
              acceleration, <var>b</var> the comfortable braking and <var>s</var>{sub("0")} the stopped gap.
            </p>
          </Prose>
          <Prose>
            <p>
              Plain IDM has no reaction delay. Here each driver evaluates those equations on what they saw
              one reaction delay earlier, which is the finite-reaction-time part of the Human Driver Model in
              Treiber, Kesting &amp; Helbing (2006), without its estimation errors or anticipation. All cars
              decide from the same instant and then all move, in fixed {DEFAULT_DT} s steps whatever the
              playback speed; &ldquo;Run ahead&rdquo; takes the same steps, only faster. Vehicles are{" "}
              {ROAD.vehicleLength} m long with a {ROAD.minimumGap} m stopped gap; the ring is {ROAD.length} m round.
            </p>
            <p>
              Comfortable braking is a driver preference; the vehicle&rsquo;s separate, fixed physical limit is{" "}
              {PHYSICAL_BRAKING_LIMIT} m/s&sup2;. Brake lights come on when a car is decelerating harder than{" "}
              {Math.abs(BRAKE_LIGHT_ON)} m/s&sup2; and go off below {Math.abs(BRAKE_LIGHT_OFF)} m/s&sup2;; they are
              inferred from motion, as the model has no pedals.
            </p>
          </Prose>
          <Prose>
            <p>
              The only interventions are brake taps: one car is held to at least {TAP_DECELERATION} m/s&sup2; of
              braking for {TAP_DURATION} s, or for as long as its brake is held, up to {HOLD_LIMIT} s. Nothing
              random happens after the start; the &ldquo;slightly jumbled&rdquo; start offsets each car once,
              from the seed.
            </p>
          </Prose>
        </div>
      </Section>

      <Section id="ptj-bends" kicker="Roads" title="Bends: the B circuit">
        <Prose>
          <p>
            A road here is a chain of straights and arcs; a car&rsquo;s state is one number, metres along its
            lane, and gaps are measured along the lane, never across the map. The B circuit is{" "}
            {Math.round(b.lanes[0].length)} m round with five bends, and its waist passes within a lane&rsquo;s
            width of its spine while the two are over a hundred metres apart by road: a car there has no
            idea the other is near, and nor should it.
          </p>
          <p>
            Every bend has a speed, &radic;(<var>a</var><sub>lat</sub>&middot;<var>r</var>), from its radius and
            the sideways acceleration drivers accept (&ldquo;Cornering comfort&rdquo;, {DEFAULT_CORNERING} m/s&sup2;
            by default: {kmh(cornerLimit(1 / 20, DEFAULT_CORNERING))} km/h round the lobes,{" "}
            {kmh(cornerLimit(1 / 5.5, DEFAULT_CORNERING))} km/h through the waist). Inside a bend the desired speed
            is capped at it. Ahead of a bend the driver works out the steady braking that would just reach
            its speed at its start, <var>b</var><sub>kin</sub> = (<var>v</var>&sup2; &minus; <var>v</var><sub>bend</sub>&sup2;)/2<var>d</var>,
            and once that reaches {CORNER_BRAKING_ONSET * 100}% of their comfortable braking asks for
            &minus;<var>b</var><sub>kin</sub>&sup2;/<var>b</var>: IDM&rsquo;s own strategy for a slower car ahead,
            gentle at first and firming up towards <var>b</var>, so braking begins well before the bend and the
            car arrives close to its speed, then pulls away once out. The road is known in advance, so the
            reaction delay applies to traffic, not to bends. The ring keeps its original idealisation of no
            cornering at all, so its experiments stay comparable with the published ones.
          </p>
        </Prose>
      </Section>

      <Section id="ptj-merging" kicker="Roads" title="Merging: the on-ramp">
        <Prose>
          <p>
            On the merge track a fixed share of cars leave the ring at a slip road, cut across the inside, and
            must get back on from a {zoneLength} m stretch beside the ring (the merge zone, in blue) before their
            lane ends. The convention is give-way: the ring has right of way, a ramp driver may only move over
            into a gap that works, and a ramp driver who never finds one stops at the end of the lane and waits.
            Nothing is teleported or nudged into place.
          </p>
          <p>
            &ldquo;Works&rdquo; is the safety criterion of MOBIL (Kesting, Treiber &amp; Helbing, 2007): the
            ring car that would end up behind must not be asked to brake harder than an acceptable amount
            (&ldquo;Acceptable merge braking&rdquo;, {DEFAULT_MERGING.acceptableBraking} m/s&sup2; by default),
            predicted with its own car-following model from the gap and closing speed it would then have; the
            same test is applied to the merging car, and both gaps must be at least the {MERGE_CLEARANCE} m
            stopped gap. MOBIL&rsquo;s incentive criterion decides whether an optional lane change is worth it;
            a ramp car has no option, so it is not used here, and the rest of the merge behaviour is this
            page&rsquo;s own, not MOBIL: a ramp driver in the zone will not run into the ring car they mean to
            slot in behind, eases off to fall in behind a faster car that will not make room, and otherwise holds
            their course. A ring driver may cooperate: the one directly behind a zone car treats it as a car in
            front, braking for it up to &ldquo;Cooperation&rdquo; &times; their comfortable braking (0% never
            makes room; 100% is a zipper). When several ramp cars ask to move over in the same step they are
            settled furthest-along first, each judged against the ring as it will be with the earlier ones in it.
          </p>
          <p>
            Drivers look across lanes at where cars are now; the reaction delay still governs how everyone
            follows the car in front. So the ring driver behind a newcomer reacts to it late, and a merge that
            passed the criterion can still end in a collision on this model&rsquo;s terms, which is reported
            like any other. With everyone keeping the default {DEFAULT_CONFIG.driver.timeGap} s following gap
            and no cooperation, there is no gap in ring traffic that satisfies the criterion at any sensible
            density: nobody gets in, and the ramp queues. That is the model being consistent, not a fault;
            turn cooperation up, or the following gap down, and watch what the merging then does to the flow
            past the zone.
          </p>
        </Prose>
      </Section>

      <Section id="ptj-limits" kicker="Limits" title="What this does not show">
        <Prose>
          <p>
            This illustrates a mechanism. It is not a calibrated prediction of real traffic, and the thresholds
            at which jams appear belong to this model and these parameters.
          </p>
          <p>
            There is one lane per road, no overtaking and identical vehicle lengths. Lane changes are
            instantaneous in the model and only drawn as a slide; there is no lateral dynamics, no tyre model
            and no skidding, so a car that enters a bend too fast simply brakes harder. Sugiyama et al. put 22
            cars on a 230 m track; the default here uses fewer ({DEFAULT_CONFIG.carCount}) and a longer time
            gap, so it shows the same phenomenon without reproducing that experiment.
          </p>
          <p>
            Delay, and in &ldquo;Mixed drivers&rdquo; fixed per-driver differences, are the only human
            imperfections modelled. Real drivers also misjudge and anticipate, and Treiber et al. (2006) argue
            that anticipation largely offsets reaction time. With delay alone, a long delay against a short time
            gap makes cars collide, and holding a brake in dense, fast traffic can too; the run then stops and
            says so instead of separating them. The same goes for a ramp car that cannot stop before its lane
            ends.
          </p>
        </Prose>
      </Section>

      <Section id="ptj-sources" kicker="Sources" title="Sources">
        <ul className="max-w-measure space-y-4 text-lg leading-8 text-secondary">
          {SOURCES.map((source) => (
            <li key={source.href}>
              <a
                href={source.href}
                className="font-bold text-ink underline underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                {source.title}
              </a>
              <span className="block text-base text-muted">{source.detail}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
