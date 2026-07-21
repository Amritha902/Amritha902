# PromptComplete — Product & Business Proposal

> A proposal authored and owned by **Amritha**. Shared with Anthropic as an
> invitation to collaborate. Nothing here implies an existing partnership or
> endorsement — it's a pitch, and an open hand.

---

## 1. The problem

Every AI product has invested heavily in making the *model* faster and smarter.
Almost no one has invested in making the **prompt itself** faster to write. The
prompt box — the single most-used input in the entire product — is a plain text
field. Users stare at a blinking cursor, retype the same lead-ins ("summarize
the following…", "write a professional email to…") dozens of times a week, and
abandon prompts they can't phrase.

Meanwhile, the pattern that fixes this is *already proven everywhere else*:

- **Gmail Smart Compose** — inline ghost text for email.
- **GitHub Copilot** — inline ghost text for code.
- **Search autocomplete** — the most-used prediction UI on earth.

The AI prompt box is the obvious next surface for this pattern. It doesn't have it yet.

## 2. The product

**PromptComplete** is a browser extension that upgrades the AI prompt box into
an **IDE for prompts**, Claude-first — the surface where prompt-engineering
best practices are *taught, applied, and measured* at the exact moment a
person writes to Claude:

- **Ghost-text autocomplete** — as you type, a greyed continuation appears at
  your cursor; `Tab` accepts, `Ctrl/Cmd+→` takes one word, `Alt+]` cycles
  alternatives. AI-mode completions stream token-by-token from Haiku.
- **Prompt Health ring** — a live, on-device score of the draft against five
  best-practice dimensions, with the missing ingredient named. Length-scaled,
  so a short ask is never pushed toward over-engineering.
- **Intent Compiler** — one click rewrites a rough draft into a structured,
  best-practice prompt (proportionality rules built in).
- **`/` scaffold palette** — 16 curated patterns demonstrating roles, XML
  structure, multishot examples, chain-of-thought, and output formats, with
  Tab-navigable placeholders.
- **Prompt Lab** — every sent prompt logged locally like an ML experiment;
  the dashboard shows your acceptance-rate trend and the technique you most
  often skip.

Two suggestion sources, one seamless UX:

| Source | Latency | Privacy | Cost | What powers it |
|---|---|---|---|---|
| **Local** (default) | Instant | 100% on-device | Free | A personal n-gram model that learns from your own prompts + a curated prompt-pattern library |
| **AI** (opt-in) | ~1 network hop | Direct to Anthropic | User's own key | `claude-haiku-4-5` — fastest, cheapest Claude model, ideal for real-time autocomplete |

The local tier means the product is instantly useful, private, and free — the
right on-ramp. The AI tier is where it becomes magical, and where it pulls
usage *toward* Claude.

## 3. The data-science core (why this is more than a UI trick)

This is not a hardcoded snippet list. The engine is a small **on-device
personalization model**:

- Every prompt you send is decomposed into 2- and 3-word windows and indexed as
  `lead-in → most likely continuation`, weighted by frequency.
- Typing a familiar lead-in replays *your* highest-confidence continuation —
  the model is curated per user, from their own history, with zero server.
- The extension measures its own **acceptance rate** (accepted ÷ shown) — the
  canonical offline metric for any autocomplete system — plus dismissal and
  ignore rates, and surfaces them on a local **Insights dashboard** with a
  one-click JSON dataset export for notebook analysis.

That closed loop — *predict → show → measure acceptance → learn* — is a
legitimate applied-ML system, and it's the foundation the business scales on.

## 4. Business offering & tiers

PromptComplete is owned by Amritha and structured as a freemium product:

| Tier | Who | What they get | Model |
|---|---|---|---|
| **Personal** | Individuals | Local model, ghost-text UX, personal Insights dashboard | Free |
| **Pro** | Power users | AI-mode with managed key or BYO-key, cross-device sync of the personal model | Subscription |
| **Team / Enterprise** | Orgs | Shared, curated prompt libraries; org-wide suggestion tuning; **anonymized acceptance analytics served from a data API**; admin controls | Seat-based |

The Team tier is where the "just show them the data" endpoints live: the same
schema previewed on the local dashboard (`metrics`, `top_phrases`) becomes a
proper analytics endpoint a data team consumes — acceptance rate by team, most
valuable curated prompts, prompt-length reduction, time-to-first-token saved.

## 5. Why this is good for Anthropic specifically

- **Lower friction = more usage.** Faster prompting increases the number of
  prompts a user is willing to start. More prompts sent to Claude.
- **A natural pull toward Haiku.** AI-mode autocomplete is a high-volume,
  latency-sensitive workload — a textbook Haiku use case that showcases the
  cheap/fast tier.
- **A data flywheel on prompt quality.** Aggregated (opt-in, anonymized)
  acceptance signals are a rich dataset on what makes prompts effective —
  directly useful for prompting guidance and model tuning.
- **A distribution surface Anthropic doesn't have to build.** A browser
  extension meets users where they already type.

## 6. Proof-of-concept status

This repository is a **working extension**, not a mockup:

- Renders inline ghost text at the caret in Claude's composer (contenteditable
  and textarea).
- Learns from real prompts and predicts continuations on-device.
- Calls the Claude API in AI mode with the user's own key.
- Ships a live Insights dashboard with dataset export.

## 7. The ask — collaboration

I'm bringing this proposal to Anthropic as the owner, with an open invitation to
**collaborate** — whatever shape fits best:

1. **Guidance / feedback** on the direction and the Haiku-backed AI mode.
2. **A design partnership** to refine the enterprise analytics offering.
3. **Distribution / integration** support to reach Claude users.
4. Anything in between.

I built this because I use Claude every day and wanted the prompt box to keep up
with the model behind it. I'd love to build the rest of it with you.

---

**Amritha** · Data Science student & builder · Owner of PromptComplete
