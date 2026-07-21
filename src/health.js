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
    ];

    const applicable = dims.filter((d) => d.applicable);
    const passed = applicable.filter((d) => d.ok);
    const total = applicable.length
      ? Math.round((passed.length / applicable.length) * 100)
      : 0;

    return { total, dims, words };
  }

  window.PromptHealth = { score };
})();
