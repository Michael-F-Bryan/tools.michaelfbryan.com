import { Figure } from "@/components/figure";
import { Label } from "@/components/label";
import { Prose } from "@/components/prose";
import { Section, SectionTitle } from "@/components/section";
import { Step, Steps } from "@/components/steps";

const components = [
  ["Container", "Centres the page and adds the side gutters."],
  ["PageTitle", "Renders the large heading and keeps each word together."],
  ["Label", "Small monospace text for entry types and section kickers."],
  ["Section", "Pairs a kicker and heading with the usual vertical spacing."],
  ["SectionTitle", "Provides the same heading. The surrounding layout is up to the page."],
  ["Prose", "Caps the line length and offers base, large and extra-large text."],
  ["Steps / Step", "Turns an ordered list into numbered columns or rows."],
  ["Figure", "Wraps an illustration and, when needed, its caption."],
] as const;

export default function ComponentKitchenSink() {
  return (
    <div className="space-y-24 sm:space-y-32">
      <section
        aria-labelledby="why-this-page-exists"
        className="border-y border-rule bg-surface px-6 py-10 sm:px-10 sm:py-14"
      >
        <Label>Why this exists</Label>
        <SectionTitle id="why-this-page-exists" className="mt-4">
          Opening seven files is a lousy way to check a design
        </SectionTitle>
        <Prose size="xl" className="mt-7">
          <p>
            Fable pulled the repeated layout from the first explainers into a
            handful of shared components. I wanted one page where I could see
            them together, try them at different widths, and decide whether
            they still belong in the shared layer.
          </p>
          <p>
            This page is that test. The <code>Container</code>,{" "}
            <code>Label</code>, <code>PageTitle</code> and <code>Prose</code> above
            are already part of it.
          </p>
        </Prose>
      </section>

      <Section
        id="component-inventory"
        kicker="What Fable made"
        title="The shared parts"
      >
        <Prose>
          <p>
            Fable found eight things worth naming. Everything else stayed in
            the explainer that needed it, including one-off diagrams and
            page-specific layouts.
          </p>
        </Prose>

        <dl className="mt-10 border-t border-rule">
          {components.map(([name, purpose]) => (
            <div
              key={name}
              className="grid gap-2 border-b border-rule py-5 sm:grid-cols-[12rem_1fr] sm:gap-8"
            >
              <dt className="font-mono text-sm font-bold text-accent">{name}</dt>
              <dd className="leading-7 text-secondary">{purpose}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        id="prose-scale"
        kicker="Prose sizes"
        title="How the three prose sizes differ"
      >
        <Prose>
          <p>
            The size changes, but the typeface, colour and maximum line length
            don’t. That keeps an opening paragraph and a quiet note recognisably
            part of the same page.
          </p>
        </Prose>

        <div className="mt-10 space-y-10">
          <div>
            <Label tone="muted">XL · opening or closing</Label>
            <Prose size="xl" className="mt-3">
              <p>
                Use this when a paragraph needs to carry more weight than the
                body copy around it.
              </p>
            </Prose>
          </div>

          <div>
            <Label tone="muted">LG · normal reading</Label>
            <Prose className="mt-3">
              <p>
                Most of an explainer should look like this. It’s large enough to
                read comfortably without every paragraph announcing itself.
              </p>
            </Prose>
          </div>

          <div>
            <Label tone="muted">Base · supporting detail</Label>
            <Prose size="base" className="mt-3">
              <p>
                This suits a caveat or follow-up detail that matters but isn’t
                the main point.
              </p>
            </Prose>
          </div>
        </div>
      </Section>

      <Section
        id="ordered-sequence"
        kicker="Steps"
        title="Don’t make a component after seeing something once"
      >
        <Prose>
          <p>
            This is an actual sequence, so numbering helps. Swapping the middle
            steps would change the advice rather than merely rearranging four
            equal ideas.
          </p>
        </Prose>

        <Steps className="mt-10">
          <Step title="Build the page">Solve the explainer in front of you.</Step>
          <Step title="Spot the repeat">
            Wait until the same layout job appears again.
          </Step>
          <Step title="Pull it out">
            Name the job rather than copying a pile of CSS.
          </Step>
          <Step title="Try to break it">
            Use it somewhere awkward, such as this page.
          </Step>
        </Steps>
      </Section>

      <Section
        id="figures"
        kicker="Figures"
        title="What Figure does and what it leaves alone"
      >
        <Prose>
          <p>
            <code>Figure</code> provides a real <code>figure</code> element and a
            consistent caption. It doesn’t choose the border, background,
            padding or artwork. Those decisions belong to the explainer.
          </p>
        </Prose>

        <Figure
          className="mt-10 border border-rule bg-surface px-5 py-8 sm:px-9"
          caption="The boxes show three pages at different stages. Only the middle one produces shared code."
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <div className="border border-rule bg-paper p-5">
              <Label tone="muted">First page</Label>
              <strong className="mt-3 block text-lg">Draw what it needs</strong>
            </div>
            <span aria-hidden="true" className="hidden text-2xl text-accent sm:block">
              →
            </span>
            <div className="border border-accent bg-sand p-5">
              <Label>After repetition</Label>
              <strong className="mt-3 block text-lg">Share the wrapper</strong>
            </div>
            <span aria-hidden="true" className="hidden text-2xl text-accent sm:block">
              →
            </span>
            <div className="border border-rule bg-paper p-5">
              <Label tone="muted">Next page</Label>
              <strong className="mt-3 block text-lg">Draw something else</strong>
            </div>
          </div>
        </Figure>
      </Section>

      <section
        aria-labelledby="custom-composition"
        className="relative overflow-hidden border-l-2 border-accent bg-sand px-6 py-10 sm:px-10 sm:py-14"
      >
        <div
          aria-hidden="true"
          className="absolute -bottom-16 -right-10 h-52 w-52 rounded-full border-[28px] border-surface/70"
        />
        <div className="relative max-w-measure">
          <Label>When Section is wrong</Label>
          <SectionTitle id="custom-composition" className="mt-4">
            Use the pieces when Section doesn’t fit
          </SectionTitle>
          <Prose className="mt-7">
            <p>
              This coloured block is built directly from <code>Label</code>,{" "}
              <code>SectionTitle</code> and <code>Prose</code>. The heading
              structure stays intact, even though this section doesn’t match
              the others.
            </p>
          </Prose>
        </div>
      </section>
    </div>
  );
}
