/*
 * PromptComplete — Prompt Health engine
 *
 * Scores a draft prompt across five dimensions drawn from Anthropic's
 * published prompt-engineering guidance, entirely client-side (regex +
 * structural heuristics — no model call, no network):
 *
 *   role        Is Claude given a persona/expertise to answer from?
 *   context     Is there background material or situational grounding?
 *   specificity Is the ask concrete (lengths, counts, constraints, criteria)?
 *   format      Is the desired output shape stated (bullets, table, JSON…)?
 *   structure   Is a long prompt organized (sections, tags, delimiters)?
 *
 * Design constraints:
 *   - High precision over coverage: a rule that misfires teaches users to
 *     ignore the meter. Rules only fire when the signal is unambiguous.
 *   - Dimension applicability scales with prompt length: a 6-word prompt is
 *     not penalized for lacking XML structure; a 300-word wall of text is.
 *   - O(n) over the draft per evaluation; the caller debounces.
 *
 * Exposes `window.PromptHealth = { score }` for the content script.
 */

(function () {
  "use strict";

  const ROLE_RE =
    /\b(you are|act as|as a[n]?\s+\w+|role of|imagine you(?:'re| are)|pretend (you'?re|to be)|persona)\b/i;
  const CONTEXT_RE =
    /\b(context|background|for context|given that|here('s| is)|below is|the following|attached|i am|i'm working on|my (goal|situation|project|team|company)|we are|currently)\b/i;
  const FORMAT_RE =
    /\b(bullet|list|table|json|markdown|csv|yaml|numbered|paragraph[s]?|outline|format|structure the (answer|output|response)|respond (with|in|as)|output (as|in)|in the form of|step[- ]by[- ]step|concise|one[- ](line|sentence|paragraph)|\d+\s*(words|sentences|bullets|points|examples|options|ideas))\b/i;
  const SPECIFIC_RE =
    /\b(\d+|must|should|exactly|at (least|most)|no more than|between|only|specifically|criteria|constraint|requirement|include|exclude|avoid|focus on|prioriti[sz]e|deadline|audience|tone)\b/i;
  const EXAMPLE_RE = /\b(for example|e\.g\.|example:|such as|like this|here's an example|sample)\b/i;
  const STRUCTURE_RE = /(<\w+>|```|^#+\s|\n\s*[-*]\s|\n\s*\d+[.)]\s|\n\n)/m;

  /**
   * Score a draft. Returns { total: 0..100, dims: [{key, label, ok, applicable, hint}] }.
   * `applicable` implements length-scaled expectations — only applicable
   * dimensions count toward the total, so short prompts aren't punished for
   * omitting machinery they don't need.
   */
  function score(text) {
    const t = (text || "").trim();
    const words = (t.match(/\S+/g) || []).length;

    const dims = [
      {
        key: "role",
        label: "Role",
        applicable: words >= 8,
        ok: ROLE_RE.test(t),
        hint: 'Give Claude a role — "You are a senior data analyst…"',
      },
      {
        key: "context",
        label: "Context",
        applicable: words >= 8,
        ok: CONTEXT_RE.test(t),
        hint: "Add background — what are you working on, and why?",
      },
      {
        key: "specificity",
        label: "Specifics",
        applicable: words >= 5,
        ok: SPECIFIC_RE.test(t) || EXAMPLE_RE.test(t),
        hint: "Make the ask concrete — counts, constraints, or an example.",
      },
      {
        key: "format",
        label: "Format",
        applicable: words >= 5,
        ok: FORMAT_RE.test(t),
        hint: 'Say what shape you want — "as a table", "3 bullets", "JSON".',
      },
      {
        key: "structure",
        label: "Structure",
        // Only long prompts are expected to be organized.
        applicable: words >= 60,
        ok: STRUCTURE_RE.test(t),
        hint: "Break this up — sections, bullet points, or <tags> around pasted material.",
      },
      {
        key: "vocabulary",
        label: "Readable words",
        // Sanity check that makes the meter robust to RANDOM text: judge the
        // draft's tokens against the real lexicon plus the user's OWN learned
        // vocabulary (their domain terms are valid even if rare in English).
        // Garbled or keyboard-mash prompts fail here regardless of how many
        // trigger keywords they happen to contain.
        applicable: words >= 4 && !!window.PromptRepair,
        ok: (() => {
          if (!window.PromptRepair) return true;
          const toks = (t.toLowerCase().match(/[a-z']{2,}/g) || []).filter((w) => w.length >= 3);
          if (toks.length < 3) return true;
          const own = _userVocab || {};
          const known = toks.filter((w) => window.PromptRepair.isKnown(w) || own[w] >= 2).length;
          return known / toks.length >= 0.7;
        })(),
        hint: "Several words look garbled — fix the typos so the model reads you right (Ctrl+. helps).",
      },
    ];

    const applicable = dims.filter((d) => d.applicable);
    const passed = applicable.filter((d) => d.ok);
    const total = applicable.length
      ? Math.round((passed.length / applicable.length) * 100)
      : 0;

    return { total, dims, words };
  }

  // ---- Learned personal calibration ---------------------------------------
  // The static dimensions are a PRIOR — sensible defaults from published
  // guidance. The adaptive layer learns from THIS user's own sent prompts
  // (pc_lab feature history, pc_words vocabulary, pc_lengths) and judges the
  // draft against their empirical distributions — statistics, not vibes:
  //
  //   percentile   empirical CDF of the draft's score within the user's own
  //                sent-prompt scores ("better than 72% of your prompts")
  //   domainMatch  share of the draft's content words that are part of the
  //                user's learned vocabulary — is this prompt in YOUR domain?
  //   lengthZ      z-score of the draft's length vs the user's own lengths
  //
  // All three update themselves automatically: every sent prompt appends to
  // the same stores this reads. No thresholds are invented for the user —
  // the user's history IS the reference distribution.
  let _userVocab = null; // also feeds the vocabulary dimension above

  async function scoreAdaptive(text) {
    const s = score(text);
    try {
      const data = await chrome.storage.local.get(["pc_lab", "pc_words", "pc_lengths"]);
      _userVocab = data.pc_words || {};
      const lab = Array.isArray(data.pc_lab) ? data.pc_lab : [];
      const lengths = Array.isArray(data.pc_lengths) ? data.pc_lengths : [];
      const personal = { n: lab.length };

      if (lab.length >= 5) {
        const healths = lab.map((e) => e.health).filter((h) => typeof h === "number");
        const below = healths.filter((h) => h < s.total).length;
        const equal = healths.filter((h) => h === s.total).length;
        // Mid-rank empirical percentile (ties split), 0..100.
        personal.percentile = Math.round(((below + equal / 2) / healths.length) * 100);
      }

      const toks = (text.toLowerCase().match(/[a-z']{3,}/g) || []);
      if (toks.length >= 3 && Object.keys(_userVocab).length >= 20) {
        const inVocab = toks.filter((w) => _userVocab[w] >= 2).length;
        personal.domainMatch = Math.round((inVocab / toks.length) * 100);
      }

      if (lengths.length >= 5) {
        const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
        const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length) || 1;
        personal.lengthZ = Math.round(((s.words - mean) / sd) * 10) / 10;
        personal.typicalLength = Math.round(mean);
      }

      s.personal = personal;
    } catch (_) {
      /* storage unavailable (isolated harness) — static score stands alone */
    }
    return s;
  }

  window.PromptHealth = { score, scoreAdaptive };
})();
