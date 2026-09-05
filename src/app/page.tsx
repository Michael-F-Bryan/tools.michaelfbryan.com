import Link from "next/link";

import { catalogueItems } from "@/lib/catalogue";

export default function Home() {
  return (
    <main className="mx-auto max-w-[70rem] px-5 sm:px-8">
      <section className="max-w-3xl py-16 sm:py-24">
        <p className="mb-5 font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">
          A public workbench
        </p>
        <h1 className="max-w-2xl text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-balance sm:text-6xl">
          Tools and explainers
        </h1>
        <p className="mt-7 max-w-[42rem] text-lg leading-8 text-secondary sm:text-xl">
          Small things built for real reasons, alongside visual explanations of
          the engineering judgement that shaped them.
        </p>
      </section>

      <section aria-labelledby="catalogue-heading" className="pb-24">
        <div className="mb-5 flex items-end justify-between gap-6">
          <h2
            id="catalogue-heading"
            className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-muted"
          >
            Catalogue
          </h2>
          <span className="font-mono text-xs text-muted">
            {catalogueItems.length.toString().padStart(2, "0")} item
          </span>
        </div>

        <ol className="border-t border-rule">
          {catalogueItems.map((item, index) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group grid gap-4 border-b border-rule py-7 outline-none transition-colors hover:bg-surface focus-visible:bg-surface sm:grid-cols-[4rem_1fr_auto] sm:px-4"
              >
                <span className="font-mono text-sm text-muted">
                  {(index + 1).toString().padStart(3, "0")}
                </span>
                <span>
                  <span className="block text-xl font-bold tracking-[-0.015em] group-hover:text-accent">
                    {item.title}
                  </span>
                  <span className="mt-2 block max-w-[45rem] leading-7 text-secondary">
                    {item.description}
                  </span>
                </span>
                <span className="flex items-start gap-3 font-mono text-xs uppercase tracking-[0.1em] text-muted sm:justify-end">
                  <span>{item.kind}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.status}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
