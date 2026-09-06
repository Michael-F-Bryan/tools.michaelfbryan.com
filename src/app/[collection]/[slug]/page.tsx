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

  return (
    <main className="py-14 sm:py-20">
      <Container>
        <article className="max-w-article">
          <Label tone="muted">{entry.kind}</Label>

          <PageTitle className="mt-6">{entry.title}</PageTitle>

          <Prose size="xl" className="mt-8">
            <p>{entry.description}</p>
          </Prose>

          <div className="mt-12 sm:mt-16">
            <Content />
          </div>
        </article>
      </Container>
    </main>
  );
}
