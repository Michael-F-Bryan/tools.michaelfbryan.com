import type { Metadata } from "next";

import { EntryPage } from "@/components/entry-page";
import Content from "./content";
import { definition } from "./definition";

export const metadata: Metadata = {
  title: definition.title,
  description: definition.description,
};

export default function ComponentReference() {
  return <EntryPage definition={definition}><Content /></EntryPage>;
}
