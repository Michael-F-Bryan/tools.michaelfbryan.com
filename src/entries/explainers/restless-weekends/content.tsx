import { Figure } from "@/components/figure";
import { Label } from "@/components/label";
import { Prose } from "@/components/prose";
import { Section, SectionTitle } from "@/components/section";
import { Step, Steps } from "@/components/steps";

export default function RestlessWeekends() {
  return (
    <div className="space-y-24 sm:space-y-32">
      <section
        aria-labelledby="note-for-gabbey"
        className="relative overflow-hidden border-y border-rule bg-surface px-6 py-10 sm:px-10 sm:py-14"
      >
        <svg
          aria-hidden="true"
          className="absolute -right-20 -top-24 h-72 w-72 text-accent/10 sm:-right-12"
          viewBox="0 0 240 240"
        >
          <path
            d="M120 24c51 0 92 41 92 92 0 67-92 100-92 100S28 183 28 116c0-51 41-92 92-92Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="16"
          />
          <path
            d="M120 63c30 0 54 24 54 54 0 39-54 58-54 58s-54-19-54-58c0-30 24-54 54-54Z"
            fill="currentColor"
          />
        </svg>

        <div className="relative max-w-[42rem]">
          <Label id="note-for-gabbey">A note for Gabbey</Label>
          <p className="mt-6 text-2xl font-bold leading-snug tracking-title text-balance sm:text-3xl">
            Most weekends I’ll decide I want to build something, open GitHub,
            look through my Documents folder, and wait for one of those old
            projects to feel interesting again.
          </p>
          <Prose className="mt-6 max-w-[38rem]">
            <p>
              It rarely works. The repositories are full of cold context and
              old obligations, so I eventually give up and lie down feeling
              empty, bored and understimulated. That’s usually what is happening
              when I tell you I’m bored despite having plenty of things I could
              do.
            </p>
          </Prose>
        </div>
      </section>

      <Section
        id="free-saturday"
        kicker="A familiar Saturday"
        title="What happens on a free Saturday"
      >
        <Prose>
          <p>
            Sunfish is always easy to reach for. Its problems are current,
            useful and already loaded into my head. I usually avoid doing that
            because turning every spare hour into unpaid work is a reliable way
            to burn myself out. The alternatives ought to be easy—I have years
            of old projects—but none of them gives me a reason to care right
            now.
          </p>
        </Prose>

        <Steps className="mt-10">
          <Step title="Free afternoon">I want something to get absorbed in.</Step>
          <Step title="Look backwards">
            GitHub, Documents and abandoned ideas.
          </Step>
          <Step title="Recover context">Each option begins with homework.</Step>
          <Step title="Give up">
            I’m still restless, now with less momentum.
          </Step>
        </Steps>

        <Prose size="base" className="mt-8">
          <p>
            The interview tested whether I simply needed a small challenge. I
            said I’d probably give one a shot, and I wouldn’t mind if I
            abandoned it or ended up writing instead. That ruled out the idea
            that I needed a serious project or another backlog. I needed
            something that would get me moving.
          </p>
        </Prose>
      </Section>

      <Section
        id="old-habit"
        kicker="Before all this"
        title="The habit I used to have"
      >
        <Prose>
          <p>
            Early in my career, ideas came from whatever I was already doing. A
            CAD library at work would annoy me, so I’d spend an evening trying a
            better design. A problem with FFI or geometry would turn into a
            little tool. I didn’t start with an article premise; I started by
            poking at something that had caught my attention.
          </p>
          <p>
            Once I had something working, I’d write about the interesting part
            and share it on Reddit. Then I’d spend the rest of the evening
            watching the modest trickle of comments and Google Analytics visits.
            Seeing those numbers climb meant the thing had left my laptop and
            reached another person.
          </p>
        </Prose>

        <Figure
          className="mt-10 border-y border-rule bg-surface px-5 py-7 sm:px-8"
          caption="The writing came out of the work. It wasn’t a hurdle I had to clear before I could begin."
        >
          <div className="grid gap-5 text-center sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-center">
            <strong>Notice some friction</strong>
            <span aria-hidden="true" className="hidden text-accent sm:block">
              →
            </span>
            <strong>Build while it is interesting</strong>
            <span aria-hidden="true" className="hidden text-accent sm:block">
              →
            </span>
            <strong>Write down what I learnt</strong>
            <span aria-hidden="true" className="hidden text-accent sm:block">
              →
            </span>
            <strong>Share it with people</strong>
          </div>
        </Figure>
      </Section>

      <Section
        id="lost-habit"
        kicker="What changed"
        title="How I lost that habit"
      >
        <Prose>
          <p>
            The first interruption was fairly blunt: remote work took over my
            life and I was routinely still working at 4am. There wasn’t enough
            time or energy left for personal projects. The job after that left
            me burnt out and pretty disenfranchised with technical work in
            general.
          </p>
          <p>
            By the time I had free evenings again, I’d become much more
            conscious of my reputation. My earlier articles had done reasonably
            well, and I felt pressure to publish something that justified the
            image of a competent software expert. I’d choose a premise, outline
            the article, add dot-points under every heading, and lose momentum
            before I’d built anything worth explaining.
          </p>
          <p>
            I was trying to recover the output of the old habit while starting
            at the wrong end. The useful ideas used to appear while I was making
            something. Now I was asking the article to prove its value before
            curiosity had produced any evidence.
          </p>
        </Prose>
      </Section>

      <section
        aria-labelledby="wedding-site"
        className="relative overflow-hidden border border-rule bg-sand px-6 py-9 sm:px-10 sm:py-12"
      >
        <div
          aria-hidden="true"
          className="absolute -bottom-16 -right-10 h-64 w-40 rounded-t-full border-[20px] border-surface/70"
        />
        <div className="relative grid gap-10 sm:grid-cols-[1.1fr_0.9fr] sm:items-end">
          <div>
            <Label>Something we made together</Label>
            <SectionTitle id="wedding-site" className="mt-4">
              The wedding website
            </SectionTitle>
            <Prose className="mt-7">
              <p>
                The wedding website is the clearest recent example because you
                were there for it. We genuinely needed somewhere to communicate
                the wedding details. The work was within my abilities, but it
                gave me an excuse to practise visual design and spend too long
                on little details simply because I enjoyed them.
              </p>
            </Prose>
            <Prose size="base" className="mt-5">
              <p>
                Showing sneak peeks to family and friends mattered too. The site
                stopped being files on my laptop and became something in the
                lives of people we care about. An equally polished fictional
                demo wouldn’t have held my interest nearly as much.
              </p>
            </Prose>
          </div>

          <figure className="relative border border-rule bg-surface p-3 shadow-[6px_7px_0_0_var(--rule)]">
            <div className="flex items-center gap-1.5 border-b border-rule pb-3">
              <span className="h-2.5 w-2.5 rounded-full bg-error/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#9a6700]/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#3f6b46]/70" />
              <span className="ml-2 font-mono text-[0.65rem] text-muted">
                gabbeyandmichael.wedding
              </span>
            </div>
            <div className="grid min-h-52 place-items-center px-4 py-8 text-center">
              <div>
                <span className="mx-auto block h-20 w-14 rounded-t-full border-2 border-accent/40" />
                <p className="mt-5 text-sm font-bold uppercase tracking-label text-accent">
                  Something real that we could share
                </p>
              </div>
            </div>
          </figure>
        </div>
      </section>

      <Section
        id="restful-building"
        kicker="What I get from it"
        title="Why some building feels restful"
      >
        <Prose>
          <p>
            From the outside, paid engineering and a personal project both look
            like me sitting at a computer and concentrating. The difference is
            what the work asks of me. Work comes with priorities, consequences
            and people relying on the result. A personal project starts with a
            question I chose, and I can change direction or stop without letting
            anyone down.
          </p>
          <p>
            That freedom lets me exercise parts of myself that ordinary work may
            not reach. I can learn some visual design, try a technology I
            wouldn’t use professionally, or make something slightly ridiculous
            because I want to know whether it will work. If it becomes useful,
            that gives me somebody to share it with. If it doesn’t, the afternoon
            can still have been worthwhile.
          </p>
          <p>
            This matters to my wellbeing because passive rest doesn’t always
            settle the feeling that I’m understimulated. Sometimes I recover by
            getting absorbed in a question, following it for a few hours, and
            ending the day with something tangible that didn’t exist before.
          </p>
        </Prose>

        <figure className="mt-10 border-l-2 border-accent bg-surface px-6 py-7 sm:px-8">
          <blockquote className="text-2xl font-bold leading-snug tracking-title">
            “It’s not really that appealing to me.”
          </blockquote>
          <figcaption className="mt-4 leading-7 text-secondary">
            That was my response when the interview suggested a perfectly
            sensible two-hour disk-usage tool. It was small, useful and
            publishable, but I didn’t care about it. The idea still needs to
            catch my curiosity; there isn’t a formula that can do that for me.
          </figcaption>
        </figure>
      </Section>

      <Section
        id="tools-site"
        kicker="Somewhere to put things"
        title="Why I made this site"
      >
        <Prose>
          <p>
            Rejecting that disk tool helped because I immediately thought of
            something I did want: a place where each little tool or visual
            explainer could become real and shareable. The site gives a Saturday
            experiment somewhere to live without requiring me to maintain one
            enormous personal project.
          </p>
          <p>
            Each entry can stand on its own. I can use it to practise visual
            design, publish a short field note if the work taught me something,
            and then leave it alone. There is no schedule and no requirement for
            the next idea to resemble the last one.
          </p>
        </Prose>

        <Figure
          className="mt-10 overflow-hidden border border-rule bg-surface px-5 pb-7 pt-10 sm:px-9"
          caption="I don’t need to fill the shelf for it to be useful."
        >
          <div className="flex min-h-48 items-end justify-center gap-3 sm:gap-6">
            <div className="grid h-28 w-24 place-items-center border border-accent bg-[#e8f2f5] px-3 text-center font-mono text-xs font-bold uppercase tracking-[0.08em] text-accent sm:h-36 sm:w-32">
              One useful thing
            </div>
            <div className="grid h-40 w-16 -rotate-2 place-items-center border border-rule bg-sand px-2 text-center font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-secondary sm:h-48 sm:w-24 sm:text-xs">
              What I learnt
            </div>
            <div className="grid h-20 w-24 rotate-1 place-items-center border border-dashed border-rule bg-paper px-3 text-center font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-muted sm:h-28 sm:w-32 sm:text-xs">
              Room for another idea
            </div>
          </div>
          <div className="h-3 border-x border-b border-rule bg-rule" />
        </Figure>
      </Section>

      <Section
        id="for-gabbey"
        kicker="For Gabbey"
        title="What I want you to understand"
        className="border-y border-rule py-10 sm:py-14"
      >
        <Prose size="xl">
          <p>
            Small personal projects aren’t a demand that every spare hour become
            productive. They give me room to get curious without professional
            pressure, use parts of myself that work doesn’t always reach, and
            make something I can share with people I care about.
          </p>
          <p>
            I still need time with you, sleep, and weekends where I do very
            little. I also need some room to pick up an idea simply because it
            interests me and see where it goes. When I get that balance right, I
            usually feel better than I did when the weekend started.
          </p>
        </Prose>
      </Section>
    </div>
  );
}
