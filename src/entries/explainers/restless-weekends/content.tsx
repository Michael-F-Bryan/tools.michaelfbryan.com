export default function RestlessWeekends() {
  return (
    <div className="mt-12 space-y-24 pb-12 sm:mt-16 sm:space-y-32">
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
          <p
            id="note-for-gabbey"
            className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-accent"
          >
            A note for Gabbey
          </p>
          <p className="mt-6 text-2xl font-bold leading-[1.35] tracking-[-0.02em] text-balance sm:text-3xl">
            Most weekends I’ll decide I want to build something, open GitHub,
            look through my Documents folder, and wait for one of those old
            projects to feel interesting again.
          </p>
          <p className="mt-6 max-w-[38rem] text-lg leading-8 text-secondary">
            It rarely works. The repositories are full of cold context and old
            obligations, so I eventually give up and lie down feeling empty,
            bored and understimulated. That’s usually what is happening when I
            tell you I’m bored despite having plenty of things I could do.
          </p>
        </div>
      </section>

      <section aria-labelledby="free-saturday">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">
          A familiar Saturday
        </p>
        <h2
          id="free-saturday"
          className="mt-4 text-3xl font-bold leading-tight tracking-[-0.03em] text-balance sm:text-4xl"
        >
          What happens on a free Saturday
        </h2>
        <p className="mt-6 max-w-[44rem] text-lg leading-8 text-secondary">
          Sunfish is always easy to reach for. Its problems are current, useful
          and already loaded into my head. I usually avoid doing that because
          turning every spare hour into unpaid work is a reliable way to burn
          myself out. The alternatives ought to be easy—I have years of old
          projects—but none of them gives me a reason to care right now.
        </p>

        <ol className="mt-10 grid overflow-hidden border border-rule bg-surface sm:grid-cols-4">
          {[
            ["01", "Free afternoon", "I want something to get absorbed in."],
            ["02", "Look backwards", "GitHub, Documents and abandoned ideas."],
            ["03", "Recover context", "Each option begins with homework."],
            ["04", "Give up", "I’m still restless, now with less momentum."],
          ].map(([number, title, body], index) => (
            <li
              className={`relative px-5 py-6 ${
                index > 0 ? "border-t border-rule sm:border-l sm:border-t-0" : ""
              }`}
              key={number}
            >
              <span className="font-mono text-xs font-bold text-accent">
                {number}
              </span>
              <strong className="mt-3 block text-lg">{title}</strong>
              <span className="mt-2 block text-sm leading-6 text-muted">
                {body}
              </span>
              {index < 3 ? (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-3 left-5 z-10 grid h-6 w-6 place-items-center rounded-full border border-rule bg-paper text-sm text-accent sm:-right-3 sm:bottom-auto sm:left-auto sm:top-7 sm:-rotate-90"
                >
                  ↓
                </span>
              ) : null}
            </li>
          ))}
        </ol>

        <p className="mt-8 max-w-[44rem] leading-7 text-secondary">
          The interview tested whether I simply needed a small challenge. I said
          I’d probably give one a shot, and I wouldn’t mind if I abandoned it or
          ended up writing instead. That ruled out the idea that I needed a
          serious project or another backlog. I needed something that would get
          me moving.
        </p>
      </section>

      <section aria-labelledby="old-habit">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">
          Before all this
        </p>
        <h2
          id="old-habit"
          className="mt-4 text-3xl font-bold leading-tight tracking-[-0.03em] text-balance sm:text-4xl"
        >
          The habit I used to have
        </h2>
        <div className="mt-7 space-y-6 text-lg leading-8 text-secondary">
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
        </div>

        <figure className="mt-10 border-y border-rule bg-surface px-5 py-7 sm:px-8">
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
          <figcaption className="mt-6 text-center text-sm leading-6 text-muted">
            The writing came out of the work. It wasn’t a hurdle I had to clear
            before I could begin.
          </figcaption>
        </figure>
      </section>

      <section aria-labelledby="lost-habit">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">
          What changed
        </p>
        <h2
          id="lost-habit"
          className="mt-4 text-3xl font-bold leading-tight tracking-[-0.03em] text-balance sm:text-4xl"
        >
          How I lost that habit
        </h2>
        <div className="mt-7 space-y-6 text-lg leading-8 text-secondary">
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
        </div>
      </section>

      <section
        aria-labelledby="wedding-site"
        className="relative overflow-hidden border border-rule bg-[#ece6d8] px-6 py-9 sm:px-10 sm:py-12"
      >
        <div
          aria-hidden="true"
          className="absolute -bottom-16 -right-10 h-64 w-40 rounded-t-full border-[20px] border-surface/70"
        />
        <div className="relative grid gap-10 sm:grid-cols-[1.1fr_0.9fr] sm:items-end">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">
              Something we made together
            </p>
            <h2
              id="wedding-site"
              className="mt-4 text-3xl font-bold leading-tight tracking-[-0.03em] text-balance sm:text-4xl"
            >
              The wedding website
            </h2>
            <p className="mt-6 text-lg leading-8 text-secondary">
              The wedding website is the clearest recent example because you
              were there for it. We genuinely needed somewhere to communicate
              the wedding details. The work was within my abilities, but it gave
              me an excuse to practise visual design and spend too long on little
              details simply because I enjoyed them.
            </p>
            <p className="mt-5 leading-7 text-secondary">
              Showing sneak peeks to family and friends mattered too. The site
              stopped being files on my laptop and became something in the lives
              of people we care about. An equally polished fictional demo
              wouldn’t have held my interest nearly as much.
            </p>
          </div>

          <figure className="relative border border-rule bg-surface p-3 shadow-[6px_7px_0_0_#b8b0a2]">
            <div className="flex items-center gap-1.5 border-b border-rule pb-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[#a33a2b]/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#9a6700]/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#3f6b46]/70" />
              <span className="ml-2 font-mono text-[0.65rem] text-muted">
                gabbeyandmichael.wedding
              </span>
            </div>
            <div className="grid min-h-52 place-items-center px-4 py-8 text-center">
              <div>
                <span className="mx-auto block h-20 w-14 rounded-t-full border-2 border-accent/40" />
                <p className="mt-5 text-sm font-bold uppercase tracking-[0.12em] text-accent">
                  Something real that we could share
                </p>
              </div>
            </div>
          </figure>
        </div>
      </section>

      <section aria-labelledby="restful-building">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">
          What I get from it
        </p>
        <h2
          id="restful-building"
          className="mt-4 text-3xl font-bold leading-tight tracking-[-0.03em] text-balance sm:text-4xl"
        >
          Why some building feels restful
        </h2>
        <div className="mt-7 space-y-6 text-lg leading-8 text-secondary">
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
        </div>

        <figure className="mt-10 border-l-2 border-accent bg-surface px-6 py-7 sm:px-8">
          <blockquote className="text-2xl font-bold leading-[1.4] tracking-[-0.015em]">
            “It’s not really that appealing to me.”
          </blockquote>
          <figcaption className="mt-4 leading-7 text-secondary">
            That was my response when the interview suggested a perfectly
            sensible two-hour disk-usage tool. It was small, useful and
            publishable, but I didn’t care about it. The idea still needs to
            catch my curiosity; there isn’t a formula that can do that for me.
          </figcaption>
        </figure>
      </section>

      <section aria-labelledby="tools-site">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">
          Somewhere to put things
        </p>
        <h2
          id="tools-site"
          className="mt-4 text-3xl font-bold leading-tight tracking-[-0.03em] text-balance sm:text-4xl"
        >
          Why I made this site
        </h2>
        <div className="mt-7 space-y-6 text-lg leading-8 text-secondary">
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
        </div>

        <figure className="mt-12 overflow-hidden border border-rule bg-surface px-5 pb-7 pt-10 sm:px-9">
          <div className="flex min-h-48 items-end justify-center gap-3 sm:gap-6">
            <div className="grid h-28 w-24 place-items-center border border-accent bg-[#e8f2f5] px-3 text-center font-mono text-xs font-bold uppercase tracking-[0.08em] text-accent sm:h-36 sm:w-32">
              One useful thing
            </div>
            <div className="grid h-40 w-16 -rotate-2 place-items-center border border-rule bg-[#ece6d8] px-2 text-center font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-secondary sm:h-48 sm:w-24 sm:text-xs">
              What I learnt
            </div>
            <div className="grid h-20 w-24 rotate-1 place-items-center border border-dashed border-rule bg-paper px-3 text-center font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-muted sm:h-28 sm:w-32 sm:text-xs">
              Room for another idea
            </div>
          </div>
          <div className="h-3 border-x border-b border-rule bg-[#b8b0a2]" />
          <figcaption className="mt-5 text-center text-sm leading-6 text-muted">
            I don’t need to fill the shelf for it to be useful.
          </figcaption>
        </figure>
      </section>

      <section
        aria-labelledby="for-gabbey"
        className="border-y border-rule py-10 sm:py-14"
      >
        <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">
          For Gabbey
        </p>
        <h2
          id="for-gabbey"
          className="mt-4 text-3xl font-bold leading-tight tracking-[-0.03em] text-balance sm:text-4xl"
        >
          What I want you to understand
        </h2>
        <div className="mt-7 space-y-6 text-xl leading-9 text-secondary">
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
        </div>
      </section>
    </div>
  );
}
