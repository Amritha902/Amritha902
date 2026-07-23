/*
 * PromptComplete — weighted top-K trie for prefix autocomplete
 *
 * The linear scan in src/repair.js (`bestForPrefix`) walks the whole ~10k
 * lexicon on every keystroke. Fine for a fallback, wasteful as the hot path.
 * This module trades a little build-time memory for O(|prefix|) lookups:
 * every trie node caches the K best-ranked word indices in its subtree, so
 * "best completion for this prefix" is a walk plus a peek at a tiny array.
 *
 * The trick that keeps the build O(total characters): the input word list is
 * ALREADY frequency-ranked (array index = rank, lower = more frequent — the
 * exact shape of window.PromptWords in src/lexicon.js). Inserting words in
 * array order means each node sees candidates in best-first order, so its
 * `top` cache fills up sorted for free — no comparisons, no merging, just
 * "push while there's room".
 *
 * Exposes `window.PromptTrie = { create }`; create(words) → { best, topK }.
 */

(function () {
  "use strict";

  // Cache width per node. 8 covers suggestion cycling (topK) with headroom;
  // any deeper demand (a filter that rejects everything cached) falls back
  // to an exhaustive DFS below — rare by construction, correct always.
  const K = 8;

  const makeNode = () => ({ ch: Object.create(null), top: [] });

  /**
   * Build a trie over `words` (lowercase, index = frequency rank).
   * Returns { best, topK } closed over the built structure.
   */
  function create(words) {
    const root = makeNode();

    // word → rank, so the DFS fallback can recognise terminals without the
    // nodes carrying end-of-word markers (nodes stay a lean { ch, top }).
    // First occurrence wins, matching how src/repair.js ranks duplicates.
    const RANK = new Map();
    words.forEach((w, i) => {
      if (!RANK.has(w)) RANK.set(w, i);
    });

    // Insert in array order (= rank order). At every node along the path,
    // record index i while there's room: the first K words through a node
    // are exactly its K best-ranked, already sorted. Crucial invariant for
    // later: a node whose top has FEWER than K entries has its ENTIRE
    // subtree cached — a cache miss there is a true miss, no DFS needed.
    for (let i = 0; i < words.length; i++) {
      let node = root;
      if (node.top.length < K) node.top.push(i);
      for (const c of words[i]) {
        node = node.ch[c] || (node.ch[c] = makeNode());
        if (node.top.length < K) node.top.push(i);
      }
    }

    /** Walk `prefix` from the root; null if the path dies. O(|prefix|). */
    function descend(prefix) {
      let node = root;
      for (const c of prefix) {
        node = node.ch[c];
        if (!node) return null;
      }
      return node;
    }

    const passes = (w, minLen, filter) =>
      w.length >= minLen && (!filter || filter(w));

    /**
     * Exhaustive best-ranked passing word in `node`'s subtree. Only reached
     * when a full top-K cache was entirely filtered out, so this stays off
     * the hot path; correctness beats speed here. Terminals are detected by
     * rebuilding each candidate string and probing RANK.
     */
    function dfsBest(node, str, minLen, filter) {
      let bestIdx = Infinity;
      const rank = RANK.get(str);
      if (rank !== undefined && passes(str, minLen, filter)) bestIdx = rank;
      for (const c in node.ch) {
        const sub = dfsBest(node.ch[c], str + c, minLen, filter);
        if (sub < bestIdx) bestIdx = sub;
      }
      return bestIdx;
    }

    /**
     * Best-ranked completion of `prefix`, or null.
     *   opts.minExtra (default 1) — candidates must extend the prefix by at
     *     least this many chars. 1 keeps one-letter extensions valid
     *     ("creat" → "create"); demanding more would skip the right word.
     *   opts.filter — optional predicate for caller-imposed constraints
     *     (e.g. grammar rules from suggest.js).
     */
    function best(prefix, opts = {}) {
      const minExtra = opts.minExtra === undefined ? 1 : opts.minExtra;
      const filter = opts.filter || null;
      const node = descend(prefix);
      if (!node) return null;

      // Fast path: top is rank-sorted, so the first passing entry wins.
      const minLen = prefix.length + minExtra;
      for (const i of node.top) {
        if (passes(words[i], minLen, filter)) return words[i];
      }

      // Cache miss. If top wasn't full, it held the whole subtree (see the
      // build invariant) — nothing passes, full stop. If it WAS full, the
      // answer may sit beyond the K cached entries: go find it exhaustively.
      if (node.top.length < K) return null;
      const idx = dfsBest(node, prefix, minLen, filter);
      return idx === Infinity ? null : words[idx];
    }

    /**
     * Up to `k` completions of `prefix` in rank order (minExtra fixed at 1),
     * for suggestion cycling. Served from the top-K cache only — cycling is
     * a convenience surface, not worth a subtree walk. [] on a dead prefix.
     */
    function topK(prefix, k, filter) {
      const node = descend(prefix);
      if (!node) return [];
      const out = [];
      const minLen = prefix.length + 1;
      for (const i of node.top) {
        if (out.length >= k) break;
        if (passes(words[i], minLen, filter)) out.push(words[i]);
      }
      return out;
    }

    return { best, topK };
  }

  window.PromptTrie = { create };
})();
