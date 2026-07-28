# Privacy Policy — PromptComplete

_Last updated: July 2026_

**Short version: PromptComplete does not collect, transmit, or sell your data.
Everything it learns stays in your browser.**

## What the extension stores

All of the following is stored locally in your browser via the standard
`chrome.storage` API, and never leaves your device:

| Data | Why | Where |
|---|---|---|
| Your suggestion model (learned word and phrase frequencies from prompts you send) | To personalize completions to how you write | `chrome.storage.local` |
| Usage counters (suggestions shown, accepted, dismissed; characters saved) | To power the local Prompt Lab dashboard | `chrome.storage.local` |
| Prompt structure log (word count, quality score, missing techniques) | To show your prompting trend over time | `chrome.storage.local` |
| Settings (on/off, mode, model choice) | To remember your preferences | `chrome.storage.sync` |
| Your Anthropic API key, if you provide one | To authenticate your own optional AI requests | `chrome.storage.local` only — never synced |

**The Prompt Lab stores no prompt text** — only structural metadata such as
length and score.

## What is never collected

- No analytics, telemetry, or tracking of any kind.
- No account, sign-in, or identifier.
- No server operated by this extension. There is no backend.
- Your prompts are never uploaded anywhere by default.

## The one optional network request

The extension works fully offline in its default **Local** mode.

If — and only if — you explicitly switch to **AI mode** in Settings and paste
your own Anthropic API key, the extension will send your current prompt draft
directly to `https://api.anthropic.com` to generate a suggestion. That request
goes from your browser to Anthropic under your own API key, subject to
[Anthropic's privacy policy](https://www.anthropic.com/legal/privacy). Nothing
is routed through any third party, and no copy is retained by the extension.

You can turn AI mode off at any time, and remove your key, from the Settings
page.

## Your control over your data

- **Export:** Settings → Export model, and the dashboard's dataset export, let
  you download everything the extension holds as JSON.
- **Delete:** The dashboard's "Reset" button erases the learned model and all
  statistics. Uninstalling the extension removes all stored data.

## Permissions and why they are needed

- `storage` — to save the local model and your settings, as described above.
- Access to `claude.ai`, `chatgpt.com`, `chat.openai.com` — to read and augment
  the message composer on those pages so completions can be shown at your
  cursor. The extension only interacts with the prompt input box.
- `https://api.anthropic.com/` — used solely for the optional AI mode described
  above.

## Children

PromptComplete is not directed at children under 13 and collects no personal
information from anyone.

## Changes

Any change to this policy will be published in this file in the public
repository, with the date above updated.

## Contact

Questions or concerns: open an issue at
<https://github.com/Amritha902/promptcomplete/issues>.
