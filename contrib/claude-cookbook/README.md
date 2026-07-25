# Proposed recipe for anthropics/claude-cookbooks

**`prompt_quality_scoring.ipynb`** — *Score and repair prompts with Claude.*

A self-contained notebook that scores a draft prompt against five
prompt-engineering best practices (via tool-use structured output), rewrites a
rough draft into a well-structured prompt, and measures the quality lift across
a batch with a small eval loop. Exposes two drop-in helpers, `score()` and
`improve()`.

This is staged here pending maintainer approval of the proposal issue on
[anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks).
Once approved, it will be submitted as a PR to that repository. The ideas are
adapted from the Prompt Health engine and Intent Compiler in this project
(`src/health.js`, `src/background.js`).
