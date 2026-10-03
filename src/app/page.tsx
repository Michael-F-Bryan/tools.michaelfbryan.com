import Link from "next/link";

import { Container } from "@/components/container";
import { PageTitle } from "@/components/page-title";
import { entries } from "@/entries";

const dateFormatter = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "UTC" });

export default function Home() {
  return (
    <main>
      <Container>
        <section className="pb-8 pt-10 sm:pb-10 sm:pt-14">
          <PageTitle className="max-w-2xl">Tools &amp; experiments</PageTitle>
        </section>

        <section aria-label="Catalogue" className="max-w-4xl pb-24">
          <ol className="border-t border-rule">
            {entries.map(({ href, title, description, Preview, history }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="group grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-4 border-b border-rule py-6 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-6 sm:px-4 sm:py-8"
                >
                  <span aria-hidden="true" className="flex h-16 items-center justify-center text-3xl font-bold text-muted sm:h-24">
                    {Preview ? <Preview /> : title.slice(0, 1)}
                  </span>
                  <span>
                    <span className="block text-xl font-bold tracking-title group-hover:text-accent">
                      {title}
                    </span>
                    <span className="mt-2 block max-w-measure leading-7 text-secondary">
                      {description}
                    </span>
                    <span className="mt-2 block text-sm text-muted">
                      {history.status === "available" ? `Last updated ${dateFormatter.format(new Date(history.updatedAt))}` : "Last updated date unavailable"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </Container>
    </main>
  );
}
