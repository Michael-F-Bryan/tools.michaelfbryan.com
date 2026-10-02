import type { EntryDefinition } from "@/lib/entry";

export const definition = {
  title: "Explainer component kitchen sink",
  description:
    "Every shared explainer component on one page, so I can compare them without hunting through old entries.",
  sections: [
    { id: "why-this-page-exists", label: "Why this exists" },
    { id: "component-inventory", label: "The shared parts" },
    { id: "prose-scale", label: "Prose sizes" },
    { id: "ordered-sequence", label: "Steps" },
    { id: "figures", label: "Figures" },
    { id: "custom-composition", label: "When Section is wrong" },
  ],
} satisfies EntryDefinition;
