# Chrome Web Store submission pack — PromptComplete v1.0.0

Everything below is ready to paste into the Developer Dashboard. Upload
`dist/promptcomplete-1.0.0.zip`, then fill each field from this file.

---

## Store listing

**Item name** (max 45 shown in store, 75 allowed)
```
PromptComplete — Autocomplete for AI chats
```

**Short description** (max 132 chars — this is the manifest `description`)
```
Ghost-text autocomplete for your prompts in Claude and ChatGPT. It learns how you write. Press Tab to accept. Runs on-device.
```

**Category:** Productivity
**Language:** English

**Detailed description**
```
Gmail has Smart Compose. Your code editor has Copilot. The prompt box you type
into every day has nothing — until now.

PromptComplete adds inline ghost-text autocomplete to Claude and ChatGPT. Start
typing, and a grey suggestion appears at your cursor. Press Tab to accept it.

WHAT MAKES IT DIFFERENT: IT LEARNS HOW *YOU* WRITE

Most autocomplete uses a fixed dictionary. PromptComplete builds a small
language model from the prompts you actually send — on your own device. Type
"analyze the sa" and it can finish the whole phrase the way you always write it.
The more you use it, the more it sounds like you.

In a hurry? Settings → "Teach it my style" trains it instantly from prompts you
paste, or from a one-click starter pack for your role.

FEATURES

• Ghost-text completion — Tab accepts, Ctrl/Cmd+→ accepts one word, Alt+] cycles
  alternatives, Esc dismisses.
• Learns your vocabulary and phrasing on-device, and keeps improving.
• Grammar-aware: completions respect what actually fits ("to creat" → "create",
  never "created").
• Prompt Health ring — a live quality score of your draft with the missing
  ingredient named, calibrated against your own prompt history.
• Typo repair — garbled words get a "did you mean" fix (Ctrl+.).
• "/" scaffold palette — 16 proven prompt patterns with Tab-navigable
  placeholders.
• Prompt Lab — a local dashboard of your prompting habits over time.

PRIVACY: LOCAL BY DEFAULT

Your model, your stats, and your settings never leave your browser. There is no
account, no tracking, and no server. The only network request the extension can
ever make is to Anthropic's API — and only if you personally turn on AI mode and
paste your own API key.

OPEN SOURCE

Every line is public, tested (100+ automated tests) and benchmarked:
https://github.com/Amritha902/promptcomplete

Not affiliated with Anthropic or OpenAI.
```

---

## Privacy tab

**Single purpose** (required)
```
PromptComplete has one purpose: to help users write prompts faster and better in
AI chat interfaces by suggesting inline text completions in the prompt input box.
```

**Permission justifications**

`storage`
```
Stores the user's settings and their locally-trained suggestion model (learned
word and phrase frequencies) in the browser. This data never leaves the device
and is required for the extension's core personalization feature.
```

`host permission: https://api.anthropic.com/`
```
Optional AI mode only. If the user chooses to enable AI suggestions and provides
their own Anthropic API key, the extension sends the current prompt draft to
Anthropic's API to generate a completion. This is off by default and never
happens without the user's own key.
```

**Content script host access** (claude.ai, chatgpt.com, chat.openai.com)
```
The extension must read and augment the prompt input box on these AI chat sites
in order to display inline completions at the cursor. It only interacts with the
message composer on these pages.
```

**Remote code:** No — all code is included in the package.

**Data usage disclosures — check these:**
- Does NOT collect or transmit user data. (Everything is stored locally via
  chrome.storage; the optional AI mode sends the draft directly to Anthropic
  using the user's own key and stores nothing.)
- Certify: not being sold to third parties; not used for unrelated purposes;
  not used to determine creditworthiness.

**Privacy policy URL**
```
https://github.com/Amritha902/promptcomplete/blob/main/PRIVACY.md
```

---

## Assets

**Icon:** `icons/icon-128.png` (128×128, included in the package)

**Screenshots** (1280×800, in `store/screenshots/`) — upload in this order:
1. `1-ghost-autocomplete.png` — Ghost text that finishes your prompt
2. `2-learns-your-words.png` — It learns how you write
3. `3-prompt-health.png` — A live quality score for your prompt
4. `4-scaffold-palette.png` — Type / for proven prompt patterns
5. `5-typo-repair.png` — Typos repaired as you type

Regenerate them any time with `node demo/store-shot.html` driven by the
screenshot script (see `store/README.md`).

---

## Submission checklist

- [ ] Register as a Chrome Web Store developer ($5 one-time) at
      https://chrome.google.com/webstore/devconsole
- [ ] Accept the Developer Agreement (must be done by the account owner)
- [ ] Upload `dist/promptcomplete-1.0.0.zip`
- [ ] Paste the listing fields above
- [ ] Upload the 5 screenshots
- [ ] Complete the Privacy tab using the justifications above
- [ ] Set visibility to Public, then Submit for review

Review typically takes a few days. Version 1.0.0 is the first public release.
