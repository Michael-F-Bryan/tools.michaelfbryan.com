/** Where an entry's source and its commits live, for the "Source" link and development-history commit links. */
export const GITHUB_REPO_URL = "https://github.com/Michael-F-Bryan/tools.michaelfbryan.com";

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
