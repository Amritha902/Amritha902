# PromptComplete — Strategy: The Problems Anthropic Already Feels

> Companion to [`PITCH.md`](PITCH.md). The pitch says what we offer; this doc says
> why the timing is right — each use case below targets a pain point Anthropic is
> visibly paying to solve today.

**One-line positioning:** PromptComplete puts Anthropic's own prompting best
practices — and each org's best prompts — into the composer as ghost text, fixing
the first prompt (activation), the median prompt (perceived quality), and the
thousandth seat (enterprise), with an acceptance-rate loop that proves it.

---

## The pain points (and the evidence Anthropic feels them)

| # | Pain | Evidence it's real |
|---|------|--------------------|
| 1 | **Empty box / cold start** — new users don't know what to type; first prompts fail; users churn before seeing frontier capability | Claude.ai ships suggestion chips and example prompts on its empty state; Anthropic publishes a public Prompt Library. Companies don't build those unless first-prompt failure hurts activation. |
| 2 | **Shallow capability discovery** — Artifacts, analysis, vision, long-context ship faster than users find them | Anthropic's Economic Index shows usage concentrated in a few task categories. Chat UIs have no surface to advertise verbs. |
| 3 | **Prompt quality variance** — weak prompts → weak outputs → users blame the *model* | Anthropic built a prompt improver into the Console and maintains docs + Academy courses on prompting. That's a company paying to fix its users' prompts after the fact. |
| 4 | **Consumer habit gap vs ChatGPT** — near-zero switching costs in a text box | Winner is whoever owns the daily habit; Anthropic can't out-spend on marketing, so stickiness must come from product. |
| 5 | **Serving cost of failed generations** — a bad prompt costs 2–3 generations (output tokens at 5× input price) to reach one outcome | Public rate-limit tightening through 2025 shows compute scarcity is felt. |
| 6 | **Enterprise seat activation** — deals renew on *activation*, not seat count; prompt training doesn't scale | The gap between "we deployed Claude" and "our people are productive on Claude" is the #1 expansion blocker; nobody owns the last inch — the composer. |
| 7 | **Education delivery problem** — prompting docs reach the motivated ~5%, once, outside the product | The docs/Academy apparatus exists *because* default prompting is poor; ghost text is the same curriculum delivered at 100% reach at the moment of typing. |

## The use cases, mapped

1. **First-mile lead-ins** (→ Pain 1). On a fresh conversation, the first 2–3 typed
   words complete into a full, proven prompt. Curated prompts *are* the cold-start
   model — a new user has no history yet. Inline-at-the-caret beats static chips
   because it arrives mid-composition, when intent already exists.
2. **Capability-routing completions** (→ Pain 2). Verb-keyed completions steer intent
   toward features users don't know exist: "compare…" → *table with pros and cons*;
   "make a…" → *simple interactive page*; "analyze this data…" → *run the numbers and
   chart the trend*. Every accepted completion is first exposure to a capability —
   the retention event Anthropic wants most.
3. **Best-practice injection** (→ Pains 3, 7). The template library's editorial policy:
   every completion silently appends the ingredient Anthropic's docs say naive prompts
   lack — output format, role, audience, reasoning request. Users never read a doc;
   they just press Tab. Raises the prompt-quality *floor*, which raises perceived
   model quality — the variable Claude loses on in blind comparisons despite winning
   benchmarks.
4. **Personalization moat** (→ Pain 4). The on-device model replays *your* continuations;
   by week two the composer finishes your sentences. An accumulating, non-portable
   asset attached to Claude — manufactured switching cost in a category that has none.
5. **One-shot-resolution curation** (→ Pain 5). Every template front-loads the
   specification that would otherwise surface as turn 2's correction. One generation
   instead of three. AI-mode runs on Haiku — the cheap/fast tier — by design.
6. **Team template packs** (→ Pain 6). Admin exports a JSON pack ("our triage prompt",
   "our PRD skeleton", "our code-review rubric"); colleagues import it — or IT ships it
   via managed-browser policy, no server needed. One person's good prompt becomes
   everyone's default; per-template acceptance rates become the seat-activation
   evidence an admin shows at renewal.
7. **Acceptance-rate research signal** (supporting). Which phrasings get accepted vs
   dismissed is the dataset Anthropic's docs and prompt-library curators are guessing
   at today. Even small-scale, it's a real eval loop on prompting guidance.

## Priority (pain acuteness × extension credibility)

1. Best-practice injection — the deepest fit for curated leading prompts.
2. First-mile lead-ins — activation, the extension's native behavior.
3. Team template packs — highest revenue stake; buildable today with JSON import.
4. Capability-routing — zero-UI discovery channel.
5. Personalization moat — most strategic pain, hardest for an extension; still real.
