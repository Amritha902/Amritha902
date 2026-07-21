# PromptComplete — Architecture & Data Science Pipeline

This document is the conceptual draft of the system: the end-to-end data
pipeline, the model, the retrieval tiers, the evaluation loop, and the latency
budget that constrains every design choice. It doubles as a map from each
component to the foundational data-science concepts it applies.

---

## 1. The problem, framed as data science

Autocomplete is a **prediction problem under a hard latency constraint**:

> Given the text a user has typed so far, predict the continuation they were
> about to type — in well under one animation frame, on-device, with
> precision prioritized over recall (a wrong ghost costs user trust; a silent
> one costs nothing).

The system is designed as a classic **data analytics lifecycle** that loops
continuously:

```
     ┌──────────────────────────────────────────────────────────────┐
     │                     DATA ANALYTICS LIFECYCLE                 │
     │                                                              │
     │  Discovery ──► Preparation ──► Model ──► Deploy ──► Results  │
     │  (user's       (text-analytics (n-gram   (ghost    (Insights │
     │   prompts)      pipeline)       LM + IR)  text)     dashboard)│
     │        ▲                                              │      │
     │        └────────────── feedback: accept / dismiss ◄───┘      │
     └──────────────────────────────────────────────────────────────┘
```

Every accepted or dismissed suggestion feeds back into the dataset, closing
the loop — the system evaluates and improves itself with zero servers.

---

## 2. The learning pipeline (training path)

Runs once per submitted prompt — **off** the keystroke hot path, so it has no
latency budget pressure. Implemented in `src/suggest.js` as pure, individually
testable stage functions:

```
 ingest ──► clean/parse ──► stem ──► chunk ──► index
 (submitted  (lowercase,    (suffix-  (sliding   (fold counts into
  prompt)     tokenize)      strip)    n-gram     the document store)
                                       windows)
```

| Stage | What it does | DS concept |
|---|---|---|
| **Ingest** | Capture the prompt at send time (Enter) | Data collection |
| **Clean/parse** | Lowercase, strip punctuation, tokenize | Text cleaning & parsing |
| **Stem** | Suffix-stripping with minimum-stem guards (`writing`→`writ`, but `using` stays `using` — the classic overstemming trap) | Stemming (text analytics) |
| **Chunk** | Slide 2- and 3-token windows over the stream; pair each history chunk with its next token → `{h, next}` training records | Data chunking / feature extraction |
| **Index** | Fold records into a count table `C(w \| h)` | Aggregation; indexing |

**Design decision — stems for keys, surface forms for values.** History keys
are stemmed so inflections pool evidence (`write an email` and `writing an
email` train the same history). Continuations keep their surface form so the
ghost text always reads naturally. Documented tradeoff: light evidence
pooling can merge near-neighbors; for a per-user model, denser evidence wins.

**Storage as a document database.** The model lives in `chrome.storage.local`
— a schemaless key-value document store. The count table is a *sparse matrix*
in dictionary-of-keys form: rows = histories, columns = continuations, cells =
counts. Sparse representation matters: the dense matrix would be |V|² cells;
the DOK form stores only observed transitions, bounded at 4,000 histories with
FIFO eviction.

---

## 3. The inference pipeline (prediction path)

Runs on the keystroke hot path (after a 220 ms debounce). Three tiers, tried
in order; first confident answer wins:

```
 keystroke ─ debounce 220ms ─► Tier 1: personal n-gram LM
                                   │ (miss)
                                   ▼
                               Tier 2: curated templates — regex fast path
                                   │ (miss)
                                   ▼
                               Tier 3: curated templates — vector-space IR
                                   │ (miss)
                                   ▼
                               (AI tier, opt-in: Claude Haiku via BYO key)
                                   │ (miss)
                                   ▼
                                silence
```

### Tier 1 — Personal language model

An interpolated back-off n-gram model (Jelinek–Mercer linear interpolation):

```
P(w | h) = λ₃ · P̂₃(w | h₃) + λ₂ · P̂₂(w | h₂)        λ₃=0.7, λ₂=0.3
```

where `P̂ₙ` is the maximum-likelihood estimate at order *n*. Trigram evidence
dominates when present; the bigram floor keeps predictions alive on sparse
histories. Decoding is greedy, one word at a time, gated twice:

- **Confidence gate:** interpolated `P(w|h) ≥ 0.45`, else stop emitting.
- **Support gate:** the winning continuation must have been seen ≥ 2 times.

The gates encode the product's core statistical stance: **precision over
recall**. Four different continuations of the same history → max P ≈ 0.25 →
the model stays silent rather than guess. (This exact case is a unit test.)

### Tier 2 — Curated templates, regex fast path

~18 hand-curated lead-in completions keyed by anchored regexes
(`^write (a|an) email\b` → " to {recipient} about {topic}…"). O(|T|) scan,
microseconds. This tier is the **cold-start model**: a brand-new user has no
history, so curated prompts carry the first week.

### Tier 3 — Curated templates, vector space model (IR)

When the regex misses on a paraphrase ("please write an email", "can u fix
this bug"), fall back to the classic IR **vector space model**: query and
templates as term-frequency vectors over stop-word-filtered stems, ranked by
**cosine similarity**:

```
sim(q, t) = (q · t) / (‖q‖ ‖t‖)          threshold 0.6
```

With ~18 templates × 2–3-term vectors this is an O(|T|·|q|) scan — no inverted
index needed at this scale (and the doc says so, so nobody adds one).

**Window gating:** both template tiers only fire within the first 8 tokens.
Lead-in scaffolds appended to a developed prompt would be wrong — a bug the
gating fixed and a unit test now pins.

### Sanitization (all tiers)

Every candidate passes through overlap-stripping (never suggest what's
already typed), length capping, and word-boundary spacing before rendering.

---

## 4. Evaluation: the built-in eval loop

The canonical offline metric for autocomplete is **acceptance rate**:

```
acceptance = accepted / shown
```

The extension instruments itself:

| Signal | When | Storage |
|---|---|---|
| `shown` | a new ghost is rendered | lifetime totals + **daily buckets** (30-day retention) |
| `accepted` | user presses Tab | same |
| `dismissed` | user presses Esc | same |
| prompt length | each submitted prompt | bounded sample, n = 200 |

The **Insights dashboard** (an exercise in dashboard design: KPI row → trend →
breakdown → detail) renders:

- KPI cards: acceptance rate, shown, accepted, model size.
- **Time series:** daily acceptance rate as an SVG line chart — the model
  visibly getting better at predicting its user. Days without impressions
  render as gaps, not zeros (a deliberate EDA-honesty choice).
- **Descriptive statistics:** mean / median / min / max prompt length over
  the bounded sample.
- Top learned lead-ins: the highest-confidence rows of the count table.
- **Dataset export:** one click dumps the entire local dataset as JSON for
  notebook-grade EDA (the schema is previewed in-page).

## 5. Latency budget

The hard constraint shaping every choice above. Per keystroke:

| Step | Cost | Notes |
|---|---|---|
| Debounce | 220 ms (idle wait) | Absorbs typing bursts; no work while typing fast |
| Clean/parse | O(n) chars, ~0.01 ms | Single regex pass |
| Stem | O(1) per token | Suffix rules only; no lookup table |
| Tier 1 predict | O(k) per emitted word | k = distinct continuations of the history; typically < 10 |
| Tier 2 regex | O(\|T\|) ≈ 18 tests | Anchored regexes fail fast |
| Tier 3 cosine | O(\|T\|·\|q\|) | Microseconds at this scale |
| Render | one absolutely-positioned span | No layout thrash; caret rect measured once |
| **Total (local tiers)** | **≪ 1 ms** | Effectively instant after the debounce |

Training (the learning pipeline) is O(n) per prompt and runs at send time,
never on the keystroke path. The opt-in AI tier is the only network hop and is
debounced, aborted on further typing, session-cached, and served by
`claude-haiku-4-5` — the fastest Claude tier — by design.

## 6. Concept coverage map

For examiners and reviewers: where each foundational concept lives in code.

| Concept | Where |
|---|---|
| Data science process / analytics lifecycle | §1 loop; the whole system |
| Data munging, filtering, aggregation | `normalize`, stop-word filtering, `index` (suggest.js) |
| Document / NoSQL storage; sparse matrix | n-gram DOK table in `chrome.storage.local` |
| Text analytics pipeline (clean → parse → stem) | `normalize`, `stem`, `chunk` (suggest.js) |
| Information retrieval / vector space model | `tfVector`, `cosine`, `vectorTemplateSuggestion` |
| Language modeling / smoothing (Jelinek–Mercer) | `predictNext` (suggest.js) |
| Time-series dataset | daily buckets (`pc_stats_daily`) + trend chart |
| EDA & descriptive statistics | dashboard length stats, breakdown bar |
| Dashboard design principles | dashboard layout: KPI → trend → breakdown → detail |
| Evaluation metrics (acceptance rate) | `bumpStat` (content.js), KPI cards |
| Latency/complexity analysis | §5 budget table; per-stage O(·) notes in code |
