export type EntryCollection = "explainers" | "tools";

export type EntrySection = Readonly<{
  id: string;
  label: string;
}>;

export type EntryDefinition = Readonly<{
  title: string;
  description: string;
  sections?: readonly EntrySection[];
}>;
