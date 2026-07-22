# Chrome Web Store — Listing Kit

Everything needed to publish. Build the package with `node tools/pack.mjs`
(→ `dist/promptcomplete-<version>.zip`), then paste the copy below into the
[developer dashboard](https://chrome.google.com/webstore/devconsole) ($5
one-time registration).

---

## Name

**PromptComplete — autocomplete & prompt IDE for AI chats**

## Summary (132 chars max)

Ghost-text autocomplete for Claude & ChatGPT. Tab to accept. A live prompt-quality score, one-click prompt rewrite, and / scaffolds.

## Description

Typing a good prompt is the slowest part of using an AI assistant. Gmail has
Smart Compose. Your editor has Copilot. Your AI chat box has… nothing.

PromptComplete upgrades the prompt box into an IDE:

⌨️ GHOST-TEXT AUTOCOMPLETE — As you type, a greyed continuation appears at
your cursor. Tab accepts it. Ctrl/Cmd+→ takes one word. Alt+] cycles
alternatives.

🧠 LEARNS YOUR PHRASING — A small language model trains on your own prompts,
entirely on your device. Type a familiar lead-in and it completes it your way.
Nothing is uploaded, ever.

💯 PROMPT HEALTH SCORE — A live ring scores your draft against
prompt-engineering best practices (role, context, specifics, format,
structure) and names exactly what's missing.

⚡ INTENT COMPILER — One click turns a rough draft ("fix my resume idk make
it good") into a structured, professional prompt. (Uses your own Anthropic
API key.)

📋 / SCAFFOLDS — Type / for 16 curated prompt patterns with Tab-navigable
placeholders: email, code review, debugging, summarization, and more.

📊 PROMPT LAB — A local analytics dashboard: your suggestion acceptance rate,
characters and time saved, a 14-day trend, and the prompt technique you most
often skip.

PRIVACY FIRST
Everything runs locally by default. The optional AI mode sends your partial
prompt directly to Anthropic with your own API key — there is no
PromptComplete server, no account, and no telemetry. The Prompt Lab stores
prompt structure (length, score), never prompt text.

Works on claude.ai and chatgpt.com. Not affiliated with Anthropic or OpenAI.

## Category

Productivity → Tools

## Language

English

## Screenshots (1280×800 or 640×400)

Use the captures in `demo/shots/` (re-render at 1280×800 by setting the
viewport in `demo/capture.mjs` if the dashboard requires exact sizing):

1. `1-ghost.png` — ghost text at the caret
2. `3-personal.png` — the personal model completing the user's own phrasing
3. `4-palette.png` — the / scaffold palette
4. `5-health.png` — health ring + best-practice breakdown
5. `7-compiled.png` — Intent Compiler output

## Privacy tab answers

- **Single purpose:** Inline writing assistance for AI chat prompt boxes.
- **Permission `storage`:** Stores user settings, the on-device suggestion
  model, and local usage statistics.
- **Host `api.anthropic.com`:** Optional AI mode sends the user's partial
  prompt to Anthropic using the user's own API key.
- **Content scripts on claude.ai / chatgpt.com:** Required to render
  suggestions inside the chat composer.
- **Data collection:** None. No analytics, no remote servers, no sale of data.
- **Remote code:** None. All code is packaged.

## Support / homepage URL

The GitHub repository.
