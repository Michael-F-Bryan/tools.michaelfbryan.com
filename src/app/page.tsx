import Link from "next/link";

import { Container } from "@/components/container";
import { Label } from "@/components/label";
import { PageTitle } from "@/components/page-title";
import { entries } from "@/entries";

export default function Home() {
  return (
    <main>
      <Container>
        <section className="py-14 sm:py-20">
          <PageTitle className="max-w-2xl">Tools and explainers</PageTitle>
        </section>

        <section aria-label="Catalogue" className="pb-24">
          <ol className="border-t border-rule">
            {entries.map((entry) => (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  className="group grid gap-4 border-b border-rule py-7 outline-none transition-colors hover:bg-surface focus-visible:bg-surface sm:grid-cols-[1fr_auto] sm:px-4"
                >
                  <span>
                    <span className="block text-xl font-bold tracking-title group-hover:text-accent">
                      {entry.title}
                    </span>
                    <span className="mt-2 block max-w-measure leading-7 text-secondary">
                      {entry.description}
                    </span>
                  </span>
                  <Label tone="muted" className="sm:text-right">
                    {entry.kind}
                  </Label>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </Container>
    </main>
  );
}
