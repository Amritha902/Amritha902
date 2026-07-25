# Proposed recipe for anthropics/claude-cookbooks

**`prompt_quality_scoring.ipynb`** — *Prompt quality: score it, repair it, and learn the
user's style.*

A full, self-contained recipe (43 cells) covering both halves of prompt assistance —
Claude-powered quality judgement **and** an on-device personalization engine built from
scratch:

| Part | Builds | Runs on |
|---|---|---|
| 1 | Structured prompt **scorer** (5 dimensions, tool-use JSON schema) | Claude |
| 2 | Prompt **repairer** (adds structure, never invents facts) | Claude |
| 3 | **Eval loop** proving the repair lifts quality across a batch | Claude |
| 4 | **Personal n-gram model** with interpolated Kneser–Ney smoothing | pure Python |
| 5 | **Confidence-gated decoding** + **beam search** for phrase completion | pure Python |
| 6 | **Trie** for O(prefix) word completion from the user's vocabulary | pure Python |
| 7 | **Personal calibration** — percentile, domain match, length z-score | pure Python |
| 8 | Combined `PromptAssistant` + held-out **precision/coverage evaluation** | both |

Parts 4–8 need no API key, so readers can run and modify the learning machinery directly.
The held-out evaluation reports **75.9% coverage at 95.5% precision** on a repeated-phrasing
corpus, with a threshold sweep tracing the precision/coverage curve.

**Validated:** every code cell is syntax-checked and executed end-to-end (with a stubbed
client for the API cells) — see `tools/` history in this repo.

Staged here pending maintainer approval of the proposal issue on
[anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks); it will then
be submitted as a PR. The ideas are adapted from this project's suggestion engine
(`src/suggest.js`), Prompt Health engine (`src/health.js`), and trie (`src/trie.js`).
