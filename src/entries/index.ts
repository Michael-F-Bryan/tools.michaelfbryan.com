import type { ComponentType } from "react";

import type { EntryDefinition } from "@/lib/entry";

export type Entry = EntryDefinition & {
  href: string;
  load: () => Promise<ComponentType>;
  Preview?: ComponentType;
  slug: string;
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
    return { ...definition, href: `/${slug}`, load, Preview, slug };
  })
  .sort((left, right) => left.title.localeCompare(right.title));

export function getEntry(slug: string): Entry | undefined {
  return entries.find((entry) => entry.slug === slug);
}
