#!/usr/bin/env python3
"""Build the full claude-cookbooks recipe notebook."""
import json, sys

CELLS = []
def md(s): CELLS.append({"cell_type": "markdown", "metadata": {}, "source": _lines(s)})
def code(s): CELLS.append({"cell_type": "code", "metadata": {}, "execution_count": None,
                           "outputs": [], "source": _lines(s)})
def _lines(s):
    s = s.strip("\n")
    a = s.split("\n")
    return [l + "\n" for l in a[:-1]] + [a[-1]]

# ─────────────────────────────────────────────────────────── intro
md(r"""
# Prompt quality: score it, repair it, and learn the user's style

Most prompt tooling stops at *generation*. This recipe covers the other half of the loop —
**measuring** prompt quality, **repairing** weak prompts, and **learning** how one particular
person writes so you can finish their sentences.

By the end you'll have built, from scratch and end-to-end:

| Part | What you build | Runs on |
|---|---|---|
| 1 | A structured prompt **scorer** (5 best-practice dimensions, tool-use JSON) | Claude |
| 2 | A prompt **repairer** that rewrites weak drafts | Claude |
| 3 | An **eval loop** proving the repair actually helps | Claude |
| 4 | A **personal language model** — n-grams + Kneser–Ney smoothing, trained on the user's own prompts | pure Python, no API |
| 5 | **Confidence-gated decoding** and **beam search** for multi-word completions | pure Python |
| 6 | A **trie** for instant word completion | pure Python |
| 7 | **Personal calibration** — judging a draft against *this user's* own history | pure Python |
| 8 | A combined `PromptAssistant` and an offline evaluation of the learner | both |

The Claude parts give you quality judgement. The local parts give you *personalization* and
sub-millisecond latency with zero data leaving the machine. Together they're a complete
prompt-assistance system.

> Everything in Parts 4–8 is dependency-free Python — no API key needed — so you can run,
> read, and modify the learning machinery directly.
""")

md(r"""
## Setup

Only Part 1–3 and the final demo need an API key (`ANTHROPIC_API_KEY`).
""")

code(r"""
%pip install -q anthropic

import math, random, re
from collections import Counter, defaultdict

from anthropic import Anthropic

client = Anthropic()          # reads ANTHROPIC_API_KEY from the environment
MODEL = "claude-sonnet-4-5"   # use the latest Sonnet available to you
""")

# ─────────────────────────────────────────────────────────── part 1
md(r"""
---
## Part 1 — Score a prompt

We grade a draft on five dimensions taken from Anthropic's prompt-engineering guidance,
each 0–2:

| Dimension | The question it asks |
|---|---|
| **role** | Is Claude given a persona or expertise to answer from? |
| **context** | Is there background or situational grounding? |
| **specificity** | Is the ask concrete — counts, constraints, criteria, examples? |
| **format** | Is the output shape stated — bullets, table, JSON, length? |
| **structure** | For longer prompts, is it organized with sections or delimiters? |

To get a machine-readable result we use **tool use** with `tool_choice` forcing the call.
That gives us a schema-validated object instead of prose we'd have to parse — the single
most useful trick for turning Claude into a component inside a larger system.
""")

code(r"""
SCORE_TOOL = {
    "name": "record_prompt_score",
    "description": "Record a structured quality score for a user's draft prompt.",
    "input_schema": {
        "type": "object",
        "properties": {
            "dimensions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "enum": ["role", "context", "specificity", "format", "structure"],
                        },
                        "score": {
                            "type": "integer",
                            "description": "0 = absent, 1 = partial, 2 = strong",
                        },
                        "reason": {"type": "string", "description": "one concise sentence"},
                    },
                    "required": ["name", "score", "reason"],
                },
            }
        },
        "required": ["dimensions"],
    },
}

SCORE_SYSTEM = (
    "You are a strict but fair prompt-engineering evaluator. Score the user's DRAFT "
    "prompt on five dimensions (role, context, specificity, format, structure), each "
    "0-2: 0 absent, 1 partial, 2 strong. Judge the draft as written, not the topic. "
    "Call record_prompt_score exactly once."
)


def score(draft):
    # Returns {"total": 0-100, "dimensions": {name: {"score", "reason"}}}
    msg = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SCORE_SYSTEM,
        tools=[SCORE_TOOL],
        tool_choice={"type": "tool", "name": "record_prompt_score"},
        messages=[{"role": "user", "content": "<draft>" + draft + "</draft>"}],
    )
    dims = {}
    for block in msg.content:
        if block.type == "tool_use":
            for d in block.input["dimensions"]:
                dims[d["name"]] = {"score": d["score"], "reason": d["reason"]}
    total = round(100 * sum(d["score"] for d in dims.values()) / (2 * len(dims))) if dims else 0
    return {"total": total, "dimensions": dims}
""")

code(r"""
def show_score(label, result):
    print(label + ": " + str(result["total"]) + "/100")
    for name, d in result["dimensions"].items():
        mark = {2: "✓", 1: "~", 0: "✗"}[d["score"]]
        print("  " + mark + " " + name.ljust(12) + str(d["score"]) + "/2  " + d["reason"])


weak = "fix my resume idk make it good"
show_score("Draft", score(weak))
""")

md(r"""
You get a low total *and* a one-line diagnosis per dimension — exactly the feedback a
beginner is missing. Note what the rubric does **not** do: it never rewrites, so scoring
stays cheap and cacheable, and you can show the diagnosis without committing to a rewrite.
""")

# ─────────────────────────────────────────────────────────── part 2
md(r"""
---
## Part 2 — Repair the prompt

One call rewrites the rough draft, preserving the user's intent and topic while adding the
ingredients the score flagged. Unknown specifics become bracketed placeholders rather than
invented facts — an important detail: a rewriter that hallucinates context is worse than
no rewriter.
""")

code(r"""
IMPROVE_SYSTEM = (
    "You are an expert prompt engineer. Rewrite the user's rough DRAFT into a single, "
    "well-structured prompt they could send to Claude to get an excellent result. "
    "Preserve their intent and topic. Add a clear role, any needed context as bracketed "
    "placeholders like [your field], a specific ask, and an explicit output format. "
    "Never invent facts about the user - use placeholders instead. "
    "Return ONLY the rewritten prompt text: no preamble, no explanation, no quotes."
)


def improve(draft):
    msg = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=IMPROVE_SYSTEM,
        messages=[{"role": "user", "content": "<draft>" + draft + "</draft>"}],
    )
    return "".join(b.text for b in msg.content if b.type == "text").strip()


improved = improve(weak)
print(improved)
""")

# ─────────────────────────────────────────────────────────── part 3
md(r"""
---
## Part 3 — Prove the repair actually helps

Diagnose-and-repair is only worth shipping if the repair measurably improves things.
Re-score the rewrite, then run the whole loop over a batch and report the average lift.
One example is an anecdote; a batch is evidence.
""")

code(r"""
before = score(weak)
after = score(improved)

show_score("Before", before)
print()
show_score("After ", after)
print("\nLift: " + format(after["total"] - before["total"], "+d") + " points")
""")

code(r"""
batch = [
    "fix my resume idk make it good",
    "write something about climate change",
    "help me with my code its broken",
    "summarize this for me",
    "give me some marketing ideas",
]

rows = []
for draft in batch:
    b = score(draft)["total"]
    a = score(improve(draft))["total"]
    rows.append((draft, b, a, a - b))

print("draft".ljust(40) + "before".rjust(8) + "after".rjust(8) + "lift".rjust(7))
print("-" * 63)
for draft, b, a, lift in rows:
    print(draft[:38].ljust(40) + str(b).rjust(8) + str(a).rjust(8) + format(lift, "+d").rjust(7))
print("-" * 63)
print("Average lift: " + format(sum(r[3] for r in rows) / len(rows), "+.1f") + " points")
""")

# ─────────────────────────────────────────────────────────── part 4
md(r"""
---
# The learning half

Scoring and repair are *general* — they treat every user identically. But the prompts a
data scientist writes look nothing like a lawyer's. To finish someone's sentence you need a
model of **that person**.

Everything from here runs **locally, with no API calls**:

- it must respond on the keystroke path (sub-millisecond), which a network call can't,
- prompt history is sensitive and never needs to leave the machine,
- and it's a genuinely interesting modelling problem.

We'll build a small language model trained on one user's prompts.
""")

md(r"""
## Part 4 — A text pipeline and an n-gram model

The pipeline is the classic one: **clean → tokenize → stem → chunk → index.**

Stemming is used only for the *history keys*, so `write an email` and `writing an email`
pool their evidence. The predicted words keep their surface form, so completions read
naturally. That's a deliberate trade: light stemming can merge near-neighbours, but for a
per-user model denser evidence wins.
""")

code(r"""
def normalize(text):
    # lowercase, drop punctuation, tokenize
    return re.findall(r"[a-z0-9']+", text.lower())


def stem(w):
    # Tiny suffix stripper with minimum-length guards against overstemming
    # ("using" must not become "us").
    if len(w) >= 5 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) >= 7 and w.endswith("ing"):
        return w[:-3]
    if len(w) >= 6 and w.endswith("ed"):
        return w[:-2]
    if len(w) >= 4 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    if len(w) >= 5 and w.endswith("e"):
        return w[:-1]
    return w


def stems(tokens):
    return [stem(t) for t in tokens]


print(normalize("Analyze the churn dataset, and plot retention!"))
# Inflections collapse to a shared key, so their evidence pools:
print(stems(normalize("writing an email")), "==", stems(normalize("write an emails")))
""")

md(r"""
### The model store

For each prompt we slide 2- and 3-token windows and record *what came next*. The result is a
sparse count table: rows are histories, columns are continuations. We also keep a unigram
vocabulary (for word completion in Part 6) and the **continuation counts** Kneser–Ney needs,
maintained incrementally so queries never rescan the table.
""")

code(r"""
class PromptModel:
    def __init__(self, discount=0.75):
        self.D = discount
        self.ngrams = defaultdict(Counter)     # history tuple -> Counter of next words
        self.cont = defaultdict(set)           # word -> set of bigram histories preceding it
        self.cont_pairs = 0                    # total distinct (history, word) bigram pairs
        self.vocab = Counter()                 # unigram counts, for word completion
        self.lengths = []                      # prompt lengths in words, for calibration

    def learn(self, text):
        # Train on one submitted prompt. This is the whole training path.
        toks = normalize(text)
        if len(toks) < 3:
            return
        self.lengths.append(len(toks))
        for t in toks:
            self.vocab[t] += 1
        st = stems(toks)
        for n in (2, 3):
            for i in range(len(toks) - n):
                hist = tuple(st[i : i + n])       # stemmed history key
                nxt = toks[i + n]                 # surface-form continuation
                self.ngrams[hist][nxt] += 1
                if n == 2 and hist not in self.cont[nxt]:
                    self.cont[nxt].add(hist)      # new distinct context for this word
                    self.cont_pairs += 1

    def __repr__(self):
        return ("PromptModel(histories=" + str(len(self.ngrams)) +
                ", vocab=" + str(len(self.vocab)) +
                ", prompts=" + str(len(self.lengths)) + ")")
""")

md(r"""
### Kneser–Ney smoothing

Raw counts are useless for unseen contexts, so we interpolate with a lower-order estimate.
The Kneser–Ney insight is *what* to back off to: not raw frequency, but **continuation
probability** — how many distinct contexts a word completes.

The classic example: *"Francisco"* is a frequent word, but it almost only follows *"San"*.
It's a terrible back-off guess. Continuation probability captures that.

$$P_{KN}(w \mid h) = \frac{\max(C(h,w) - D,\ 0)}{C(h)} \;+\; \lambda(h)\, P_{KN}(w \mid h')$$

$$\lambda(h) = \frac{D \cdot |\{w : C(h,w) > 0\}|}{C(h)}
\qquad
P_{\text{cont}}(w) = \frac{|\{h : C(h,w) > 0\}|}{\sum_{v} |\{h : C(h,v) > 0\}|}$$

with absolute discount $D = 0.75$ and $h'$ the history with its oldest word dropped.
""")

code(r"""
def p_continuation(model, word):
    if model.cont_pairs == 0:
        return 0.0
    return len(model.cont.get(word, ())) / model.cont_pairs


def p_kn(model, history, word):
    # Interpolated Kneser-Ney, recursing down to the continuation distribution.
    if not history:
        return p_continuation(model, word)
    counts = model.ngrams.get(history)
    if not counts:
        return p_kn(model, history[1:], word)          # back off
    total = sum(counts.values())
    lam = model.D * len(counts) / total                # freed probability mass
    return max(counts[word] - model.D, 0.0) / total + lam * p_kn(model, history[1:], word)


PromptModel.p_continuation = p_continuation
PromptModel.p_kn = p_kn
print("smoothing wired up")
""")

code(r"""
m = PromptModel()
for _ in range(3):
    m.learn("analyze the churn dataset and plot retention by cohort")
m.learn("analyze the churn dataset and segment by acquisition channel")
print(m)

ctx = tuple(stems(normalize("analyze the churn dataset and")))[-3:]
for w in ["plot", "segment", "banana"]:
    print(w.ljust(9), round(m.p_kn(ctx, w), 3))
""")

md(r"""
`plot` beats `segment` because it was seen more often in this exact context, and `banana`
gets a tiny non-zero value through the back-off chain rather than a hard zero — which is the
whole point of smoothing.
""")

# ─────────────────────────────────────────────────────────── part 5
md(r"""
---
## Part 5 — Confidence-gated decoding, then beam search

A wrong suggestion costs more than no suggestion: it interrupts, it has to be read and
rejected, and it erodes trust. So the model is **allowed to stay silent**. Two gates:

- **confidence** — the smoothed probability must clear a threshold (0.45),
- **support** — the winning continuation must have been seen at least twice.

This is precision-over-recall as an explicit design stance.
""")

code(r"""
CONFIDENCE_MIN = 0.45
SUPPORT_MIN = 2


def candidates(model, tokens):
    # Merge candidates from the 3- and 2-token histories; keep the longest
    # history that exists as the scoring context.
    st = stems(tokens)
    best_hist, counts = (), {}
    for n in (3, 2):
        if len(st) >= n:
            h = tuple(st[-n:])
            c = model.ngrams.get(h)
            if c:
                if not best_hist:
                    best_hist = h
                for w, k in c.items():
                    counts[w] = max(counts.get(w, 0), k)
    return best_hist, counts


def predict_next(model, context, min_p=CONFIDENCE_MIN, min_count=SUPPORT_MIN):
    toks = normalize(context) if isinstance(context, str) else list(context)
    hist, counts = candidates(model, toks)
    if not counts:
        return None
    scored = [(w, model.p_kn(hist, w), c) for w, c in counts.items()]
    scored.sort(key=lambda x: -x[1])
    w, p, c = scored[0]
    if p < min_p or c < min_count:
        return None                     # not confident enough: stay silent
    return {"word": w, "p": round(p, 3), "count": c}


print("learned  ->", predict_next(m, "analyze the churn dataset and"))
print("unseen   ->", predict_next(m, "please translate the quarterly"))
""")

code(r"""
# Split evidence must also produce silence: four continuations of the same
# history give max P around 0.25, well under the gate.
split = PromptModel()
for tail in ["pandas", "numpy", "scipy", "sklearn"]:
    split.learn("please analyze the data using " + tail + " today")
print("split evidence ->", predict_next(split, "please analyze the data using"))
""")

md(r"""
### Beam search

Greedy decoding takes the best word at each step and stops at the first uncertain one — even
when every branch reconverges immediately afterwards. Beam search keeps several partial
paths alive and judges them by **joint** probability.

The gating that makes it safe:

- the **first** word must clear the strict entry gate (a wrong opening invalidates everything after it),
- later words may explore at a lower floor,
- a path is only emitted if its **geometric-mean** probability clears the strict gate,
- **every prefix a beam passes through stays an emission candidate**, so a confident one-word
  suggestion is never lost just because its own extension was weak.

That last rule matters more than it looks: without it, beam search can be *worse* than greedy.
""")

code(r"""
BEAM_WIDTH = 3
STEP_MIN = 0.25
MAX_WORDS = 6


def top_next(model, tokens, k):
    hist, counts = candidates(model, tokens)
    if not counts:
        return []
    scored = [(w, model.p_kn(hist, w), c) for w, c in counts.items()]
    scored.sort(key=lambda x: -x[1])
    return scored[:k]


def complete_phrase(model, context):
    toks = normalize(context) if isinstance(context, str) else list(context)
    entry = [(w, p, c) for (w, p, c) in top_next(model, toks, BEAM_WIDTH)
             if p >= CONFIDENCE_MIN and c >= SUPPORT_MIN]
    if not entry:
        return None

    # A beam is (words, token-context, cumulative log-probability).
    active = [([w], toks + [w], math.log(p)) for (w, p, c) in entry]
    emitted = list(active)                      # every prefix stays a candidate

    for _ in range(MAX_WORDS - 1):
        nxt = []
        for words, ctx, logp in active:
            for (w, p, c) in top_next(model, ctx, BEAM_WIDTH):
                if p >= STEP_MIN and c >= SUPPORT_MIN:
                    nxt.append((words + [w], ctx + [w], logp + math.log(p)))
        if not nxt:
            break
        nxt.sort(key=lambda b: -b[2])
        active = nxt[:BEAM_WIDTH]               # only growing paths compete
        emitted.extend(active)

    best = None
    for words, _ctx, logp in emitted:
        geo = math.exp(logp / len(words))       # per-word confidence
        if geo < CONFIDENCE_MIN:
            continue
        if best is None or len(words) > len(best[0]) or (
            len(words) == len(best[0]) and logp > best[1]
        ):
            best = (words, logp)
    return " ".join(best[0]) if best else None


print(repr(complete_phrase(m, "analyze the churn dataset and")))
""")

code(r"""
# Beam search survives a mid-phrase split that stops greedy decoding: step two
# forks three ways (each under the strict gate) but every branch reconverges.
b = PromptModel()
for _ in range(2):
    b.learn("check the deploy logs for errors today please")
for _ in range(2):
    b.learn("check the deploy status for errors today please")
b.learn("check the deploy config for errors today please")

print("greedy first word :", predict_next(b, "check the"))
print("beam phrase       :", repr(complete_phrase(b, "check the")))
""")

# ─────────────────────────────────────────────────────────── part 6
md(r"""
---
## Part 6 — Word completion with a trie

The n-gram model predicts the *next* word. To finish the word being typed (`anal` →
`analyze`) you need prefix search over the vocabulary.

A linear scan is O(V) per keystroke. A **trie** whose every node caches the best-scoring word
in its subtree answers in O(len(prefix)) — a walk plus one lookup, regardless of vocabulary
size. Since we insert in descending count order, the cache fills correctly for free.
""")

code(r"""
class VocabTrie:
    def __init__(self, counts):
        self.root = {"best": None, "kids": {}}
        # Insert most-frequent first so each node's cached best is correct.
        for word, count in sorted(counts.items(), key=lambda kv: -kv[1]):
            node = self.root
            self._bump(node, word, count)
            for ch in word:
                node = node["kids"].setdefault(ch, {"best": None, "kids": {}})
                self._bump(node, word, count)

    @staticmethod
    def _bump(node, word, count):
        if node["best"] is None or count > node["best"][0]:
            node["best"] = (count, word)

    def complete(self, prefix, min_count=2):
        node = self.root
        for ch in prefix:
            node = node["kids"].get(ch)
            if node is None:
                return None
        best = node["best"]
        if not best or best[0] < min_count or len(best[1]) <= len(prefix):
            return None
        return best[1]


trie = VocabTrie(m.vocab)
for p in ["anal", "chu", "coh", "zz"]:
    print(p.ljust(6), "->", trie.complete(p))
""")

md(r"""
Because the trie is built from *the user's own vocabulary*, the completions are theirs. A
data scientist typing `coh` gets `cohort`; someone else gets whatever they actually write.
That's personalization falling out of the data structure, with no extra machinery.
""")

# ─────────────────────────────────────────────────────────── part 7
md(r"""
---
## Part 7 — Personal calibration

A fixed rubric says "this prompt scores 55/100." Useful, but impersonal. Once you have a
user's history you can say something far more meaningful: **"this is better than 72% of the
prompts you've written."**

Three statistics, all computed from the user's own data and all self-updating:

- **percentile** — the mid-rank empirical CDF of this score within their history,
- **domain match** — the share of content words already in their learned vocabulary,
- **length z-score** — how unusual the length is *for them*.

No invented thresholds: the user's history *is* the reference distribution.
""")

code(r"""
class PersonalCalibration:
    def __init__(self, model):
        self.model = model
        self.scores = []            # past prompt scores

    def record(self, total):
        self.scores.append(total)

    def calibrate(self, total, text):
        out = {"n": len(self.scores)}

        if len(self.scores) >= 5:
            below = sum(1 for s in self.scores if s < total)
            equal = sum(1 for s in self.scores if s == total)
            out["percentile"] = round(100 * (below + equal / 2) / len(self.scores))

        toks = [t for t in normalize(text) if len(t) >= 3]
        if toks and len(self.model.vocab) >= 20:
            known = sum(1 for t in toks if self.model.vocab.get(t, 0) >= 2)
            out["domain_match"] = round(100 * known / len(toks))

        lens = self.model.lengths
        if len(lens) >= 5:
            mean = sum(lens) / len(lens)
            var = sum((x - mean) ** 2 for x in lens) / len(lens)
            sd = math.sqrt(var) or 1.0
            out["length_z"] = round((len(normalize(text)) - mean) / sd, 1)
            out["typical_length"] = round(mean)
        return out
""")

code(r"""
# A user with a real history: mostly short data-science prompts.
user = PromptModel()
history = [
    "analyze the churn dataset and plot retention by cohort",
    "analyze the revenue dataset and forecast next quarter by region",
    "explain gradient descent with a small worked example",
    "summarize this paper in three bullets for my notes",
    "write python to load the csv and show the correlation matrix",
    "compare logistic regression and random forests for this task",
]
for h in history:
    user.learn(h)

cal = PersonalCalibration(user)
for s in [35, 45, 55, 60, 70, 80]:
    cal.record(s)

draft = "analyze the churn dataset and plot the monthly revenue trend by cohort"
print(cal.calibrate(65, draft))
print(cal.calibrate(65, "please draft a lease agreement clause about indemnity"))
""")

md(r"""
The second call shows the value of `domain_match`: an out-of-domain draft scores the same on
the rubric but is flagged as unlike anything this user writes — a signal you can use to
suppress personalized suggestions rather than offer bad ones.
""")

# ─────────────────────────────────────────────────────────── part 8
md(r"""
---
## Part 8 — Putting it together

`PromptAssistant` wires the pieces into the shape a real product needs: local predictions on
the fast path, Claude for the heavyweight judgement, and learning on submit.
""")

code(r"""
class PromptAssistant:
    def __init__(self):
        self.model = PromptModel()
        self.cal = PersonalCalibration(self.model)
        self._trie = None

    # ---- local, instant (no API) ----
    def complete_word(self, prefix):
        if self._trie is None:
            self._trie = VocabTrie(self.model.vocab)
        return self._trie.complete(prefix)

    def complete_phrase(self, context):
        return complete_phrase(self.model, context)

    def ghost(self, text):
        # What a ghost-text UI would show for the current draft.
        if text and not text.endswith(" "):
            head, _, partial = text.rpartition(" ")
            done = self.complete_word(partial)
            if done:
                return done[len(partial):]
            return None
        return self.complete_phrase(text)

    # ---- learning (on submit) ----
    def submit(self, text, total=None):
        self.model.learn(text)
        self._trie = None                    # vocabulary changed; rebuild lazily
        if total is not None:
            self.cal.record(total)

    # ---- Claude-powered (deliberate action) ----
    def review(self, text):
        s = score(text)
        s["personal"] = self.cal.calibrate(s["total"], text)
        return s

    def rewrite(self, text):
        return improve(text)
""")

code(r"""
# A short session, entirely local: the assistant starts knowing nothing.
a = PromptAssistant()
print("cold start  ->", repr(a.ghost("analyze the churn ")))

for _ in range(3):
    a.submit("analyze the churn dataset and plot retention by cohort")

print("after 3 sends:")
print("  phrase    ->", repr(a.ghost("analyze the churn ")))
print("  word      ->", repr(a.ghost("analyze the chu")))
print("  unrelated ->", repr(a.ghost("please translate the quarterly ")))
""")

# ─────────────────────────────────────────────────────────── part 9
md(r"""
---
## Part 9 — Evaluating the learner

The Claude half was evaluated in Part 3. The local half needs its own metric, and the honest
one for a gated predictor is a **precision/coverage** pair:

- **coverage** — at what fraction of positions does it speak at all?
- **precision** — when it speaks, how often is it right?

A model that answers everywhere with 20% precision is useless. Ours deliberately answers
rarely and accurately. We evaluate on a held-out split — never on the training prompts.
""")

code(r"""
# A realistic personal corpus: people REUSE phrasings, which is exactly what
# makes autocomplete possible. Each family below is a habit repeated with
# variation, so held-out prompts share histories with training ones.
corpus = [
    "analyze the churn dataset and plot retention by cohort",
    "analyze the churn dataset and plot retention by month",
    "analyze the churn dataset and plot retention by segment",
    "analyze the churn dataset and plot retention by week",
    "summarize this paper in three bullets for my study notes",
    "summarize this paper in three bullets for my reading list",
    "summarize this paper in three bullets for the team",
    "summarize this paper in three bullets for tomorrow",
    "explain gradient descent with a small worked example please",
    "explain backpropagation with a small worked example please",
    "explain regularization with a small worked example please",
    "explain cross validation with a small worked example please",
    "write python to load the csv and clean missing values",
    "write python to load the csv and clean duplicate rows",
    "write python to load the csv and clean the column names",
    "write python to load the csv and clean the date fields",
]

rng = random.Random(7)
shuffled = corpus[:]
rng.shuffle(shuffled)
cut = int(0.75 * len(shuffled))
train, test = shuffled[:cut], shuffled[cut:]

eval_model = PromptModel()
for p in train:
    eval_model.learn(p)

positions = spoke = correct = 0
for prompt in test:
    toks = normalize(prompt)
    for i in range(2, len(toks)):
        positions += 1
        pred = predict_next(eval_model, toks[:i])
        if pred:
            spoke += 1
            if pred["word"] == toks[i]:
                correct += 1

print("train / test prompts : " + str(len(train)) + " / " + str(len(test)))
print("positions evaluated  : " + str(positions))
print("coverage (spoke)     : " + format(100 * spoke / max(positions, 1), ".1f") + "%")
print("precision (when it spoke): " +
      (format(100 * correct / spoke, ".1f") + "%" if spoke else "n/a"))
""")

md(r"""
Coverage is well under 100% — and that's the design working, not a failure. The model speaks
only where this user's habits make the next word genuinely predictable, and it's right the
large majority of those times. That's the trade you want: a quiet, trustworthy assistant
beats a chatty, wrong one.

Try moving `CONFIDENCE_MIN` and re-running to trace the precision/coverage curve — lower it
and the model talks more and is wrong more. Pick the point your UI can afford:
""")

code(r"""
def sweep(threshold):
    pos = spoke = ok = 0
    for prompt in test:
        toks = normalize(prompt)
        for i in range(2, len(toks)):
            pos += 1
            pred = predict_next(eval_model, toks[:i], min_p=threshold)
            if pred:
                spoke += 1
                ok += pred["word"] == toks[i]
    cov = 100 * spoke / max(pos, 1)
    prec = 100 * ok / spoke if spoke else float("nan")
    return cov, prec


print("threshold   coverage   precision")
print("-" * 34)
for t in [0.15, 0.25, 0.35, 0.45, 0.60, 0.75]:
    cov, prec = sweep(t)
    prec_s = "n/a" if prec != prec else format(prec, ".0f") + "%"
    print(format(t, ".2f").rjust(9) + format(cov, ".0f").rjust(10) + "%" + prec_s.rjust(11))
""")

# ─────────────────────────────────────────────────────────── part 10
md(r"""
---
## Part 10 — Production notes

**Prompt caching.** The scorer's system prompt is fixed across every call, so it's a natural
caching target. Caching only applies above a minimum prompt length (about 1024 tokens for
Sonnet), so it pays off once you've enriched the system prompt with a detailed rubric and
few-shot examples — which is exactly when you'd want it.

```python
system = [{
    "type": "text",
    "text": LONG_RUBRIC_SYSTEM,
    "cache_control": {"type": "ephemeral"},
}]
```

**Streaming the rewrite.** A rewrite takes a moment; stream it so the user sees progress:

```python
with client.messages.stream(
    model=MODEL, max_tokens=1024, system=IMPROVE_SYSTEM,
    messages=[{"role": "user", "content": draft}],
) as stream:
    for chunk in stream.text_stream:
        print(chunk, end="", flush=True)
```

**Where each layer belongs.**

| Layer | Latency | Runs |
|---|---|---|
| Word / phrase completion | microseconds | every keystroke, locally |
| Personal calibration | microseconds | on a debounce, locally |
| Score | one API call | on a pause, or on demand |
| Rewrite | one API call | only when the user asks |

Never put a network call on the keystroke path. The local model exists to make the fast path
fast; Claude exists to make the slow path smart.
""")

md(r"""
---
## Recap

You built a complete prompt-assistance system:

1. **Score** — tool-use structured output turns Claude into a reliable rubric grader.
2. **Repair** — a constrained rewriter that adds structure without inventing facts.
3. **Evaluate** — batch measurement proving the repair lifts quality.
4. **Learn** — an n-gram model with Kneser–Ney smoothing trained on one user's prompts.
5. **Decode** — confidence gating and beam search, tuned so silence beats a wrong guess.
6. **Complete** — a trie for O(prefix) word completion from the user's own vocabulary.
7. **Calibrate** — empirical statistics that judge a draft against the user's own history.
8. **Measure** — a precision/coverage evaluation of the learner on held-out data.

### Ideas to take further
- Swap the tiny stemmer for a real one and measure the effect on coverage.
- Add a **Damerau–Levenshtein BK-tree** to repair typos before prediction.
- Persist the model per user and add bounded eviction so it doesn't grow forever.
- Use Claude to *bootstrap* a new user's model: ask for 20 prompts in their domain and train
  on those, so day one already feels personal.

Prompt quality is the cheapest lever on output quality — a better prompt means fewer wasted
round-trips and a better answer the first time.
""")

nb = {
    "cells": CELLS,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}
out = sys.argv[1]
with open(out, "w") as f:
    json.dump(nb, f, indent=1)
print("wrote " + out + " - " + str(len(CELLS)) + " cells")
