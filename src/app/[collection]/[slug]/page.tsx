import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fragment } from "react";

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

  return (
    <main className="mx-auto max-w-[70rem] px-5 py-14 sm:px-8 sm:py-20">
      <article className="max-w-[52rem]">
        <div className="mt-12 flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-[0.12em] text-muted">
          <span>{entry.kind}</span>
        </div>

        <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-balance sm:text-6xl">
          {entry.title.split(" ").map((word, index) => (
            <Fragment key={`${index}-${word}`}>
              {index > 0 ? " " : null}
              <span className="whitespace-nowrap">{word}</span>
            </Fragment>
          ))}
        </h1>

        <p className="mt-8 text-xl leading-9 text-secondary">
          {entry.description}
        </p>

        <Content />
      </article>
    </main>
  );
}
