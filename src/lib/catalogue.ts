export type CatalogueItem = {
  href: string;
  kind: "Explainer" | "Tool";
  status: "In development" | "Published";
  title: string;
  description: string;
};

export const catalogueItems = [
  {
    href: "/explainers/reliable-transcription",
    kind: "Explainer",
    status: "In development",
    title: "Reliable AI-assisted transcription",
    description:
      "Engineering principles for turning recordings into trustworthy transcripts without hiding uncertainty or losing the source evidence.",
  },
] as const satisfies readonly CatalogueItem[];
