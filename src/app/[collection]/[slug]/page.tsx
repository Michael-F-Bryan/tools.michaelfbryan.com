import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { Label } from "@/components/label";
import { PageTitle } from "@/components/page-title";
import { Prose } from "@/components/prose";
import { entries, getEntry } from "@/entries";

type EntryPageProps = Readonly<{
  params: Promise<{
    collection: string;
    slug: string;
  }>;
}>;

export const dynamicParams = false;

export function generateStaticParams() {
  return entries.map(({ collection, slug }) => ({ collection, slug }));
}

async function resolveEntry(params: EntryPageProps["params"]) {
  const { collection, slug } = await params;
  return getEntry(collection, slug) ?? notFound();
}

export async function generateMetadata({
  params,
}: EntryPageProps): Promise<Metadata> {
  const entry = await resolveEntry(params);

  return {
    title: entry.title,
    description: entry.description,
  };
}

export default async function EntryPage({ params }: EntryPageProps) {
  const entry = await resolveEntry(params);
  const Content = await entry.load();
  const isWorkspace = entry.layout === "workspace";

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
          <header className="max-w-article lg:col-start-1 lg:row-start-1">
            <Label tone="muted">{entry.kind}</Label>
            <PageTitle className={isWorkspace ? "mt-3 text-3xl sm:text-5xl" : "mt-5"}>{entry.title}</PageTitle>
            <Prose size={isWorkspace ? "base" : "xl"} className={isWorkspace ? "mt-3" : "mt-7"}>
              <p>{entry.description}</p>
            </Prose>
          </header>

          {!isWorkspace && entry.sections?.length ? (
            <nav
              aria-label="On this page"
              className="border-y border-rule py-5 lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-y-0 lg:border-l lg:py-1 lg:pl-6"
            >
              <Label tone="muted">On this page</Label>
              <ol className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
                {entry.sections.map((section) => (
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
            className={isWorkspace ? "lg:col-start-1 lg:row-start-2" : "max-w-article lg:col-start-1 lg:row-start-2"}
          >
            <Content />
          </article>
        </div>
      </Container>
    </main>
  );
}
