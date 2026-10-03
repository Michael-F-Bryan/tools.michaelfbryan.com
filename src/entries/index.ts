import type { ComponentType } from "react";

import type { EntryDefinition } from "@/lib/entry";
import { loadEntryHistory, type EntryHistory } from "@/lib/entry-history";

export type Entry = EntryDefinition & {
  href: string;
  load: () => Promise<ComponentType>;
  Preview?: ComponentType;
  slug: string;
  history: EntryHistory;
};

const definitionModules = import.meta.glob("./*/definition.ts", {
  eager: true,
  import: "definition",
}) as Record<string, EntryDefinition>;

const contentModules = import.meta.glob("./*/content.tsx", {
  import: "default",
}) as Record<string, () => Promise<ComponentType>>;

// Previews are static Server Components, kept separate from interactive bodies.
const previewModules = import.meta.glob("./*/preview.tsx", {
  eager: true,
  import: "default",
}) as Record<string, ComponentType>;

const history = loadEntryHistory();

/** Reverse-chronological; entries without recorded history sort last. */
function lastUpdated(entry: Entry): number {
  return entry.history.status === "available" ? Date.parse(entry.history.updatedAt) : 0;
}

export const entries: readonly Entry[] = Object.entries(definitionModules)
  .map(([path, definition]) => {
    const match = /^\.\/([^/]+)\/definition\.ts$/.exec(path);
    if (!match) {
      throw new Error(`Unexpected entry definition path: ${path}`);
    }

    const slug = match[1];
    const contentPath = path.replace(/definition\.ts$/, "content.tsx");
    const load = contentModules[contentPath];
    if (!load) {
      throw new Error(`Missing entry content: ${contentPath}`);
    }

    const Preview = previewModules[path.replace(/definition\.ts$/, "preview.tsx")];
    const entryHistory: EntryHistory = history[slug] ?? {
      status: "unavailable",
      reason: `No generated history found for "${slug}".`,
    };
    return { ...definition, href: `/${slug}`, load, Preview, slug, history: entryHistory };
  })
  .sort((left, right) => lastUpdated(right) - lastUpdated(left) || left.title.localeCompare(right.title));

export function getEntry(slug: string): Entry | undefined {
  return entries.find((entry) => entry.slug === slug);
}
