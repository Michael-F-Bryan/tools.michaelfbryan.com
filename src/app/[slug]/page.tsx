import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EntryPage } from "@/components/entry-page";
import { entries, getEntry } from "@/entries";

type PageProps = Readonly<{ params: Promise<{ slug: string }> }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return entries.map(({ slug }) => ({ slug }));
}

async function resolveEntry(params: PageProps["params"]) {
  const { slug } = await params;
  return getEntry(slug) ?? notFound();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const entry = await resolveEntry(params);
  return { title: entry.title, description: entry.description };
}

export default async function Page({ params }: PageProps) {
  const entry = await resolveEntry(params);
  const Content = await entry.load();
  return <EntryPage definition={entry}><Content /></EntryPage>;
}
