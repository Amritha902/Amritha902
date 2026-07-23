/*
 * PromptComplete — garble repair ("did you mean") tier
 *
 * Detects badly-typed trailing text — typos ("computign"), jammed words
 * ("understandingkinda"), and misplaced spaces ("understandin gkinda") — and
 * proposes a cleaned version. Norvig-style spelling correction: generate
 * edit-distance-1/2 candidates, keep the ones that are real words, rank by
 * corpus frequency. Entirely on-device.
 *
 * Exposes `window.PromptRepair = { repairTail, isKnown }` for the content
 * script (which owns the chip UI and the Ctrl+. accept key).
 */

(function () {
  "use strict";

  // Frequency-ordered word list (most frequent first). Rank = score.
  // Primary source: src/lexicon.js — ~10k words generated from the REAL
  // google-10000-english dataset (Google Web Trillion Word Corpus; see
  // tools/build-lexicon.mjs for provenance). The compact inline list below
  // is only a fallback when lexicon.js isn't loaded (e.g. isolated tests).
  const FALLBACK = (
    "the of and to in a is that for it as was with be by on not he i this are or his from at which but have an they you were her " +
    "she all would there their we him been has when who will no more if out so up said what its about than into them can only other " +
    "time new some could these two may first then do any like my should now people over just also good those how very make our work " +
    "know where after get most me states right think say years going well down want use each day same here take because come does part " +
    "even place old find such again many week before must through back much go help line own see men us long great little world need " +
    "too way life still being under never day another while last might off since against three children yet found within along without " +
    "once around however small large every next case few during between four something both often always looked those things thing look " +
    "give write email letter message note draft reply response respond send sent explain explanation summarize summary translate " +
    "translation fix bug error code coding program programming function review refactor debug test tests testing generate create " +
    "creating build building design designing analyze analysis analyzing data dataset science scientist student learning learn " +
    "machine model models train training predict prediction compute computing computer computers understand understanding " +
    "understood question questions answer answers ask asking please thanks thank sorry hello okay yes no maybe kinda gonna wanna " +
    "idk pls btw fyi asap resume interview job internship project projects report reports presentation slides document documents " +
    "file files folder image images picture chart graph table list lists plan planning idea ideas brainstorm concept concepts " +
    "improve improving improvement better best worse worst simple simply complex detail details detailed short long concise clear " +
    "clearly professional formal informal friendly tone style format structure structured example examples step steps guide " +
    "tutorial beginner intermediate expert advanced level bullet points point paragraph sentence sentences word wording phrase " +
    "rephrase rewrite revise edit editing version draft manager boss team teammate colleague client customer user users professor " +
    "teacher deadline meeting schedule monthly weekly daily quarterly yearly revenue sales trend trends region regions market " +
    "growth metric metrics number numbers result results outcome impact business company startup product products feature features " +
    "prompt prompts chat chatting conversation assistant claude api key browser extension autocomplete suggestion suggestions " +
    "python javascript java react node sql html css math statistics probability average median percent percentage compare comparison " +
    "difference different similar between versus context specific specifically requirement requirements constraint constraints " +
    "audience reader knowledge topic subject field area focus goal goals objective task tasks item items section sections " +
    "introduction conclusion body header title heading name names date dates today tomorrow yesterday morning afternoon evening " +
    "night time minute minutes hour hours quick quickly slow carefully thorough thoroughly check checking verify important urgent"
  ).split(/\s+/);

  const WORDS =
    window.PromptWords && window.PromptWords.length ? window.PromptWords : FALLBACK;

  const RANK = new Map();
  WORDS.forEach((w, i) => {
    if (!RANK.has(w)) RANK.set(w, i);
  });

  const LETTERS = "abcdefghijklmnopqrstuvwxyz";

  const isKnown = (w) => RANK.has(w.toLowerCase());
  const score = (w) => (RANK.has(w) ? RANK.get(w) : Infinity);

  /** All strings one edit away (Norvig's edits1). */
  function edits1(word) {
    const out = new Set();
    for (let i = 0; i <= word.length; i++) {
      const L = word.slice(0, i);
      const R = word.slice(i);
      if (R) out.add(L + R.slice(1)); // delete
      if (R.length > 1) out.add(L + R[1] + R[0] + R.slice(2)); // transpose
      for (const c of LETTERS) {
        if (R) out.add(L + c + R.slice(1)); // replace
        out.add(L + c + R); // insert
      }
    }
    return out;
  }

  /** Best known correction for a single word, or null. */
  function correctWord(word) {
    const w = word.toLowerCase();
    if (w.length < 3 || isKnown(w)) return null;

    // Jammed pair: "understandingkinda" → "understanding kinda".
    let bestSplit = null;
    for (let i = 2; i <= w.length - 2; i++) {
      const a = w.slice(0, i);
      const b = w.slice(i);
      if (isKnown(a) && isKnown(b)) {
        const s = score(a) + score(b);
        if (!bestSplit || s < bestSplit.s) bestSplit = { fix: a + " " + b, s };
      }
    }

    // Edit distance 1, then 2 (only for longer words — short words at
    // distance 2 are mostly noise).
    let bestEdit = null;
    const consider = (cand) => {
      if (isKnown(cand) && (!bestEdit || score(cand) < bestEdit.s)) {
        bestEdit = { fix: cand, s: score(cand) };
      }
    };
    const e1 = edits1(w);
    for (const c of e1) consider(c);
    if (!bestEdit && w.length > 5) {
      for (const c of e1) for (const c2 of edits1(c)) consider(c2);
    }

    if (bestSplit && (!bestEdit || bestSplit.s <= bestEdit.s)) return bestSplit.fix;
    return bestEdit ? bestEdit.fix : null;
  }

  /**
   * Repair the trailing garbled span of `text` (up to the last 3 words).
   * Handles per-word typos, jammed words, and the misplaced-space pattern
   * ("understandin gkinda" → join → resplit → "understanding kinda").
   * Returns { from, to, fixed } — the char span to replace and its
   * replacement — or null when the tail is fine (or unrepairable).
   */
  function repairTail(text) {
    const m = text.match(/(\S+(?:\s+\S+){0,2})\s*$/);
    if (!m) return null;
    const tail = m[1];
    const from = m.index;
    const words = tail.split(/\s+/);
    if (words.every((w) => isKnown(w) || /[^a-zA-Z]/.test(w))) return null;

    // Pass 1 — per-word correction.
    let anyFix = false;
    const fixedWords = words.map((w) => {
      if (/[^a-zA-Z]/.test(w)) return w; // leave numbers/punctuation alone
      const fix = correctWord(w);
      if (fix) anyFix = true;
      return fix || w;
    });

    // Pass 2 — misplaced space across adjacent still-unknown words:
    // join the pair, correct the joined form (split/edit repair).
    for (let i = 0; i < fixedWords.length - 1; i++) {
      const a = fixedWords[i];
      const b = fixedWords[i + 1];
      if (/[^a-zA-Z]/.test(a) || /[^a-zA-Z]/.test(b)) continue;
      if (isKnown(a) && isKnown(b)) continue;
      const joinedFix = correctWord(a + b);
      if (joinedFix) {
        fixedWords.splice(i, 2, joinedFix);
        anyFix = true;
      }
    }

    if (!anyFix) return null;
    const fixed = fixedWords.join(" ");
    if (fixed.toLowerCase() === tail.toLowerCase()) return null;
    return { from, to: from + tail.length, fixed };
  }

  /**
   * Best dictionary completion for a typed prefix (frequency-ranked), or
   * null. `minExtra` guards against pointless one-letter completions.
   * Powers the word-completion ghost in suggest.js.
   */
  function bestForPrefix(prefix, minExtra = 2) {
    const p = prefix.toLowerCase();
    if (p.length < 2) return null;
    let best = null;
    let bestRank = Infinity;
    for (const [w, rank] of RANK) {
      if (w.length >= p.length + minExtra && w.startsWith(p) && rank < bestRank) {
        best = w;
        bestRank = rank;
      }
    }
    // The prefix may already BE the finished word ("explain" → don't ghost
    // "ed"). Only extend when the longer word is more frequent than what the
    // user has typed.
    if (best && RANK.has(p) && RANK.get(p) < bestRank) return null;
    return best;
  }

  window.PromptRepair = { repairTail, isKnown };
  window.PromptLexicon = { bestForPrefix };
})();
