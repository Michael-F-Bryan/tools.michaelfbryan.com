import type { ComponentType } from "react";

import type { EntryCollection, EntryDefinition } from "@/lib/entry";

export type Entry = EntryDefinition & {
  collection: EntryCollection;
  href: string;
  kind: "Explainer" | "Tool";
  load: () => Promise<ComponentType>;
  slug: string;
};

const definitionModules = import.meta.glob(
  [
    "./explainers/*/definition.ts",
    "./tools/*/definition.ts",
  ],
  { eager: true, import: "definition" },
) as Record<string, EntryDefinition>;

const contentModules = import.meta.glob(
  [
    "./explainers/*/content.tsx",
    "./tools/*/content.tsx",
  ],
  { import: "default" },
) as Record<string, () => Promise<ComponentType>>;

const definitionPath =
  /^\.\/(explainers|tools)\/([^/]+)\/definition\.ts$/;

export const entries: readonly Entry[] = Object.entries(definitionModules)
  .map(([path, definition]) => {
    const match = definitionPath.exec(path);

    if (!match) {
      throw new Error(`Unexpected entry definition path: ${path}`);
    }

    const collection = match[1] as EntryCollection;
    const slug = match[2];
    const contentPath = path.replace(/definition\.ts$/, "content.tsx");
    const load = contentModules[contentPath];
    const kind: Entry["kind"] =
      collection === "explainers" ? "Explainer" : "Tool";

    if (!load) {
      throw new Error(`Missing entry content: ${contentPath}`);
    }

    return {
      ...definition,
      collection,
      href: `/${collection}/${slug}`,
      kind,
      load,
      slug,
    };
  })
  .sort((left, right) => left.title.localeCompare(right.title));

export function getEntry(collection: string, slug: string): Entry | undefined {
  return entries.find(
    (entry) => entry.collection === collection && entry.slug === slug,
  );
}
