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
    { when: /^write (a|an) email\b/i, add: " to {recipient} about {topic}. Keep it concise and professional." },
    { when: /^write (a|an)\b/i, add: " that is clear, well-structured, and easy to follow." },
    { when: /^summariz(e|e the)\b/i, add: " the key points in a few bullet points." },
    { when: /^explain\b/i, add: " this in simple terms, as if to someone new to the topic." },
    { when: /^translate\b/i, add: " the following text into {language}, preserving tone." },
    { when: /^fix\b/i, add: " the bug in the code below and explain what was wrong." },
    { when: /^refactor\b/i, add: " the following code for readability without changing behavior." },
    { when: /^review\b/i, add: " the following code and point out bugs, edge cases, and improvements." },
    { when: /^generate\b/i, add: " a list of ideas, then rank them from most to least promising." },
    { when: /^give me\b/i, add: " a step-by-step plan I can follow." },
    { when: /^help me\b/i, add: " think through this step by step." },
    { when: /^can you\b/i, add: " walk me through this step by step?" },
    { when: /^compare\b/i, add: " the options in a table with pros and cons." },
    { when: /^brainstorm\b/i, add: " a range of distinct approaches, including unconventional ones." },
    { when: /^turn\b/i, add: " the following notes into a polished draft." },
    { when: /^act as\b/i, add: " an expert in the field and answer accordingly." },
    { when: /^what (is|are)\b/i, add: " — and why does it matter in practice?" },
    { when: /^how (do|can) i\b/i, add: " — give me a concrete example." },
  ];

  function templateSuggestion(text) {
    const trimmed = text.replace(/\s+$/, "");
    for (const t of TEMPLATES) {
      if (t.when.test(trimmed)) {
        // Don't re-suggest what the user already typed past.
        const candidate = t.add.replace(/^\s+/, " ");
        return candidate;
      }
    }
    return null;
  }

  // --- Personal n-gram language model --------------------------------------
  // A word-level back-off model trained incrementally on the user's own
  // prompts, entirely on-device.
  //
  //   Data:   counts C(w | h) for histories h of order 2 and 3.
  //   Score:  P(w | h) = λ₃·P̂₃(w | h₃) + λ₂·P̂₂(w | h₂)
  //           where P̂ₙ is the maximum-likelihood estimate at order n and the
  //           λ's implement simple linear interpolation (Jelinek-Mercer
  //           smoothing) so the trigram evidence dominates when present but
  //           the bigram floor keeps predictions from vanishing on sparse
  //           histories.
  //   Emit:   greedy decoding, one word at a time, but ONLY while the
  //           interpolated probability clears CONFIDENCE_MIN and the winning
  //           count clears SUPPORT_MIN — an autocomplete that is unsure
  //           should stay silent rather than guess (precision > recall:
  //           every bad ghost costs user trust).
  const HISTORY_KEY = "pc_ngrams";
  const MAX_NGRAMS = 4000;
  const LAMBDA_3 = 0.7; // weight on the trigram estimate
  const LAMBDA_2 = 0.3; // weight on the bigram estimate
  const CONFIDENCE_MIN = 0.45; // interpolated P(w|h) below this → stop emitting
  const SUPPORT_MIN = 2; // require the winning continuation seen ≥ this often
  const MAX_EMIT = 6; // cap the greedy rollout length

  let ngramCache = null;

  async function loadNgrams() {
    if (ngramCache) return ngramCache;
    try {
      const data = await chrome.storage.local.get(HISTORY_KEY);
      ngramCache = data[HISTORY_KEY] || {};
    } catch (_) {
      ngramCache = {};
    }
    return ngramCache;
  }

  // ---- Learning pipeline: ingest → normalize → chunk → index --------------
  // Each stage is a pure function so the pipeline is testable in isolation.

  /** Stage 1 — normalize: lowercase, strip punctuation, collapse whitespace. */
  function normalize(s) {
    return s.toLowerCase().match(/[a-z0-9']+/g) || [];
  }

  /**
   * Stage 2 — chunk: slide fixed-width windows over the token stream and pair
   * each history chunk with the token that follows it. Emits `{h, next}`
   * records for orders 2 and 3 — the training examples for the model.
   */
  function chunk(tokens) {
    const records = [];
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n < tokens.length; i++) {
        records.push({ h: tokens.slice(i, i + n).join(" "), next: tokens[i + n] });
      }
    }
    return records;
  }

  /** Stage 3 — index: fold the chunked records into the count table. */
  function index(grams, records) {
    for (const { h, next } of records) {
      grams[h] = grams[h] || {};
      grams[h][next] = (grams[h][next] || 0) + 1;
    }
    return grams;
  }

  /** Full pipeline — run on every submitted prompt (ingest happens upstream). */
  async function learn(promptText) {
    if (!promptText || promptText.length < 8) return;
    const grams = index(await loadNgrams(), chunk(normalize(promptText)));

    // Bounded model: evict oldest-inserted histories past the cap. JS objects
    // preserve insertion order, so this is FIFO eviction — cheap and adequate
    // for a per-user model of this size.
    const keys = Object.keys(grams);
    if (keys.length > MAX_NGRAMS) {
      for (const k of keys.slice(0, keys.length - MAX_NGRAMS)) delete grams[k];
    }
    ngramCache = grams;
    try {
      await chrome.storage.local.set({ [HISTORY_KEY]: grams });
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
   * Score every candidate continuation of the current context with
   * P(w|h) = λ₃·P̂₃ + λ₂·P̂₂ and return the argmax with its probability
   * and raw support, or null when both orders are unseen.
   */
  function predictNext(grams, context) {
    const d3 = context.length >= 3 ? mle(grams, context.slice(-3).join(" ")) : null;
    const d2 = context.length >= 2 ? mle(grams, context.slice(-2).join(" ")) : null;
    if (!d3 && !d2) return null;

    const candidates = new Set([
      ...(d3 ? Object.keys(d3.counts) : []),
      ...(d2 ? Object.keys(d2.counts) : []),
    ]);

    let best = null;
    for (const w of candidates) {
      const p3 = d3 ? (d3.counts[w] || 0) / d3.total : 0;
      const p2 = d2 ? (d2.counts[w] || 0) / d2.total : 0;
      const p = LAMBDA_3 * p3 + LAMBDA_2 * p2;
      const support = Math.max(d3 ? d3.counts[w] || 0 : 0, d2 ? d2.counts[w] || 0 : 0);
      if (!best || p > best.p) best = { w, p, support };
    }
    return best;
  }

  /**
   * Greedy rollout: extend the context word by word while the model stays
   * confident. Silence beats a wrong guess — every bad ghost costs trust.
   */
  async function historySuggestion(text) {
    if (/\s$/.test(text) === false) return null; // only extend at a word boundary
    const grams = await loadNgrams();
    let context = normalize(text);
    if (context.length < 2) return null;

    const out = [];
    for (let step = 0; step < MAX_EMIT; step++) {
      const pred = predictNext(grams, context);
      if (!pred || pred.p < CONFIDENCE_MIN || pred.support < SUPPORT_MIN) break;
      out.push(pred.w);
      context = context.concat(pred.w);
    }
    return out.length ? out.join(" ") : null;
  }

  // --- AI suggestion (via background worker) -------------------------------
  async function aiSuggestion(text, signal) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      if (signal) signal.addEventListener("abort", () => done(null), { once: true });
      try {
        chrome.runtime.sendMessage({ type: "pc:complete", text }, (resp) => {
          if (chrome.runtime.lastError) return done(null);
          done(resp && resp.ok ? resp.completion : null);
        });
      } catch (_) {
        done(null);
      }
    });
  }

  // --- Public API ----------------------------------------------------------
  async function getSuggestion(text, settings, signal) {
    if (!text || text.trim().length < 2) return null;

    if (settings.mode === "ai") {
      const ai = await aiSuggestion(text, signal);
      if (ai) return sanitize(text, ai);
      // Fall back to local so the feature still helps if the key is missing.
    }

    const hist = await historySuggestion(text);
    if (hist) return " " + hist;

    const tpl = templateSuggestion(text);
    if (tpl) return tpl;

    return null;
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

  window.PromptComplete = { getSuggestion, learn };
})();
