import { pick } from "./random";

/** Marks the start and end of a fed sentence inside the word chain. */
const START = "\u0001";
const END = "\u0000";

export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, "");
}

/**
 * The words the field currently recognises; anything else is treated as a
 * misremembering rather than a real word when text is fed back into the
 * chain. Scoped to one field instance, not shared module state, so two
 * mounts (or a mount and a test) never see each other's planted words.
 */
export class Vocabulary {
  private readonly words = new Set<string>();

  constructor(seedTexts: readonly string[] = []) {
    for (const text of seedTexts) this.learn(text);
  }

  learn(text: string): void {
    for (const word of text.split(/\s+/)) {
      const normalized = normalizeWord(word);
      if (normalized) this.words.add(normalized);
    }
  }

  has(word: string): boolean {
    return this.words.has(normalizeWord(word));
  }
}

type WeightedBucket = Map<string, number>;

function addWeighted(table: Map<string, WeightedBucket>, key: string, word: string, weight: number): void {
  let bucket = table.get(key);
  if (!bucket) {
    bucket = new Map();
    table.set(key, bucket);
  }
  bucket.set(word, (bucket.get(word) ?? 0) + weight);
}

function drawWeighted(bucket: WeightedBucket): string | null {
  let total = 0;
  for (const weight of bucket.values()) total += weight;
  let remaining = Math.random() * total;
  for (const [word, weight] of bucket) {
    remaining -= weight;
    if (remaining <= 0) return word;
  }
  return null;
}

function finishSentence(words: readonly string[]): string {
  let sentence = words.join(" ").replace(/\s+/g, " ").trim();
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  if (!/[.!?]$/.test(sentence)) sentence = sentence.replace(/[,;:]$/, "") + ".";
  return sentence;
}

/**
 * An order-2 word chain, rebuilt from whatever text is currently legible on
 * the field. Generating a sentence sometimes drops back to a one-word
 * context on purpose, so sentences fed from different origins can
 * recombine instead of only ever reproducing what was fed verbatim.
 */
export class Markov {
  private readonly pairs = new Map<string, WeightedBucket>();
  private readonly singles = new Map<string, WeightedBucket>();
  private readonly starts: Array<[first: string, second: string, weight: number]> = [];

  feed(text: string, weight: number): void {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return;
    this.starts.push([words[0], words[1] ?? END, weight]);
    const sequence = [START, ...words, END];
    for (let i = 0; i < sequence.length - 1; i++) {
      addWeighted(this.singles, sequence[i], sequence[i + 1], weight);
      if (i < sequence.length - 2) addWeighted(this.pairs, `${sequence[i]} ${sequence[i + 1]}`, sequence[i + 2], weight);
    }
  }

  /** `fallback` is read only if six attempts fail to produce a sentence (or nothing has been fed yet). */
  generate(fallback: readonly string[]): string {
    if (!this.starts.length) return fallback.length ? pick(fallback) : "";
    for (let attempt = 0; attempt < 6; attempt++) {
      let total = 0;
      for (const start of this.starts) total += start[2];
      let remaining = Math.random() * total;
      let start = this.starts[0];
      for (const candidate of this.starts) {
        remaining -= candidate[2];
        if (remaining <= 0) {
          start = candidate;
          break;
        }
      }
      const out = [start[0]];
      if (start[1] !== END) {
        out.push(start[1]);
      } else {
        if (out[0].length > 2) return finishSentence(out);
        continue;
      }
      for (let steps = 0; out.length < 15 && steps < 40; steps++) {
        const previousPair = out[out.length - 2], previousWord = out[out.length - 1];
        let next: string | null = null;
        const pairBucket = this.pairs.get(`${previousPair} ${previousWord}`);
        // Sometimes forget the longer context, so sentences recombine.
        if (pairBucket && Math.random() > 0.28) next = drawWeighted(pairBucket);
        if (next === null) {
          const singleBucket = this.singles.get(previousWord);
          next = singleBucket ? drawWeighted(singleBucket) : END;
        }
        if (next === null || next === END) break;
        if (next === previousWord) continue; // a stammer, not a sentence
        out.push(next);
      }
      if (out.length >= 3) return finishSentence(out);
    }
    return fallback.length ? pick(fallback) : "";
  }
}
