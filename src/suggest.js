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

  // --- Personal n-gram model (learned from the user's own prompts) ---------
  // We store a map from a 2-3 word prefix -> {continuation: count}. On each
  // accepted/submitted prompt we index its phrases so future typing of the
  // same lead-in predicts the continuation.
  const HISTORY_KEY = "pc_ngrams";
  const MAX_NGRAMS = 4000;

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

  function tokenize(s) {
    return s.toLowerCase().match(/[a-z0-9']+/g) || [];
  }

  // Learn from a completed prompt: index each 2- and 3-word window -> next word.
  async function learn(promptText) {
    if (!promptText || promptText.length < 8) return;
    const grams = await loadNgrams();
    const words = tokenize(promptText);
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n < words.length; i++) {
        const key = words.slice(i, i + n).join(" ");
        const next = words[i + n];
        grams[key] = grams[key] || {};
        grams[key][next] = (grams[key][next] || 0) + 1;
      }
    }
    // Evict if the model grows too large (drop the least-recently-touched keys).
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

  // Predict a short continuation (up to a few words) from the personal model.
  async function historySuggestion(text) {
    const grams = await loadNgrams();
    const words = tokenize(text);
    if (words.length < 2) return null;
    if (/\s$/.test(text) === false) return null; // only extend at a word boundary

    const out = [];
    let context = words.slice(-3);
    for (let step = 0; step < 6; step++) {
      let key = context.slice(-3).join(" ");
      let choices = grams[key];
      if (!choices) {
        key = context.slice(-2).join(" ");
        choices = grams[key];
      }
      if (!choices) break;
      // Pick the most frequent continuation.
      let best = null;
      let bestCount = 0;
      for (const [w, c] of Object.entries(choices)) {
        if (c > bestCount) {
          best = w;
          bestCount = c;
        }
      }
      if (!best || bestCount < 2) break; // need at least a little evidence
      out.push(best);
      context = context.concat(best);
    }
    if (out.length === 0) return null;
    return out.join(" ");
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
