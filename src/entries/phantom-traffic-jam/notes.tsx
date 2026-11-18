import type { ReactNode } from "react";

import { Prose } from "@/components/prose";
import { Section } from "@/components/section";

import { DEFAULT_DT, DEFAULT_CONFIG, PRESETS, ROAD } from "./parameters";
import {
  BRAKE_LIGHT_OFF,
  BRAKE_LIGHT_ON,
  PHYSICAL_BRAKING_LIMIT,
  TAP_DECELERATION,
  TAP_DURATION,
} from "./simulation";

const SLOW_DELAY = PRESETS.find((preset) => preset.id === "slow")?.config.driver.reactionDelay;
const QUICK_DELAY = PRESETS.find((preset) => preset.id === "tap")?.config.driver.reactionDelay;

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
] as const;

function Term({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  return (
    <div>
      <dt className="font-bold text-ink">{name}</dt>
      <dd className="mt-1 text-secondary">{children}</dd>
    </div>
  );
}

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

/** Written notes beneath the experiment: definitions, the model, its limits, sources. */
export function Notes() {
  return (
    <div className="mt-16 space-y-16 sm:mt-20">
      <Section id="ptj-reading" kicker="Notes" title="Reading the page">
        <dl className="max-w-measure space-y-5 text-lg leading-8">
          <Term name="Following time gap">
            How far behind the car ahead a driver wants to sit, in seconds of travel at their current speed.
          </Term>
          <Term name="Reaction delay">
            How old the information is that the driver acts on. It is independent of the time gap: a driver can
            follow at a generous gap and still respond late.
          </Term>
          <Term name="Comfortable braking">
            The deceleration a driver aims for when closing in, not the car&rsquo;s limit. The vehicle&rsquo;s
            physical limit is separate and fixed at {PHYSICAL_BRAKING_LIMIT} m/s&sup2;.
          </Term>
          <Term name="Speed spread">
            The standard deviation of speed across all cars at one instant: near zero when traffic flows
            evenly, large when some cars are stopped while others move.
          </Term>
          <Term name="Brake lights">
            Lit when a car is decelerating harder than {Math.abs(BRAKE_LIGHT_ON)} m/s&sup2; and off again once
            it eases below {Math.abs(BRAKE_LIGHT_OFF)} m/s&sup2;. They are inferred from motion; the model has no
            pedals.
          </Term>
          <Term name="Brake tap">
            One car is held to at least {TAP_DECELERATION} m/s&sup2; of braking for {TAP_DURATION} s, then
            released. That is the only intervention. Nothing random happens after the start; the slightly
            jumbled start moves each car by a small seeded offset, once.
          </Term>
          <Term name="History view">
            The ring cut at the 0&nbsp;m marker and laid flat, with time running down. Each line is a car,
            moving right. Where a car slows its line darkens and steepens; those kinks line up into the jam,
            which drifts left: backwards along the road.
          </Term>
        </dl>
      </Section>

      <Section id="ptj-model" kicker="Model" title="The driver model">
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
              playback speed.
            </p>
            <p>
              The geometry is fixed: a {ROAD.length} m ring, {ROAD.vehicleLength} m cars and a {ROAD.minimumGap} m
              stopped gap. &ldquo;One brake tap&rdquo; and &ldquo;Slow reactions&rdquo; differ only in reaction
              delay, {QUICK_DELAY} s against {SLOW_DELAY} s.
            </p>
          </Prose>
        </div>
      </Section>

      <Section id="ptj-limits" kicker="Limits" title="What this does not show">
        <Prose>
          <p>
            This illustrates a mechanism. It is not a calibrated prediction of real traffic, and the thresholds
            at which jams appear belong to this model and these parameters.
          </p>
          <p>
            There is one lane, no overtaking and identical vehicle lengths. The ring is one-dimensional: a road
            with no ends, no cornering and no lateral limits, so the higher desired speeds are not something a
            real car could hold on a ring this small.
          </p>
          <p>
            Sugiyama et al. put 22 cars on a 230 m track. The default here uses fewer
            ({DEFAULT_CONFIG.carCount}) and a longer time gap, so it shows the same phenomenon without
            reproducing that experiment.
          </p>
          <p>
            Delay is the only human imperfection modelled. Real drivers also misjudge distances and look
            further ahead, and Treiber et al. (2006) argue that anticipation largely offsets reaction time in
            real traffic. With delay alone, a long delay against a short time gap makes cars collide; when that
            happens the run stops and says so instead of quietly separating them. Brake lights are inferred from
            deceleration, and there are no pedals, engines or fuel.
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
