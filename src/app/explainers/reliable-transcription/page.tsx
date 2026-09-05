import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Reliable AI-assisted transcription",
  description:
    "An upcoming visual explainer about the engineering principles behind trustworthy AI-assisted transcription.",
};

export default function ReliableTranscriptionExplainer() {
  return (
    <main className="mx-auto max-w-[70rem] px-5 py-14 sm:px-8 sm:py-20">
      <article className="max-w-[52rem]">
        <Link
          href="/"
          className="font-mono text-sm text-accent underline decoration-rule underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          ← Catalogue
        </Link>

        <div className="mt-12 flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-[0.12em] text-muted">
          <span>Explainer</span>
          <span aria-hidden="true">·</span>
          <span className="border border-rule bg-surface px-2 py-1 text-secondary">
            In development
          </span>
        </div>

        <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-balance sm:text-6xl">
          Reliable <span className="whitespace-nowrap">AI-assisted</span>{" "}
          transcription
        </h1>

        <p className="mt-8 text-xl leading-9 text-secondary">
          A visual explanation of the engineering principles behind a
          trustworthy transcription pipeline, using a synthetic interview as a
          concrete case study.
        </p>

        <div className="mt-14 border-l-2 border-accent bg-surface px-5 py-5 sm:px-7">
          <p className="font-bold">Reader outcome</p>
          <p className="mt-2 leading-7 text-secondary">
            Understand how evidence, uncertainty, human judgement, and durable
            intermediate artefacts fit together—and apply those principles to
            another transcription system.
          </p>
        </div>
      </article>
    </main>
  );
}
