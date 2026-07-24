/*
 * Unit tests for the BK-tree index (src/bktree.js) — OSA distance semantics
 * (transpositions cost 1, this repo's repair tier depends on it), the
 * early-abandon cutoff, duplicate handling, result ordering, and — most
 * important — that the triangle-inequality prune returns EXACTLY the same
 * hits as a brute-force scan of every word.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
globalThis.window = {};
// Real-corpus lexicon first — the lexicon test runs against shipping ranks.
eval(readFileSync(join(here, "..", "src", "lexicon.js"), "utf8"));
eval(readFileSync(join(here, "..", "src", "bktree.js"), "utf8"));
const BK = window.PromptBK;

const countNodes = (node) =>
  node ? 1 + Object.values(node.ch).reduce((s, c) => s + countNodes(c), 0) : 0;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("adjacent transposition costs 1 (computign -> computing)", () => {
  assert.equal(BK.distance("computign", "computing"), 1);
  assert.equal(BK.distance("teh", "the"), 1);
});

test("single insert, delete, and substitute each cost 1", () => {
  assert.equal(BK.distance("compting", "computing"), 1); // insert "u"
  assert.equal(BK.distance("computingg", "computing"), 1); // delete "g"
  assert.equal(BK.distance("computung", "computing"), 1); // substitute "u"->"i"
});

test("compound edits accumulate (TRUE Damerau-Levenshtein, not OSA)", () => {
  // transpose "ab"->"ba" plus substitute "e"->"f" = 2
  assert.equal(BK.distance("abcde", "bacdf"), 2);
  assert.equal(BK.distance("kitten", "sitting"), 3);
  // The unrestricted signature: transpose then insert INTO the swapped pair
  // is allowed, so this is 2. (OSA scores it 3 — and thereby breaks the
  // triangle inequality the BK prune depends on; see the metric test.)
  assert.equal(BK.distance("ca", "abc"), 2);
});

test("the metric satisfies the triangle inequality (prune soundness)", () => {
  // The exact triple that broke OSA: d(ca,ac)=1, d(ac,abc)=1 must bound
  // d(ca,abc) by 2. Under OSA it was 3 and the prune silently lost hits.
  assert.equal(BK.distance("ca", "ac"), 1);
  assert.equal(BK.distance("ac", "abc"), 1);
  assert.ok(BK.distance("ca", "abc") <= 2, "triangle inequality must hold");
  // The minimal query that OSA's unsoundness broke:
  const t = BK.create(["abc", "ac"]);
  const hits = t.query("ca", 1).map((r) => r.w);
  assert.ok(hits.includes("ac"), `query must find the d=1 word, got ${JSON.stringify(hits)}`);
});

test("early abandon returns max+1 once every row exceeds max", () => {
  assert.equal(BK.distance("aaaaaaa", "bbbbbbb", 2), 3);
  assert.equal(BK.distance("kitten", "sitting", 1), 2);
  // length gap alone triggers the same floor without any DP work
  assert.equal(BK.distance("hi", "hippopotamus", 3), 4);
  // ...but a distance within max is still returned exactly
  assert.equal(BK.distance("computign", "computing", 3), 1);
});

test("query prunes nothing: exact match with brute force on 200 words", () => {
  const sample = window.PromptWords.slice(1500, 1700);
  assert.equal(sample.length, 200);
  const tree = BK.create(sample);
  const brute = (word, maxDist) =>
    sample
      .map((w, rank) => ({ w, d: BK.distance(word, w), rank }))
      .filter((r) => r.d <= maxDist)
      .sort((x, y) => x.d - y.d || x.rank - y.rank);

  // Deterministic probes derived from the sample itself: the word, a
  // transposition, an insertion, and a deletion of it.
  const probes = [];
  for (const i of [0, 50, 100, 150]) {
    const w = sample[i];
    probes.push(w, w[1] + w[0] + w.slice(2), w + "x", w.slice(1));
  }
  for (const maxDist of [1, 2]) {
    for (const p of probes) {
      assert.deepEqual(
        tree.query(p, maxDist),
        brute(p, maxDist),
        `tree vs brute mismatch for "${p}" at maxDist ${maxDist}`
      );
    }
  }
});

test("results sort by distance first, then rank", () => {
  // rank order deliberately scrambled against distance order
  const tree = BK.create(["catch", "cat", "cots", "cart"]);
  const got = tree.query("cat", 2);
  assert.deepEqual(got, [
    { w: "cat", d: 0, rank: 1 },
    { w: "cart", d: 1, rank: 3 },
    { w: "catch", d: 2, rank: 0 },
    { w: "cots", d: 2, rank: 2 },
  ]);
});

test("duplicate words are skipped, first occurrence keeps the rank", () => {
  const tree = BK.create(["cat", "dog", "cat", "cow", "dog"]);
  assert.equal(tree.size, 3);
  assert.equal(countNodes(tree.root), 3);
  assert.deepEqual(tree.query("cat", 0), [{ w: "cat", d: 0, rank: 0 }]);
});

test("query respects maxDist boundaries", () => {
  const tree = BK.create(["cat", "cart", "carts"]);
  assert.deepEqual(tree.query("cat", 0), [{ w: "cat", d: 0, rank: 0 }]);
  const d1 = tree.query("cat", 1).map((r) => r.w);
  assert.deepEqual(d1, ["cat", "cart"]);
  const d2 = tree.query("cat", 2).map((r) => r.w);
  assert.deepEqual(d2, ["cat", "cart", "carts"]);
});

test("empty word list yields an empty tree that answers queries", () => {
  const tree = BK.create([]);
  assert.equal(tree.size, 0);
  assert.deepEqual(tree.query("anything", 2), []);
});

test("real lexicon: computign finds computing at d=1", () => {
  const tree = BK.create(window.PromptWords);
  const hits = tree.query("computign", 1);
  const hit = hits.find((r) => r.w === "computing");
  assert.ok(hit, `expected "computing" among ${JSON.stringify(hits)}`);
  assert.equal(hit.d, 1);
  assert.equal(hit.rank, window.PromptWords.indexOf("computing"));
  // and the list obeys the (d, rank) contract
  for (let i = 1; i < hits.length; i++) {
    const a = hits[i - 1];
    const b = hits[i];
    assert.ok(a.d < b.d || (a.d === b.d && a.rank < b.rank), "sort violated");
  }
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
console.log(failed === 0 ? `\nAll ${tests.length} bktree tests passed.` : `\n${failed} bktree test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
