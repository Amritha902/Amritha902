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
 * The metric is TRUE (unrestricted) Damerau-Levenshtein: insert, delete,
 * substitute, and adjacent transposition each cost 1. Plain Levenshtein
 * would price "computign" -> "computing" at 2, pushing the most common
 * real-world typo class (swapped fingers) out of the d=1 bucket the repair
 * tier trusts most.
 *
 * WHY UNRESTRICTED, NOT OSA: the restricted variant (optimal string
 * alignment) is NOT a metric — distance("ca","ac")=1 and
 * distance("ac","abc")=1 but OSA("ca","abc")=3, violating the triangle
 * inequality the BK prune depends on. An adversarial review proved queries
 * silently lost real hits under OSA ("logrd" missed "lord"). Unrestricted
 * Damerau-Levenshtein (Lowrance-Wagner) allows edits between the halves of
 * a transposed pair, is a true metric (DL("ca","abc")=2), and is
 * COMPOSITIONAL: every word reachable by two sequential single edits is at
 * DL <= 2, so query(w, 2) exactly matches the coverage of Norvig's
 * edits1-applied-twice fallback.
 *
 * Exposes `window.PromptBK = { create, distance }`.
 */

(function () {
  "use strict";

  /**
   * TRUE Damerau-Levenshtein distance (Lowrance-Wagner) between `a` and `b`.
   *
   * Full (m+2)x(n+2) DP with the classic `da`/`db` bookkeeping: `da[c]` is
   * the last row where character c occurred in `a`, `db` the last column of
   * a match in the current row. The transposition term reads
   * d[i1-1][j1-1] + (i-i1-1) + 1 + (j-j1-1) — the swap plus the cost of the
   * characters between the swapped pair — which is what makes the metric
   * unrestricted (and thus a genuine metric; see header).
   *
   * `max` (optional) caps the OBSERVABLE result: anything beyond it comes
   * back as `max + 1` ("further than I care about"). The length-gap floor
   * short-circuits for free; the DP itself runs to completion — words are
   * short (<= ~20 chars), so a full table is ~400 cells and correctness is
   * worth more than an early-abandon row trick that is unsound for the
   * transposition recurrence (it reads arbitrarily far back up the table).
   */
  function distance(a, b, max) {
    if (a === b) return 0;
    const cap = typeof max === "number" ? max : Infinity;
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > cap) return cap + 1;
    if (m === 0) return n > cap ? cap + 1 : n;
    if (n === 0) return m > cap ? cap + 1 : m;

    const INF = m + n;
    // d[i+1][j+1] corresponds to prefixes a[0..i), b[0..j).
    const d = new Array(m + 2);
    for (let i = 0; i < m + 2; i++) d[i] = new Array(n + 2);
    d[0][0] = INF;
    for (let i = 0; i <= m; i++) {
      d[i + 1][1] = i;
      d[i + 1][0] = INF;
    }
    for (let j = 0; j <= n; j++) {
      d[1][j + 1] = j;
      d[0][j + 1] = INF;
    }

    const da = Object.create(null); // last row (1-based) where a's char occurred
    for (let i = 1; i <= m; i++) {
      let db = 0; // last column (1-based) of a match in this row
      for (let j = 1; j <= n; j++) {
        const i1 = da[b[j - 1]] || 0;
        const j1 = db;
        let cost = 1;
        if (a[i - 1] === b[j - 1]) {
          cost = 0;
          db = j;
        }
        d[i + 1][j + 1] = Math.min(
          d[i][j] + cost, // substitute / match
          d[i + 1][j] + 1, // insert
          d[i][j + 1] + 1, // delete
          d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1) // transpose (+ gap)
        );
      }
      da[a[i - 1]] = i;
    }
    const res = d[m + 1][n + 1];
    return res > cap ? cap + 1 : res;
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
