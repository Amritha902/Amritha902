# PromptComplete

**Inline autocomplete for AI chat prompts — ghost-text as you type, press `Tab` to accept.**

Typing a good prompt is the slowest part of using an AI assistant. Gmail has Smart
Compose. Your IDE has Copilot. The prompt box you type into every day has… nothing.
PromptComplete fixes that: a lightweight browser extension that shows an inline,
Gmail-style suggestion right where your cursor is, learns from *your* past prompts,
and stays completely on-device unless you opt in to smarter AI completions.

Built Claude-first, with a warm Claude-flavored UI. Also works on ChatGPT.

<p align="center"><em>typed text</em> <code>│</code> <em>ghost suggestion…</em> &nbsp;→&nbsp; <kbd>Tab</kbd></p>

---

## Why it's interesting

- **On-device personalization.** A small n-gram model builds itself from the prompts
  *you* actually write and predicts your continuations — no server, no account, no data
  leaving your browser.
- **Two sources, one UX.**
  - **Local** (default): instant, private, zero-cost. Personal model + a curated
    library of prompt patterns.
  - **AI** (opt-in, bring-your-own-key): short, high-quality continuations from Claude
    (`claude-haiku-4-5` by default for low latency). Falls back to Local if offline.
- **A real eval loop.** The extension tracks its own **acceptance rate** — the standard
  offline metric for an autocomplete model — and shows it on a local **Insights
  dashboard**, with a one-click dataset export for notebook analysis.

---

## Install (developer mode)

1. Clone this repo.
2. Generate the icons (one time): `node tools/gen-icons.mjs`
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and
   select this folder. (Works in Chrome, Edge, Brave, and any Chromium browser.)
4. Open [claude.ai](https://claude.ai) and start typing — the ghost text appears at your
   cursor. `Tab` accepts, `Esc` dismisses.

To enable AI mode, open the extension's **Settings**, switch the source to **AI**, and
paste your Anthropic API key. The key is stored only in your browser's extension storage
and is sent directly to `api.anthropic.com` — never anywhere else.

---

## How it works

| Piece | File | Role |
|---|---|---|
| Content script | `src/content.js` | Detects the composer, renders ghost text at the caret, handles `Tab`/`Esc`, learns on send |
| Suggestion engine | `src/suggest.js` | Personal n-gram model + curated templates + AI bridge |
| Service worker | `src/background.js` | Calls the Claude API for AI mode (with a session cache) |
| Popup | `popup/` | Quick enable + source toggle |
| Settings | `options/` | API key, model, source |
| Insights | `dashboard/` | Local analytics + dataset export |

The composer works for both `<textarea>` and the contenteditable (ProseMirror) editors
Claude and ChatGPT use. Suggestions only appear when your caret is at the end of the
text — the same model as Gmail Smart Compose — which keeps the UX predictable.

---

## Privacy

Everything is local by default. The personal model, the analytics, and your settings
live in your browser's extension storage. In AI mode, the *only* outbound request is the
one you authorize: your partial prompt goes directly to Anthropic with your own key.
There is no PromptComplete server, no telemetry, and no third party in the loop.

---

## The bigger picture

PromptComplete is designed as the free, personal tier of a larger product. The same
on-device dataset that powers your Insights dashboard is the seed for a **team/enterprise
offering**: shared prompt libraries, curated org-wide suggestions, and anonymized
acceptance analytics served from a proper data API. See [`docs/PITCH.md`](docs/PITCH.md)
for the business plan and a collaboration proposal.

---

## License

MIT — see [`LICENSE`](LICENSE).
