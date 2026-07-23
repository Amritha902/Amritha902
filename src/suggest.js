/*
 * PromptComplete — suggestion engine
 *
 * Runs inside the content-script isolated world. Exposes a single global,
 * `PromptComplete`, that content.js consumes. Two suggestion sources:
 *
 *   1. "local"  — zero-latency, private. A curated library of prompt-pattern
 *                 continuations plus an n-gram model learned from the user's
 *                 own past prompts (stored in chrome.storage.local).
 *   2. "ai"     — opt-in. Sends the partial prompt to the background service
 *                 worker, which calls the Claude API with the user's own key.
 *
 * Only continuations of the text before the caret are ever suggested, and
 * only when the caret sits at the end of the input — the Gmail Smart Compose
 * model. That keeps the UX predictable and the implementation simple.
 */

(function () {
  "use strict";

  // --- Curated prompt-pattern library -------------------------------------
  // Keyed by a lowercase prefix the current text must start with. The first
  // matching entry whose continuation extends the text wins. Ordered from
  // most specific to least specific.
  const TEMPLATES = [
    { when: /^write (a|an) email\b/i, keys: "write email", add: " to {recipient} about {topic}. Keep it concise and professional." },
    { when: /^write (a|an)\b/i, keys: "write draft", add: " that is clear, well-structured, and easy to follow." },
    { when: /^summariz(e|e the)\b/i, keys: "summarize summary", add: " the key points in a few bullet points." },
    { when: /^explain\b/i, keys: "explain understand", add: " this in simple terms, as if to someone new to the topic." },
    { when: /^translate\b/i, keys: "translate language", add: " the following text into {language}, preserving tone." },
    { when: /^fix\b/i, keys: "fix bug error", add: " the bug in the code below and explain what was wrong." },
    { when: /^refactor\b/i, keys: "refactor clean code", add: " the following code for readability without changing behavior." },
    { when: /^review\b/i, keys: "review code check", add: " the following code and point out bugs, edge cases, and improvements." },
    { when: /^generate\b/i, keys: "generate ideas", add: " a list of ideas, then rank them from most to least promising." },
    { when: /^give me\b/i, keys: "give plan", add: " a step-by-step plan I can follow." },
    { when: /^help me\b/i, keys: "help think", add: " think through this step by step." },
    { when: /^can you\b/i, keys: "walk through", add: " walk me through this step by step?" },
    { when: /^compare\b/i, keys: "compare options versus", add: " the options in a table with pros and cons." },
    { when: /^brainstorm\b/i, keys: "brainstorm ideas approaches", add: " a range of distinct approaches, including unconventional ones." },
    { when: /^turn\b/i, keys: "turn notes convert", add: " the following notes into a polished draft." },
    { when: /^act as\b/i, keys: "act role expert", add: " an expert in the field and answer accordingly." },
    { when: /^what (is|are)\b/i, keys: "what meaning", add: " — and why does it matter in practice?" },
    { when: /^how (do|can) i\b/i, keys: "how do example", add: " — give me a concrete example." },
    { when: /^i want to\b/i, keys: "want goal plan", add: " {goal} — give me a concrete plan to get there." },
    { when: /^i need\b/i, keys: "need help", add: " help with {topic} — start with the three most important things to know." },
    { when: /^tell me\b/i, keys: "tell about", add: " about {topic} — the essentials first, details after." },
    { when: /^create\b/i, keys: "create make build", add: " a {thing} with a clear structure and one worked example." },
    { when: /^draft\b/i, keys: "draft first version", add: " a first version I can edit — short and structured." },
    { when: /^improve\b/i, keys: "improve better polish", add: " the following text for clarity and flow, keeping my voice." },
    { when: /^check\b/i, keys: "check verify errors", add: " the following for errors and suggest fixes." },
    { when: /^suggest\b/i, keys: "suggest options ideas", add: " a few options with pros and cons for each." },
    { when: /^plan\b/i, keys: "plan steps milestones", add: " this out step by step with milestones." },
    { when: /^make\b/i, keys: "make clearer concise", add: " this clearer and more concise without losing meaning." },
  ];

  // Templates complete a LEAD-IN, so both tiers only fire early in
  // composition — appending a lead-in scaffold to a long, developed prompt
  // would be wrong.
  const TEMPLATE_WINDOW = 8; // max tokens for template tiers to fire

  function templateSuggestion(text) {
    const trimmed = text.replace(/\s+$/, "");
    if (normalize(trimmed).length > TEMPLATE_WINDOW) return null;
    for (const t of TEMPLATES) {
      const m = trimmed.match(t.when);
      if (m) {
        // Fire only while the typed text IS the trigger phrase. Once the user
        // has typed past it ("write an email to my manager"), appending the
        // template would duplicate what they already wrote — stay silent and
        // let the personal model / IR / AI tiers take over.
        if (trimmed.slice(m[0].length).trim() !== "") continue;
        return t.add.replace(/^\s+/, " ");
      }
    }
    return null;
  }

  // ---- Word completion (the innermost tier) -------------------------------
  // Finish the WORD being typed — "h" → "hello" — the way Smart Compose and
  // Copilot do. Sources, in order: the user's own vocabulary (unigram counts
  // learned from sent prompts — real personalization), then the frequency-
  // ranked dictionary (window.PromptLexicon, from repair.js). Returns the
  // REMAINDER to ghost at the caret, or null.
  function wordCompletion(text) {
    const m = text.match(/([a-zA-Z']+)$/);
    if (!m) return null;
    const partial = m[1].toLowerCase();

    // The user's own words first: any prefix length, needs 2+ uses. A
    // candidate must also beat the typed word's OWN count — if the user has
    // already finished one of their frequent words, stay silent.
    const ownCount = (wordsCache && wordsCache[partial]) || 0;
    let best = null;
    let bestCount = ownCount;
    if (wordsCache) {
      for (const [w, c] of Object.entries(wordsCache)) {
        if (c >= 2 && c > bestCount && w.length > partial.length && w.startsWith(partial)) {
          best = w;
          bestCount = c;
        }
      }
    }
    // Dictionary fallback: 2+ typed chars, completion must add 2+ chars.
    if (!best && window.PromptLexicon) {
      best = window.PromptLexicon.bestForPrefix(partial, 2);
    }
    if (!best) return null;
    return best.slice(partial.length);
  }

  // Generic last-line guard for every tier: reject a candidate whose opening
  // words repeat the tail of what the user already typed ("…to my manager" +
  // " to {recipient}…").
  function overlapsTail(text, candidate) {
    const tail = normalize(text).slice(-3);
    const head = normalize(candidate).slice(0, 2);
    return head.length > 0 && head.some((w) => tail.includes(w));
  }

  // ---- Vector-space template retrieval (IR tier) --------------------------
  // When the regex fast-path misses (paraphrased lead-ins: "please write an
  // email", "can u fix this bug"), fall back to the classic vector space
  // model: represent the query and each template as term-frequency vectors
  // over STEMS (stop-words removed) and rank by cosine similarity.
  //
  //   sim(q, t) = (q · t) / (‖q‖ ‖t‖)
  //
  // With ~18 templates and vectors of 2-3 terms this is microseconds — an
  // O(|T|·|q|) scan, no index needed at this scale.
  const STOPWORDS = new Set([
    "a", "an", "the", "please", "can", "could", "you", "u", "me", "my", "i",
    "to", "for", "of", "in", "on", "this", "that", "hey", "hi", "some",
  ]);
  const COSINE_MIN = 0.6;

  function tfVector(stems) {
    const v = Object.create(null);
    for (const s of stems) {
      if (!STOPWORDS.has(s)) v[s] = (v[s] || 0) + 1;
    }
    return v;
  }

  function cosine(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (const k in a) {
      na += a[k] * a[k];
      if (b[k]) dot += a[k] * b[k];
    }
    for (const k in b) nb += b[k] * b[k];
    if (!dot || !na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  // Template vectors are computed once, lazily on first query (the pipeline
  // functions are declared later in the file; module-load-time precompute
  // would hit the temporal dead zone).
  let templateVectorsReady = false;
  function ensureTemplateVectors() {
    if (templateVectorsReady) return;
    for (const t of TEMPLATES) t.vec = tfVector(stemAll(normalize(t.keys)));
    templateVectorsReady = true;
  }

  function vectorTemplateSuggestion(text) {
    ensureTemplateVectors();
    const tokens = normalize(text);
    if (tokens.length === 0 || tokens.length > TEMPLATE_WINDOW) return null;
    const qv = tfVector(stemAll(tokens));
    let best = null;
    for (const t of TEMPLATES) {
      const sim = cosine(qv, t.vec);
      if (sim >= COSINE_MIN && (!best || sim > best.sim)) best = { t, sim };
    }
    return best ? best.t.add.replace(/^\s+/, " ") : null;
  }

  // --- Personal n-gram language model --------------------------------------
  // A word-level back-off model trained incrementally on the user's own
  // prompts, entirely on-device.
  //
  //   Data:   counts C(w | h) for histories h of order 2 and 3, plus
  //           incrementally-maintained continuation counts N₁₊(·w) — the
  //           number of DISTINCT histories each word has been seen to
  //           complete — for the Kneser-Ney back-off distribution.
  //   Score:  interpolated Kneser-Ney smoothing (Kneser & Ney 1995;
  //           Chen & Goodman 1999) with absolute discount D:
  //
  //             P₃(w|h₃) = max(C₃(h₃,w)−D, 0)/C₃(h₃) + γ(h₃)·P₂(w|h₂)
  //             P₂(w|h₂) = max(C₂(h₂,w)−D, 0)/C₂(h₂) + γ(h₂)·P_cont(w)
  //             P_cont(w) = N₁₊(·w) / Σ_v N₁₊(·v)
  //             γ(h)     = D · |distinct continuations of h| / C(h)
  //
  //           The continuation distribution is the KN insight: back off to
  //           "how many contexts does this word complete?", not raw
  //           frequency — the classic "San Francisco" fix ("Francisco" is
  //           frequent but only ever follows "San", so it makes a poor
  //           back-off candidate).
  //   Emit:   greedy decoding, one word at a time, but ONLY while the
  //           smoothed probability clears CONFIDENCE_MIN and the winning
  //           count clears SUPPORT_MIN — an autocomplete that is unsure
  //           should stay silent rather than guess (precision > recall:
  //           every bad ghost costs user trust).
  const HISTORY_KEY = "pc_ngrams";
  const CONT_KEY = "pc_cont"; // continuation counts for Kneser-Ney back-off
  const WORDS_KEY = "pc_words"; // unigram counts — powers word completion
  const MAX_NGRAMS = 4000;
  const KN_DISCOUNT = 0.75; // absolute discount D (standard value)
  const CONFIDENCE_MIN = 0.45; // smoothed P(w|h) below this → stop emitting
  const SUPPORT_MIN = 2; // require the winning continuation seen ≥ this often
  const MAX_EMIT = 6; // cap the greedy rollout length

  let ngramCache = null;
  let contCache = null; // { counts: {word: N₁₊(·w)}, pairs: Σ_v N₁₊(·v) }
  let wordsCache = null; // { word: count } — the user's own vocabulary

  async function loadNgrams() {
    if (ngramCache) return ngramCache;
    try {
      const data = await chrome.storage.local.get([HISTORY_KEY, CONT_KEY, WORDS_KEY]);
      ngramCache = data[HISTORY_KEY] || {};
      contCache = data[CONT_KEY] || { counts: {}, pairs: 0 };
      wordsCache = data[WORDS_KEY] || {};
    } catch (_) {
      ngramCache = {};
      contCache = { counts: {}, pairs: 0 };
      wordsCache = {};
    }
    return ngramCache;
  }

  // ---- Learning pipeline: ingest → clean → stem → chunk → index -----------
  // A classic text-analytics pipeline (cleaning/parsing → stemming →
  // feature extraction → indexing), with each stage a pure function so the
  // pipeline is testable in isolation.
  //
  // Latency budget (hot path, per keystroke after the 220ms debounce):
  //   clean   O(n) over characters      ~0.01ms for a typical prompt
  //   stem    O(1) per token            suffix rules only, no lookup table
  //   predict O(k) over candidates      k = distinct continuations of h
  //   Total: well under 1ms — the ghost text renders effectively instantly.

  /** Stage 1 — clean/parse: lowercase, strip punctuation, tokenize. */
  function normalize(s) {
    return s.toLowerCase().match(/[a-z0-9']+/g) || [];
  }

  /**
   * Stage 2 — stem (suffix-stripping, Porter-style rules with a minimum-stem
   * guard against overstemming, e.g. "using" must NOT become "us").
   *
   * Stems are used to canonicalize HISTORY KEYS only — "write an email" and
   * "writing an email" pool their evidence — while continuations are stored
   * and emitted as surface forms, so the ghost text always reads naturally.
   * Tradeoff (documented): light evidence pooling can merge near-neighbors
   * ("meeting"/"meet"); for a per-user model, denser evidence wins.
   */
  function stem(w) {
    if (w.length >= 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length >= 7 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length >= 6 && w.endsWith("ed")) return w.slice(0, -2);
    if (w.length >= 6 && w.endsWith("es")) return w.slice(0, -2);
    if (w.length >= 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    if (w.length >= 5 && w.endsWith("e")) return w.slice(0, -1);
    return w;
  }

  const stemAll = (tokens) => tokens.map(stem);

  /**
   * Stage 3 — chunk: slide fixed-width windows over the token stream and pair
   * each history chunk with the token that follows it. History keys are built
   * from STEMS (evidence pooling); continuations keep their SURFACE form
   * (natural ghost text). Emits `{h, next}` records for orders 2 and 3.
   */
  function chunk(tokens, stems) {
    const records = [];
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n < tokens.length; i++) {
        records.push({ h: stems.slice(i, i + n).join(" "), next: tokens[i + n] });
      }
    }
    return records;
  }

  /**
   * Stage 4 — index: fold the chunked records into the count table, and keep
   * the Kneser-Ney continuation counts current: when a (history, word) pair
   * is seen for the FIRST time at bigram order, that word now completes one
   * more distinct context — an O(1) incremental update that spares us an
   * O(table) scan at query time.
   */
  function index(grams, cont, records) {
    for (const { h, next } of records) {
      grams[h] = grams[h] || {};
      const isNewPair = !grams[h][next];
      grams[h][next] = (grams[h][next] || 0) + 1;
      if (isNewPair && h.indexOf(" ") === h.lastIndexOf(" ")) {
        // exactly two words → bigram-order history
        cont.counts[next] = (cont.counts[next] || 0) + 1;
        cont.pairs += 1;
      }
    }
    return grams;
  }

  /** Full pipeline — run on every submitted prompt (ingest happens upstream). */
  async function learn(promptText) {
    if (!promptText || promptText.length < 8) return;
    const tokens = normalize(promptText);
    await loadNgrams();
    const grams = index(ngramCache, contCache, chunk(tokens, stemAll(tokens)));

    // Bounded model: evict oldest-inserted histories past the cap. JS objects
    // preserve insertion order, so this is FIFO eviction — cheap and adequate
    // for a per-user model of this size. (Continuation counts are left as-is
    // on eviction; they decay in influence as `pairs` grows and staying
    // approximate keeps eviction O(evicted) rather than O(table).)
    const keys = Object.keys(grams);
    if (keys.length > MAX_NGRAMS) {
      for (const k of keys.slice(0, keys.length - MAX_NGRAMS)) delete grams[k];
    }
    ngramCache = grams;
    // Unigrams: every word the user actually types, counted — the substrate
    // for personalized word completion ("h" → the user's own "hello").
    for (const t of tokens) {
      if (t.length >= 2) wordsCache[t] = (wordsCache[t] || 0) + 1;
    }
    try {
      await chrome.storage.local.set({ [HISTORY_KEY]: grams, [CONT_KEY]: contCache, [WORDS_KEY]: wordsCache });
    } catch (_) {
      /* storage full or unavailable — non-fatal */
    }
  }

  // ---- Inference: interpolated back-off scoring + confidence gating -------

  /** MLE distribution over continuations of history `h`, or null if unseen. */
  function mle(grams, h) {
    const counts = grams[h];
    if (!counts) return null;
    let total = 0;
    for (const c of Object.values(counts)) total += c;
    return { counts, total };
  }

  /**
   * Interpolated Kneser-Ney scoring. For every candidate continuation of the
   * current context, compute
   *
   *   P₂(w|h₂) = max(C₂−D,0)/C₂(h₂) + γ(h₂)·P_cont(w)
   *   P₃(w|h₃) = max(C₃−D,0)/C₃(h₃) + γ(h₃)·P₂(w|h₂)
   *
   * and return the argmax with its probability and raw support, or null when
   * both orders are unseen. O(k) in the candidate count — the continuation
   * distribution was precomputed incrementally at index time.
   */
  function predictNext(grams, context) {
    const d3 = context.length >= 3 ? mle(grams, context.slice(-3).join(" ")) : null;
    const d2 = context.length >= 2 ? mle(grams, context.slice(-2).join(" ")) : null;
    if (!d3 && !d2) return null;

    const D = KN_DISCOUNT;
    const pCont = (w) =>
      contCache && contCache.pairs > 0 ? (contCache.counts[w] || 0) / contCache.pairs : 0;

    // Back-off weight γ(h): the probability mass freed by discounting.
    const gamma = (d) => (d ? (D * Object.keys(d.counts).length) / d.total : 0);

    const p2 = (w) => {
      if (!d2) return pCont(w);
      return Math.max((d2.counts[w] || 0) - D, 0) / d2.total + gamma(d2) * pCont(w);
    };
    const p3 = (w) => {
      if (!d3) return p2(w);
      return Math.max((d3.counts[w] || 0) - D, 0) / d3.total + gamma(d3) * p2(w);
    };

    const candidates = new Set([
      ...(d3 ? Object.keys(d3.counts) : []),
      ...(d2 ? Object.keys(d2.counts) : []),
    ]);

    let best = null;
    for (const w of candidates) {
      const p = p3(w);
      const support = Math.max(d3 ? d3.counts[w] || 0 : 0, d2 ? d2.counts[w] || 0 : 0);
      if (!best || p > best.p) best = { w, p, support };
    }
    return best;
  }

  /**
   * Greedy rollout: extend the context word by word while the model stays
   * confident. Silence beats a wrong guess — every bad ghost costs trust.
   * The lookup context is STEMMED (matching the index keys); emitted words
   * keep their surface form and are re-stemmed as they join the context.
   */
  async function historySuggestion(text) {
    if (/\s$/.test(text) === false) return null; // only extend at a word boundary
    const grams = await loadNgrams();
    let context = stemAll(normalize(text));
    if (context.length < 2) return null;

    const out = [];
    for (let step = 0; step < MAX_EMIT; step++) {
      const pred = predictNext(grams, context);
      if (!pred || pred.p < CONFIDENCE_MIN || pred.support < SUPPORT_MIN) break;
      out.push(pred.w);
      context = context.concat(stem(pred.w));
    }
    return out.length ? out.join(" ") : null;
  }

  // --- Public API ----------------------------------------------------------
  // Tier order: personal model first (it knows *you*), then the regex
  // fast-path over curated templates, then the vector-space IR fallback for
  // paraphrased lead-ins. All LOCAL — the streaming AI tier lives in the
  // content script (it needs the long-lived port); when an AI candidate
  // arrives it is appended to this list for Alt+]/[ cycling.

  /** All distinct local candidates, best tier first. */
  async function getCandidates(text) {
    if (!text || !text.trim()) return [];
    const out = [];
    const push = (s) => {
      if (s && !out.includes(s) && !overlapsTail(text, s)) out.push(s);
    };
    // The model predicts *from* the tail, so the overlap guard doesn't apply.
    // No leading space either: historySuggestion only fires at a word
    // boundary (text already ends in whitespace), so prepending one produced
    // a double space on accept.
    // Mid-word: complete the word first (phrase tiers need a boundary).
    if (!/\s$/.test(text)) {
      await loadNgrams(); // wordsCache rides the same storage load
      const wc = wordCompletion(text);
      if (wc) out.push(wc);
    }
    // Phrase tiers need at least a couple of characters of signal; a single
    // letter can still get a WORD completion above ("h" → the user's "hello").
    if (text.trim().length < 2) return out;
    const hist = await historySuggestion(text);
    if (hist) out.push(hist);
    push(templateSuggestion(text));
    push(vectorTemplateSuggestion(text));
    return out;
  }

  /** Best single suggestion (first candidate) — kept for tests + simplicity. */
  async function getSuggestion(text) {
    const c = await getCandidates(text);
    return c.length ? c[0] : null;
  }

  // Never suggest text the user already typed; trim overlap and runaway length.
  function sanitize(text, completion) {
    let c = completion;
    if (!c) return null;
    // If the model echoed the prompt, strip the echoed prefix.
    if (c.toLowerCase().startsWith(text.toLowerCase().trim())) {
      c = c.slice(text.trim().length);
    }
    c = c.replace(/\n{2,}/g, "\n").slice(0, 240);
    if (!c.trim()) return null;
    // Ensure a separating space if we're mid-word-boundary.
    if (!/\s$/.test(text) && !/^\s/.test(c) && !/^[.,!?;:)]/.test(c)) c = " " + c;
    return c;
  }

  window.PromptComplete = { getSuggestion, getCandidates, learn, sanitize };
})();
