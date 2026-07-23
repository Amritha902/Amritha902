# Data sources — what's real, where it comes from, how to reproduce it

Every number and word list in PromptComplete traces to an actual dataset or an
actual measurement. Nothing is hand-invented. This page is the provenance
record.

## 1. The lexicon (`src/lexicon.js`)

Powers spelling repair ranks and dictionary word completion.

| | |
|---|---|
| Dataset | [google-10000-english](https://github.com/first20hours/google-10000-english) (no-swears variant) |
| Underlying corpus | Google Web Trillion Word Corpus — n-gram frequency counts over ~1 trillion words of web text (Brants & Franz, LDC2006T13) |
| What we use | The full frequency-ranked list (9,894 words); array index = frequency rank |
| Our addition | A 32-word prompt-domain overlay (informal chat words, AI terms) spliced at rank 2000 — listed explicitly in `tools/build-lexicon.mjs` |
| Reproduce | `node tools/build-lexicon.mjs` (downloads the source and regenerates the file; provenance is stamped in the generated header) |

## 2. The prompt-pattern analysis (`tools/analyze-prompts.mjs`)

The template tier's lead-ins are validated against how people *actually* open
prompts, using a real community corpus.

| | |
|---|---|
| Dataset | [f/awesome-chatgpt-prompts](https://github.com/f/awesome-chatgpt-prompts) (`prompts.csv`, CC0) |
| Size at analysis time | 2,061 prompts (2026-07) |
| Reproduce | `node tools/analyze-prompts.mjs` |

Measured findings (from the committed script, not estimates):

```
top lead-ins (first 3 words):
  433   21.0%  "act as a"
  220   10.7%  "i want you"
  117    5.7%  "act as an"
   71    3.4%  "you are a"
   29    1.4%  "you are an"

coverage: 1083/2061 (52.5%) of real prompts open with a lead-in
          the template/IR tiers recognize
```

Two product decisions came straight from this data:

- `act as` is a first-class template trigger (it opens ~27% of real prompts
  across its variants).
- `i want you to` got its own trigger after the analysis showed it opening
  10.7% of the corpus — it previously fell through to the weaker `i want to`
  pattern.

The remaining ~47% of the corpus opens with role-play scenario text that no
generic lead-in can (or should) complete — that's exactly the space where the
personal model and the opt-in AI tier take over.

## 3. The personal model (your own data, on-device)

The Kneser–Ney n-gram model and the word-completion vocabulary
(`pc_ngrams`, `pc_cont`, `pc_words` in `chrome.storage.local`) are trained
exclusively on prompts **you send**, on your machine. Nothing is uploaded.
Export/import the model as JSON from Settings — it's your dataset.

## 4. The comparison numbers

The "78 vs 15 keystrokes" figure in the README is counted by a real
`keydown` listener at document capture during the recording
(`demo/compare.mjs`) — the counter is part of the recorded page, not
post-production.
