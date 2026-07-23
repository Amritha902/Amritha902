# Algorithms & data structures — what runs on your keystroke, and why

Every choice below is benchmarked by `npm run bench` (`bench/bench.mjs`) —
deterministic (seeded), against the real lexicon and the real prompt corpus.
Numbers cited are from that harness on the CI-class container this repo ships
from; re-run it to reproduce them on your machine.

## The hot path, end to end

```
keystroke ──debounce──▶ word completion ──▶ phrase judgment ──▶ templates/IR ──▶ leading prompts
                │              │                  │
                │        weighted trie      KN model + beam search
                │        (O(|prefix|))      (O(k) per step, width 3)
                │
                └──quiet gap──▶ garble repair (BK-tree metric query)
```

## 1. Prefix completion — weighted top-K trie (`src/trie.js`)

**Problem:** find the most frequent word extending a typed prefix, under an
optional grammatical filter. The naive linear scan is O(V) per keystroke over
the ~10k-word lexicon.

**Structure:** a trie whose every node caches the indices of the K=8
best-ranked words in its subtree. Because the lexicon array is already
frequency-ranked (index = rank), inserting words in array order fills each
node's cache pre-sorted — build is O(total characters), no comparisons.
A query walks the prefix — O(|prefix|) — and peeks at the cache. If a filter
rejects the entire cache, an exhaustive subtree walk preserves correctness
(the build invariant guarantees an under-filled cache holds the *whole*
subtree, so a miss there is a true miss).

**Measured:** p50 **0.72µs** vs 186µs linear (**255×**), p95 1.4µs, build
29ms once at load, **0 correctness mismatches** across 8,583 verified queries.

## 2. Spell repair — Damerau–Levenshtein BK-tree (`src/bktree.js`)

**Problem:** given a garbled word, find real words within edit distance 1–2.
Norvig-style generation enumerates every candidate string (~54n+25 for d=1,
squared for d=2 — hundreds of thousands of strings for a 9-letter word).

**Structure:** a BK-tree — a metric tree keyed by edit distance — over the
lexicon. The metric is *restricted Damerau–Levenshtein* (OSA), so the most
common real-world typo class (adjacent transposition, "computign") costs 1.
Queries prune subtrees by the triangle inequality and abandon distance
computations early once a whole DP row exceeds the bound. Tests prove pruned
queries return exactly the brute-force result set.

**Measured:** total workload time **1.15s vs 7.1s** (**6.2×**), with the tail
tamed — p95 **5.0ms vs 50.7ms** (Norvig's d=2 blowup) — at equal top-1
accuracy (78.9% vs 79.1% on 750 seeded corruptions).

## 3. Language model — interpolated Kneser–Ney (`src/suggest.js`)

The personal model is the smoothing family production n-gram systems use:
absolute discounting (D = 0.75) with continuation-count back-off,
continuation counts maintained **O(1) incrementally at index time**. Trained
only on prompts you send, on-device. Stems canonicalize history keys
(evidence pooling across inflections); continuations keep surface forms.

**Measured** (80/20 split over 400 real corpus prompts): the confidence gate
(P ≥ 0.45, support ≥ 2) emits a prediction at 1.8% of positions on
*held-out strangers' prompts* and is right **88.7%** of the time it speaks —
precision over recall, quantified. (On your own recurring phrasing coverage
is far higher; this is the honest floor, not a flattering ceiling.)

## 4. Decoding — beam search, joint-probability gated

Greedy decoding commits to the locally-best word and stops at the first
uncertain step — even when every branch re-converges ("deploy
[logs|status] for errors today"). The rollout is now **width-3 beam search**:

- entry: first word must clear the strict gate (P ≥ 0.45, n ≥ 2)
- expansion: later words explore at P ≥ 0.25 (n ≥ 2)
- emission: a path is emitted only if its geometric-mean P ≥ 0.45;
  longest qualifying path wins, log-probability breaks ties

## 5. Constrained decoding — the agreement engine

Frequency has no grammar, so every completion source (context model,
personal vocabulary, dictionary) is filtered through morphological
agreement rules: `to`/modals → base form; `am`/`being` → -ing;
be-forms → participle; `have/has/had` → -ed; `a`/`an` → singular
noun-shaped; repetition of the previous word is impossible; complete
common words ("to", "explain") are never extended. Constraints degrade
gracefully — if no candidate of the required form exists anywhere, the
best unconstrained match falls through rather than going silent.

## 6. Retrieval — vector-space templates

Curated scaffolds are matched by cosine similarity over stem TF vectors when
the regex fast-path misses a paraphrase. With ~30 templates this is
microseconds; the interesting part is the trigger list itself, which is
validated against a real corpus (see `docs/DATA.md` — "i want you to" earned
its trigger from a measured 10.7% share).

## 7. What the measurements say about the product

- Word completion on real prompt text: **37.4%** of (prefix, word) attempts
  hit exactly; 70% of words become completable at some prefix; potential
  keystroke savings **26.4%** from the dictionary tier alone (personal
  vocabulary and phrase judgment add on top for a returning user).
- The whole local path is comfortably under a millisecond per keystroke —
  the 220ms debounce, not compute, dominates time-to-ghost.

## Reproduce

```
npm test          # 61 unit tests (model, repair, trie, BK-tree)
npm run test:e2e  # 30 real-browser assertions
npm run bench     # every number in this document
```
