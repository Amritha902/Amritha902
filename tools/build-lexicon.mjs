/*
 * PromptComplete — lexicon builder (REAL data source, reproducible)
 *
 * Downloads the frequency-ranked English word list derived from Google's
 * Web Trillion Word Corpus (the n-gram counts behind Google Books/Web data),
 * as published by the `first20hours/google-10000-english` project:
 *
 *   source  https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt
 *   corpus  Google Web Trillion Word Corpus (Brants & Franz, LDC2006T13)
 *   order   descending frequency — array index IS the frequency rank
 *
 * A small curated overlay of prompt-box vocabulary the web corpus ranks
 * poorly or lacks entirely (informal chat words, AI/assistant domain terms)
 * is spliced in at rank 2000 so they are usable without outranking everyday
 * English. Output is committed as src/lexicon.js so the extension works
 * offline; re-run this script to regenerate from source.
 *
 *   node tools/build-lexicon.mjs [path-to-downloaded-list]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE_URL =
  "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt";

const OVERLAY = (
  "hello okay yes maybe kinda gonna wanna idk pls btw fyi asap thanks sorry " +
  "summarize summarise rephrase rewrite refactor debug brainstorm proofread " +
  "prompt prompts chatbot assistant claude api autocomplete suggestion " +
  "dataset datasets resume internship standup teammate deadline quarterly " +
  "javascript python pandas numpy sql frontend backend workflow roadmap " +
  "bullet bullets concise actionable deliverable takeaways recap tldr"
).split(/\s+/);

const OVERLAY_RANK = 2000; // splice point: usable, but below everyday English

async function loadCorpus(localPath) {
  if (localPath && existsSync(localPath)) return readFileSync(localPath, "utf8");
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`corpus fetch failed: HTTP ${res.status}`);
  return res.text();
}

const here = dirname(fileURLToPath(import.meta.url));
const raw = await loadCorpus(process.argv[2]);
const corpus = raw
  .split(/\r?\n/)
  .map((w) => w.trim().toLowerCase())
  .filter((w) => /^[a-z]+$/.test(w));

const seen = new Set(corpus);
const missing = OVERLAY.filter((w) => !seen.has(w));
const words = [...corpus.slice(0, OVERLAY_RANK), ...missing, ...corpus.slice(OVERLAY_RANK)];

const header = `/*
 * GENERATED FILE — do not edit by hand. Rebuild: node tools/build-lexicon.mjs
 *
 * Frequency-ranked English lexicon (index = rank, most frequent first).
 * Source: google-10000-english (no-swears variant), derived from the Google
 * Web Trillion Word Corpus (Brants & Franz, LDC2006T13).
 *   ${SOURCE_URL}
 * Curated prompt-domain overlay (${missing.length} words) spliced at rank ${OVERLAY_RANK}.
 * Total: ${words.length} words. Consumed by src/repair.js (spell repair +
 * dictionary word-completion) and, through it, src/suggest.js.
 */
`;

writeFileSync(
  join(here, "..", "src", "lexicon.js"),
  header + "window.PromptWords = " + JSON.stringify(words) + ";\n"
);
console.log(`lexicon.js written: ${words.length} words (corpus ${corpus.length} + overlay ${missing.length})`);
