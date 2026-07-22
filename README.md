# PromptComplete

[![CI](https://github.com/Amritha902/Amritha902/actions/workflows/ci.yml/badge.svg)](https://github.com/Amritha902/Amritha902/actions/workflows/ci.yml)

**The prompt box, upgraded to an IDE — inline autocomplete, a live prompt-quality
meter, one-click prompt compilation, and a local experiment lab. Claude-first.**

![PromptComplete in action: ghost text, Tab accept, and the / scaffold palette](demo/shots/hero.gif)

Typing a good prompt is the slowest part of using an AI assistant. Gmail has Smart
Compose. Your editor has Copilot. The prompt box you type into every day has…
nothing. PromptComplete turns it into an IDE for prompts:

- **Ghost-text autocomplete** at the caret — `Tab` accepts, like Smart Compose.
- **Prompt Health ring** — a live score of your draft against prompt-engineering
  best practices, with the missing ingredient named.
- **Intent Compiler** — one click turns a rough draft ("fix my resume idk make it
  good") into a structured, Claude-grade prompt.
- **`/` scaffold palette** — 16 curated prompt patterns (roles, XML tags, examples,
  chain-of-thought, output formats) with Tab-navigable `{{placeholders}}`.
- **Prompt Lab** — every sent prompt logged locally like an ML experiment: health
  score, size, missing techniques, plus your acceptance-rate trend over time.

Built Claude-first with a warm Claude-flavored theme. Also works on ChatGPT.

<p align="center"><em>typed text</em> <code>│</code> <em>ghost suggestion…</em> &nbsp;→&nbsp; <kbd>Tab</kbd></p>

---

## Why it's interesting (the data science inside)

This is a working applied-ML system, not a snippet list:

- **An interpolated Kneser–Ney language model** — the smoothing family production
  n-gram systems use — trained incrementally on *your own* prompts, entirely
  on-device, with continuation counts maintained O(1) at index time.
- **A text-analytics pipeline** — clean/parse → stem (with overstemming guards) →
  chunk (sliding n-gram windows) → index — each stage a pure, tested function.
- **Vector-space retrieval** — curated templates matched by cosine similarity over
  stem TF vectors when the regex fast-path misses a paraphrase.
- **Confidence-gated decoding** — the model emits only while `P(w|h) ≥ 0.45` with
  support ≥ 2: silence beats a wrong guess (precision over recall, by design).
- **A built-in eval loop** — acceptance rate (the canonical autocomplete metric),
  daily time-series trend, descriptive statistics, and one-click dataset export.

Full design + formulas: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Latency by design

| Path | Budget |
|---|---|
| Local tiers (model + templates + IR) | **< 1 ms** after a 120 ms debounce |
| AI tier (opt-in) | streams token-by-token after a further 350 ms quiet gap; in-flight requests abort server-side on the next keystroke |
| Training | runs at send time — never on the keystroke path |

## Keyboard

| Key | Action |
|---|---|
| `Tab` | Accept the whole suggestion |
| `Ctrl/Cmd+→` | Accept one word |
| `Alt+]` / `Alt+[` | Cycle alternative suggestions |
| `Esc` | Dismiss |
| `/` at start | Open the scaffold palette |
| `Tab` (after scaffold) | Jump to next `{{placeholder}}` |

## Install (developer mode)

1. Clone this repo.
2. `node tools/gen-icons.mjs` (one time).
3. `chrome://extensions` → **Developer mode** → **Load unpacked** → select this
   folder (Chrome, Edge, Brave — any Chromium browser).
4. Open [claude.ai](https://claude.ai) and start typing.

**AI mode (optional):** open Settings, switch the source to **AI**, paste your
Anthropic API key. Ghost completions default to `claude-haiku-4-5` (latency);
the Intent Compiler defaults to `claude-sonnet-5` (quality). Your key lives in
your browser's extension storage and is sent only to `api.anthropic.com`.

Run the tests: `npm test` (11 unit tests, zero dependencies) and
`npm run test:e2e` (17 Playwright assertions: every keyboard interaction in
the demo composer, all three extension pages, and a real-Chrome load of the
unpacked extension with its MV3 service worker).

## Live demo (no install)

`demo/composer.html` is a Claude-style demo composer that runs the **real,
unmodified extension scripts** against a stubbed `chrome.*` API — open it in
any browser to feel the ghost text, health ring, and `/` palette without
loading the extension. `node demo/capture.mjs` drives it with Playwright and
captures the screenshots in `demo/shots/` (it doubles as the E2E test — it
caught a real template-duplication bug that is now covered by the unit suite).

| Ghost text | Personal model | `/` palette |
|---|---|---|
| ![ghost](demo/shots/1-ghost.png) | ![personal](demo/shots/3-personal.png) | ![palette](demo/shots/4-palette.png) |

**The Intent Compiler**, before and after — a rough draft scoring **0** on the
health ring becomes a structured prompt scoring **80** with one click. (In the
demo the rewrite is a canned representative example; in the real extension this
call goes to Claude Sonnet with your key.)

| Draft: "fix my resume idk make it good" — health 0 | Compiled — health 80 |
|---|---|
| ![draft](demo/shots/6-draft.png) | ![compiled](demo/shots/7-compiled.png) |

**▶ Full 42-second product tour with captions:**
[`demo/shots/tour.webm`](demo/shots/tour.webm) — every feature in one take
(ghost text → personal model → `/` scaffolds with placeholder jumping → health
ring → Intent Compiler). Regenerate with `node demo/video.mjs`.

`node demo/record.mjs` regenerates the hero GIF — Playwright video → PNG
frames → an animated GIF assembled by our own dependency-free GIF89a encoder
([`tools/gif.mjs`](tools/gif.mjs): PNG decode, palette quantization, LZW).

## How it works

| Piece | File | Role |
|---|---|---|
| Content script | `src/content.js` | Composer detection, ghost rendering, keyboard, health ring, analytics |
| Suggestion engine | `src/suggest.js` | KN language model + curated templates + vector-space IR |
| Health engine | `src/health.js` | 5-dimension best-practice scoring, length-scaled |
| Scaffolds | `src/templates.js`, `src/palette.js` | Curated prompt patterns + `/` palette + snippet mode |
| Service worker | `src/background.js` | Streaming completions over a port (real abort), Intent Compiler |
| Insights | `dashboard/` | Acceptance analytics, time series, Prompt Lab, export |
| Popup / Settings | `popup/`, `options/` | Toggles, models, key |

## Privacy

Local by default: the model, analytics, and settings never leave your browser.
The Prompt Lab stores **no prompt text** — only structure (length, score, missing
techniques). In AI mode the only outbound request is the one you authorize, with
your own key, directly to Anthropic. No PromptComplete server. No telemetry.

## The bigger picture

PromptComplete is the free personal tier of a larger offering — shared team
prompt packs, org-wide curation, and acceptance analytics as seat-activation
evidence. See [`docs/PITCH.md`](docs/PITCH.md) (product & business),
[`docs/STRATEGY.md`](docs/STRATEGY.md) (the Anthropic pain points it targets),
and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (the pipeline).

## License

MIT — see [`LICENSE`](LICENSE).
