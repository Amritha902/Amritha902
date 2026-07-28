# Microsoft Edge Add-ons submission pack — PromptComplete v1.0.0

**Registration is free** (no developer fee), and you can sign in with a GitHub
or Microsoft account: <https://partner.microsoft.com/dashboard/microsoftedge>

Edge is Chromium-based, so the **same package works unchanged** — upload
`dist/promptcomplete-1.0.0.zip` exactly as built for Chrome. No manifest edits,
no code changes.

---

## Availability

- **Markets:** All markets
- **Visibility:** Public
- **Category:** Productivity
- **Age rating:** General audience

## Store listing (English)

**Display name**
```
PromptComplete — Autocomplete for AI chats
```

**Short description** (max 132 chars)
```
Ghost-text autocomplete for your prompts in Claude and ChatGPT. It learns how you write. Press Tab to accept. Runs on-device.
```

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

Not affiliated with Anthropic, Microsoft, or OpenAI.
```

**Search terms / keywords**
```
autocomplete, prompt, AI chat, productivity, ghost text, writing assistant
```

**Website**
```
https://github.com/Amritha902/promptcomplete
```

**Privacy policy URL**
```
https://github.com/Amritha902/promptcomplete/blob/main/PRIVACY.md
```

**Support contact**
```
https://github.com/Amritha902/promptcomplete/issues
```

---

## Properties tab

**Does this extension use single sign-on?** No
**Does it collect personally identifiable information?** No
**Is it a paid product / does it contain ads?** No
**Does it use remote code?** No — all code ships inside the package.

**Permission justifications** (Edge asks the same questions as Chrome)

`storage`
```
Stores the user's settings and their locally-trained suggestion model (learned
word and phrase frequencies) in the browser. This data never leaves the device
and is required for the extension's core personalization feature.
```

`https://api.anthropic.com/`
```
Optional AI mode only. If the user enables AI suggestions and provides their own
Anthropic API key, the extension sends the current prompt draft to Anthropic's
API to generate a completion. This is off by default and never happens without
the user's own key.
```

Content-script sites (`claude.ai`, `chatgpt.com`, `chat.openai.com`)
```
The extension reads and augments the prompt input box on these AI chat sites in
order to display inline completions at the cursor. It only interacts with the
message composer on these pages.
```

---

## Assets

- **Logo:** `icons/icon-128.png` (128×128) — Edge also accepts a 300×300 tile if
  you want to supply one later.
- **Screenshots** (1280×800, from `store/screenshots/`), in this order:
  1. `1-ghost-autocomplete.png`
  2. `2-learns-your-words.png`
  3. `3-prompt-health.png`
  4. `4-scaffold-palette.png`
  5. `5-typo-repair.png`

---

## Checklist

- [ ] Register free at <https://partner.microsoft.com/dashboard/microsoftedge>
      (GitHub or Microsoft account)
- [ ] Create a new extension → upload `dist/promptcomplete-1.0.0.zip`
- [ ] Fill the Store listing fields above
- [ ] Upload the 5 screenshots
- [ ] Complete the Properties tab with the justifications above
- [ ] Submit for certification (typically a few business days)
