export type EntryCollection = "explainers" | "tools";

export type EntrySection = Readonly<{
  id: string;
  label: string;
}>;

export type EntryDefinition = Readonly<{
  title: string;
  description: string;
  sections?: readonly EntrySection[];
  /**
   * `"article"` (default) caps the body at the article measure and reserves
   * a side column for in-page navigation. `"workspace"` lets the body use
   * the full page width instead, for tools whose layout needs the room
   * (e.g. side-by-side scene and inspector panels). The header text keeps
   * the article measure either way.
   */
  layout?: "article" | "workspace";
}>;
