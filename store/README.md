# Chrome Web Store assets

- **`LISTING.md`** — every field of the store submission, ready to paste
  (descriptions, permission justifications, privacy answers, checklist).
- **`screenshots/`** — five 1280×800 screenshots, captured from the real
  extension code running in `demo/store-shot.html` (nothing mocked up).

## Regenerating the screenshots

`demo/store-shot.html` is a clean, unbranded chat surface that loads the actual
content scripts. Drive it with Playwright at a 1280×800 viewport, set the
caption via `window.setCaption(title, subtitle)`, trigger the feature, and
screenshot. The script used to produce the current set is documented in the
commit that added these files.

## Building the uploadable package

```bash
node tools/gen-icons.mjs   # once
node tools/pack.mjs        # → dist/promptcomplete-<version>.zip
```

The zip contains only what the extension ships: `manifest.json`, `src/`,
`icons/`, `popup/`, `options/`, `dashboard/` (25 files).

## Verifying before you upload

```bash
npm test          # unit suites
npm run test:e2e  # browser suites, including edge cases
```

The packaged zip itself is also loadable as an unpacked extension — the
`tests/extension.test.mjs` smoke test boots the MV3 service worker from the real
manifest and checks every extension page loads without errors.
