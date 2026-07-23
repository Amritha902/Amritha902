/*
 * PromptComplete — BK-tree over the frequency-ranked lexicon
 *
 * A metric-tree index for spelling correction. Instead of generating every
 * edit-distance-1/2 candidate string (Norvig's approach in src/repair.js —
 * ~54n+25 strings per word, squared for distance 2), a BK-tree walks the
 * dictionary itself and uses the triangle inequality to skip whole subtrees.
 * The tree is built once over src/lexicon.js (index = rank, most frequent
 * first) and answers "all real words within distance k" queries directly.
 *
 * The metric is RESTRICTED Damerau-Levenshtein (optimal string alignment):
 * insert, delete, substitute, and ADJACENT TRANSPOSITION each cost 1. Plain
 * Levenshtein would price "computign" -> "computing" at 2, pushing the most
 * common real-world typo class (swapped fingers) out of the d=1 bucket the
 * repair tier trusts most. OSA keeps transpositions at 1 while remaining a
 * true metric on real words, which is what the BK-tree prune relies on.
 *
 * Exposes `window.PromptBK = { create, distance }`.
 */

(function () {
  "use strict";

  /**
   * Restricted Damerau-Levenshtein (OSA) distance between `a` and `b`.
   *
   * Classic dynamic programming over three rolling rows — the extra
   * "row before previous" is what the transposition term reads from
   * (d[i-2][j-2] + 1 when a[i-1..i] is b[j-1..j] swapped).
   *
   * `max` (optional) enables early abandon: distances never decrease down
   * the DP table along any alignment path, so once EVERY value in a row
   * exceeds `max` the final answer must too — we stop and return `max + 1`
   * (a value the caller can read as "further than I care about"). The
   * length-gap check up front is the same bound applied before any work:
   * |len(a) - len(b)| is a floor on the distance.
   */
  function distance(a, b, max) {
    if (a === b) return 0;
    const cap = typeof max === "number" ? max : Infinity;
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > cap) return cap + 1;
    if (m === 0) return n;
    if (n === 0) return m;

    let prevPrev = new Array(n + 1);
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      let rowMin = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          const t = prevPrev[j - 2] + 1; // adjacent transposition
          if (t < v) v = t;
        }
        curr[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > cap) return cap + 1;
      const spare = prevPrev;
      prevPrev = prev;
      prev = curr;
      curr = spare;
    }
    const d = prev[n];
    return d > cap ? cap + 1 : d;
  }

  /**
   * Build a BK-tree over `words` (array; index = frequency rank, so node
   * indices double as scores — lower is more common). Root is the first
   * word. Each node is { i: wordIndex, ch: { [distance]: childNode } }.
   *
   * Insertion walks from the root: compute d to the node's word; if a child
   * already hangs off edge d, recurse into it, otherwise attach there. The
   * invariant this creates — the child hanging off edge k is at distance
   * EXACTLY k from its parent's word — is what makes the query-time
   * triangle prune sound (see query below).
   *
   * Duplicate words are skipped, so the first (most frequent) occurrence
   * keeps the rank.
   *
   * Returns { root, size, query }.
   */
  function create(words) {
    const seen = new Set();
    let root = null;
    let size = 0;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (seen.has(w)) continue;
      seen.add(w);
      size++;
      if (!root) {
        root = { i: i, ch: {} };
        continue;
      }
      let node = root;
      for (;;) {
        const d = distance(w, words[node.i]);
        if (d === 0) break; // paranoia: `seen` already filters duplicates
        const child = node.ch[d];
        if (child) {
          node = child;
        } else {
          node.ch[d] = { i: i, ch: {} };
          break;
        }
      }
    }

    /**
     * All tree words within `maxDist` of `word`, as { w, d, rank } sorted
     * by (d ascending, rank ascending) — i.e. closest first, most frequent
     * first among ties. That is exactly the order the repair tier wants to
     * try candidates in.
     *
     * Prune: with true distance d from the query to a node's word, any word
     * u under the child at edge k satisfies |d - k| <= dist(query, u) by
     * the triangle inequality (dist(node, u') = k for the child root, and
     * the metric bounds compose down the subtree). So only children with
     * d - maxDist <= k <= d + maxDist can possibly hold a hit.
     *
     * Early abandon vs. prune soundness: we cap the per-node distance at
     * maxDist + (largest child edge). If the true distance fits under that
     * cap we get it exactly, so the prune window is exact. If it doesn't,
     * the true d exceeds every child edge by more than maxDist — no child
     * can qualify — and the clamped return (cap + 1) yields a window whose
     * low end (cap + 1 - maxDist = largest edge + 1) is above every edge,
     * so we correctly descend nothing. Either way, nothing is ever lost.
     */
    function query(word, maxDist) {
      const out = [];
      if (!root) return out;
      const stack = [root];
      while (stack.length) {
        const node = stack.pop();
        let maxEdge = 0;
        for (const k in node.ch) {
          const kk = +k;
          if (kk > maxEdge) maxEdge = kk;
        }
        const d = distance(word, words[node.i], maxDist + maxEdge);
        if (d <= maxDist) out.push({ w: words[node.i], d: d, rank: node.i });
        const lo = d - maxDist;
        const hi = d + maxDist;
        for (const k in node.ch) {
          const kk = +k;
          if (kk >= lo && kk <= hi) stack.push(node.ch[kk]);
        }
      }
      out.sort((x, y) => x.d - y.d || x.rank - y.rank);
      return out;
    }

    return { root: root, size: size, query: query };
  }

  window.PromptBK = { create: create, distance: distance };
})();
