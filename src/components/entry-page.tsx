import type { ReactNode } from "react";

import { Container } from "@/components/container";
import { Label } from "@/components/label";
import { PageTitle } from "@/components/page-title";
import { Prose } from "@/components/prose";
import type { EntryDefinition } from "@/lib/entry";

export function EntryPage({ definition, children }: Readonly<{
  definition: EntryDefinition;
  children: ReactNode;
}>) {
  const isWorkspace = definition.layout === "workspace";

  return (
    // A workspace's introduction is kept short so the interactive surface
    // starts within the first screen, on phones included.
    <main className={isWorkspace ? "py-8 sm:py-10" : "py-12 sm:py-16"}>
      <Container>
        <div
          className={
            isWorkspace
              ? "grid items-start gap-6"
              : "grid items-start gap-10 lg:grid-cols-[minmax(0,52rem)_14rem] lg:gap-16"
          }
        >
          {/* `min-w-0` overrides a grid item's default `min-width: auto`, which
              otherwise lets a long, unbroken title (wrapped word-by-word by
              `PageTitle`) hold its implicit grid track open to its unwrapped
              width and overflow a narrow viewport instead of wrapping. */}
          <header className="min-w-0 max-w-article lg:col-start-1 lg:row-start-1">
            <PageTitle className={isWorkspace ? "text-3xl sm:text-5xl" : ""}>{definition.title}</PageTitle>
            <Prose size={isWorkspace ? "base" : "xl"} className={isWorkspace ? "mt-3" : "mt-7"}>
              <p>{definition.description}</p>
            </Prose>
          </header>

          {!isWorkspace && definition.sections?.length ? (
            <nav
              aria-label="On this page"
              className="border-y border-rule py-5 lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-y-0 lg:border-l lg:py-1 lg:pl-6"
            >
              <Label tone="muted">On this page</Label>
              <ol className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
                {definition.sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="text-sm leading-5 text-secondary underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          <article
            className={isWorkspace ? "min-w-0 lg:col-start-1 lg:row-start-2" : "max-w-article lg:col-start-1 lg:row-start-2"}
          >
            {children}
          </article>
        </div>
      </Container>
    </main>
  );
}
