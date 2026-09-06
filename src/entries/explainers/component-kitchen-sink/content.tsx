import { Figure } from "@/components/figure";
import { Label } from "@/components/label";
import { Prose } from "@/components/prose";
import { Section, SectionTitle } from "@/components/section";
import { Step, Steps } from "@/components/steps";

const components = [
  ["Container", "The centred page frame and responsive gutters."],
  ["PageTitle", "The display heading above this specimen."],
  ["Label", "Kickers and quiet entry metadata."],
  ["Section", "A repeatable heading and body rhythm."],
  ["SectionTitle", "A heading for layouts that need their own composition."],
  ["Prose", "Readable text at base, large and standfirst sizes."],
  ["Steps / Step", "A true ordered sequence with automatic numbering."],
  ["Figure", "An illustration boundary with a consistent caption."],
] as const;

export default function ComponentKitchenSink() {
  return (
    <div className="space-y-24 sm:space-y-32">
      <section
        aria-labelledby="how-to-read-this-page"
        className="border-y border-rule bg-surface px-6 py-10 sm:px-10 sm:py-14"
      >
        <Label>Live specimen</Label>
        <SectionTitle id="how-to-read-this-page" className="mt-4">
          The page is the demonstration
        </SectionTitle>
        <Prose size="xl" className="mt-7">
          <p>
            The shared <code>Container</code>, <code>Label</code>,{" "}
            <code>PageTitle</code> and <code>Prose</code> components already form
            the frame above. The sections below exercise the remaining pieces
            with real content rather than showing disconnected swatches.
          </p>
        </Prose>
      </section>

      <Section
        id="component-inventory"
        kicker="The parts"
        title="One small vocabulary for explainers"
      >
        <Prose>
          <p>
            These components name repeated reading structures. Subject-specific
            diagrams and layouts remain local to each explainer until there is
            evidence that they deserve a shared abstraction.
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
        kicker="Reading hierarchy"
        title="Prose changes emphasis, not personality"
      >
        <div className="space-y-10">
          <div>
            <Label tone="muted">XL · standfirst</Label>
            <Prose size="xl" className="mt-3">
              <p>
                Use the largest prose sparingly: to establish the argument or
                land its conclusion.
              </p>
            </Prose>
          </div>

          <div>
            <Label tone="muted">LG · running text</Label>
            <Prose className="mt-3">
              <p>
                This is the default reading voice. It gives an explanation
                enough room to breathe without mistaking body copy for display
                type.
              </p>
            </Prose>
          </div>

          <div>
            <Label tone="muted">Base · supporting note</Label>
            <Prose size="base" className="mt-3">
              <p>
                Quieter context can follow the main point without competing
                with it.
              </p>
            </Prose>
          </div>
        </div>
      </Section>

      <Section
        id="ordered-sequence"
        kicker="Ordered work"
        title="Steps are for sequences that really have an order"
      >
        <Prose>
          <p>
            A process earns numbers when changing the order would change the
            result. The counter and directional markers are presentation; the
            list remains an ordinary ordered list.
          </p>
        </Prose>

        <Steps className="mt-10">
          <Step title="Notice">Find a repeated structure in a real explainer.</Step>
          <Step title="Name">Give the pattern one clear responsibility.</Step>
          <Step title="Reuse">Apply it where the same reading job appears.</Step>
          <Step title="Refine">Change the shared rule once evidence accumulates.</Step>
        </Steps>
      </Section>

      <Section
        id="figures"
        kicker="Visual evidence"
        title="A figure frames an explanation"
      >
        <Prose>
          <p>
            The figure owns its illustration and surface. The shared component
            supplies the semantic boundary and caption, without forcing every
            subject into one diagram style.
          </p>
        </Prose>

        <Figure
          className="mt-10 border border-rule bg-surface px-5 py-8 sm:px-9"
          caption="The caption explains why the picture matters instead of restating its labels."
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <div className="border border-rule bg-paper p-5">
              <Label tone="muted">Source</Label>
              <strong className="mt-3 block text-lg">Repeated decision</strong>
            </div>
            <span aria-hidden="true" className="hidden text-2xl text-accent sm:block">
              →
            </span>
            <div className="border border-accent bg-sand p-5">
              <Label>Shared structure</Label>
              <strong className="mt-3 block text-lg">Named component</strong>
            </div>
            <span aria-hidden="true" className="hidden text-2xl text-accent sm:block">
              →
            </span>
            <div className="border border-rule bg-paper p-5">
              <Label tone="muted">Outcome</Label>
              <strong className="mt-3 block text-lg">Consistent reading</strong>
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
          <Label>Composition escape hatch</Label>
          <SectionTitle id="custom-composition" className="mt-4">
            Shared pieces, subject-shaped layout
          </SectionTitle>
          <Prose className="mt-7">
            <p>
              <code>Section</code> is a useful default, not a cage. When an idea
              needs a different surface or composition, combine{" "}
              <code>Label</code>, <code>SectionTitle</code> and <code>Prose</code>{" "}
              directly while keeping the same hierarchy and accessible heading
              relationship.
            </p>
          </Prose>
        </div>
      </section>
    </div>
  );
}
