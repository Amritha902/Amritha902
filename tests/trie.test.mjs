/*
 * Unit tests for the weighted top-K trie (src/trie.js) — rank ordering,
 * minExtra/filter rules, the DFS fallback past a filtered-out top-8 cache,
 * and a spot-check against the real frequency-ranked lexicon.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
globalThis.window = {};
// Real-corpus lexicon first — the final test builds a trie from its ranks.
eval(readFileSync(join(here, "..", "src", "lexicon.js"), "utf8"));
eval(readFileSync(join(here, "..", "src", "trie.js"), "utf8"));
const T = window.PromptTrie;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("best returns the highest-ranked completion (array order = rank)", () => {
  // "send" outranks "sender" and "sending" purely by array position.
  const t = T.create(["send", "sender", "sending", "sense"]);
  assert.equal(t.best("sen"), "send");
  assert.equal(t.best("send"), "sender");
});

test("minExtra is respected", () => {
  const t = T.create(["cat", "cats", "category"]);
  // Default minExtra 1: the prefix itself ("cat") is excluded, "cats" wins.
  assert.equal(t.best("cat"), "cats");
  // minExtra 3: "cats" (only +1) no longer qualifies, "category" does.
  assert.equal(t.best("cat", { minExtra: 3 }), "category");
  // minExtra bigger than any extension: nothing qualifies.
  assert.equal(t.best("cat", { minExtra: 9 }), null);
});

test("filter picks a lower-ranked word that fits", () => {
  const t = T.create(["send", "sent", "sender"]);
  assert.equal(t.best("sen", { filter: (w) => w.endsWith("er") }), "sender");
});

test("filter miss on a full top-8 falls back to DFS beyond the cache", () => {
  // 8 words share prefix "pre" and fill its top cache; the 9th ("prezzz")
  // is the ONLY one passing the filter, so it can only be found by DFS.
  const words = [
    "prea", "preb", "prec", "pred", "pree", "pref", "preg", "preh",
    "prezzz",
  ];
  const t = T.create(words);
  const zz = (w) => w.endsWith("zzz");
  assert.equal(t.best("pre", { filter: zz }), "prezzz");
  // And when even the DFS finds nothing passing, best stays null.
  assert.equal(t.best("pre", { filter: (w) => w.endsWith("qqq") }), null);
});

test("DFS fallback still returns the best-ranked passing word", () => {
  // Two words survive the filter beyond the cache — rank must decide.
  const words = [
    "prea", "preb", "prec", "pred", "pree", "pref", "preg", "preh",
    "prezzz", "preazzz",
  ];
  const t = T.create(words);
  assert.equal(t.best("pre", { filter: (w) => w.endsWith("zzz") }), "prezzz");
});

test("dead prefix returns null (and [] from topK)", () => {
  const t = T.create(["alpha", "beta"]);
  assert.equal(t.best("gam"), null);
  assert.equal(t.best("alphax"), null);
  assert.deepEqual(t.topK("gam", 3), []);
});

test("topK returns rank order and honours the count", () => {
  const t = T.create(["prea", "preb", "prec", "pred"]);
  assert.deepEqual(t.topK("pre", 3), ["prea", "preb", "prec"]);
  assert.deepEqual(t.topK("pre", 10), ["prea", "preb", "prec", "pred"]);
  // Same length rule as best (minExtra 1): the exact word is skipped, and
  // a filter applies before the count.
  assert.deepEqual(t.topK("prea", 5), []);
  assert.deepEqual(
    t.topK("pre", 5, (w) => w !== "preb"),
    ["prea", "prec", "pred"]
  );
});

test("single-char prefix works", () => {
  const t = T.create(["banana", "apple", "avocado", "cherry"]);
  assert.equal(t.best("a"), "apple");
  assert.deepEqual(t.topK("a", 5), ["apple", "avocado"]);
});

test("real lexicon: best('creat') is 'create' (outranks 'created')", () => {
  const words = window.PromptWords;
  assert.ok(words && words.length > 5000, "lexicon should be loaded");
  const t = T.create(words);
  assert.equal(t.best("creat"), "create");
  // Rank order holds deeper in the top list too.
  assert.deepEqual(t.topK("creat", 3), ["create", "created", "creative"]);
  // And the most frequent word overall completes a one-letter prefix.
  assert.equal(t.best("t"), "the");
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
console.log(failed === 0 ? `\nAll ${tests.length} trie tests passed.` : `\n${failed} trie test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
