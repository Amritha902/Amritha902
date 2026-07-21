/*
 * PromptComplete — model + pipeline tests
 *
 * Zero-dependency test runner (node:assert) so the suite runs anywhere:
 *   node tests/model.test.mjs
 *
 * Covers the learning pipeline (normalize → chunk → index), the interpolated
 * back-off scorer, confidence gating, and the suggestion sanitizer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Load suggest.js inside a minimal extension-shaped environment ---------
let store = {};
globalThis.window = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (typeof k === "string" ? { [k]: store[k] } : { ...store }),
      set: async (obj) => Object.assign(store, obj),
    },
  },
  runtime: { sendMessage: (_m, cb) => cb && cb(null), lastError: null },
};
// eslint-disable-next-line no-eval
eval(readFileSync(join(root, "src/suggest.js"), "utf8"));
const PC = window.PromptComplete;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// --- Learning + prediction --------------------------------------------------
test("learns a repeated prompt and predicts its continuation", async () => {
  store = {};
  for (let i = 0; i < 3; i++) {
    await PC.learn("write a professional email to my manager about the deadline");
  }
  const s = await PC.getSuggestion("write a professional email to my ", { mode: "local" });
  assert.ok(s && s.includes("manager"), `expected continuation, got ${JSON.stringify(s)}`);
});

test("stays silent on unseen context (confidence gate)", async () => {
  store = {};
  await PC.learn("write a professional email to my manager about the deadline");
  const s = await PC.getSuggestion("zzz qqq unrelated tokens ", { mode: "local" });
  assert.equal(s, null, "unseen context must not produce a personal-model guess");
});

test("does not extend mid-word (word-boundary rule)", async () => {
  store = {};
  for (let i = 0; i < 3; i++) await PC.learn("summarize the quarterly report for the board");
  // no trailing space → personal model must not fire; template may still match,
  // so we assert the *personal* continuation is absent.
  const s = await PC.getSuggestion("summarize the quarterly", { mode: "local" });
  assert.ok(!s || !s.startsWith(" report"), "must not glue a word onto a partial word");
});

test("conflicting evidence below confidence threshold stays silent", async () => {
  store = {};
  // Same history, four different continuations → max P(w|h) ≈ 0.25 < 0.45.
  await PC.learn("please analyze the data using pandas today");
  await PC.learn("please analyze the data using numpy today");
  await PC.learn("please analyze the data using scipy today");
  await PC.learn("please analyze the data using sklearn today");
  const s = await PC.getSuggestion("please analyze the data using ", { mode: "local" });
  assert.equal(s, null, `split evidence must gate emission, got ${JSON.stringify(s)}`);
});

test("trigram evidence outweighs bigram evidence (interpolation order)", async () => {
  store = {};
  // bigram "the report" mostly continues with "quickly"...
  for (let i = 0; i < 4; i++) await PC.learn("skim the report quickly for errors now");
  // ...but the specific trigram "review the report" continues with "carefully".
  for (let i = 0; i < 4; i++) await PC.learn("review the report carefully for errors now");
  const s = await PC.getSuggestion("review the report ", { mode: "local" });
  assert.ok(s && s.includes("carefully"), `trigram should win, got ${JSON.stringify(s)}`);
});

// --- Stemming (evidence pooling) --------------------------------------------
test("stemmed history keys pool evidence across inflections", async () => {
  store = {};
  // Train with "writing", query with "write" — stems must unify the histories.
  for (let i = 0; i < 3; i++) await PC.learn("writing an email to the whole team tonight");
  const s = await PC.getSuggestion("write an email to the ", { mode: "local" });
  assert.ok(s && s.includes("whole"), `inflections should share evidence, got ${JSON.stringify(s)}`);
});

// --- Templates --------------------------------------------------------------
test("template fallback fires for a known pattern", async () => {
  store = {}; // empty personal model → templates take over
  const s = await PC.getSuggestion("explain", { mode: "local" });
  assert.ok(s && s.length > 5, "curated template should fire on a known lead-in");
});

test("vector-space retrieval catches a paraphrased lead-in", async () => {
  store = {};
  // "please write an email" misses the ^write regex but must match by cosine.
  const s = await PC.getSuggestion("please write an email", { mode: "local" });
  assert.ok(s && /recipient|topic|concise/.test(s), `IR tier should fire, got ${JSON.stringify(s)}`);
});

test("template tiers stay silent deep into a developed prompt", async () => {
  store = {};
  const long = "write an email to my boss about the deadline extension we discussed yesterday evening ";
  const s = await PC.getSuggestion(long, { mode: "local" });
  assert.equal(s, null, `lead-in templates must not fire past the window, got ${JSON.stringify(s)}`);
});

test("template never duplicates words the user already typed past the trigger", async () => {
  store = {};
  // Caught by the E2E demo: "write an email to my manager" used to get
  // " to {recipient} about {topic}…" appended — duplicating "to".
  const s = await PC.getSuggestion("write an email to my manager", { mode: "local" });
  if (s) {
    assert.ok(!/^\s*to\b/i.test(s), `suggestion must not repeat "to", got ${JSON.stringify(s)}`);
  }
});

test("template still fires when the typed text is exactly the trigger", async () => {
  store = {};
  const s = await PC.getSuggestion("write an email", { mode: "local" });
  assert.ok(s && /recipient/.test(s), `trigger-only text should still complete, got ${JSON.stringify(s)}`);
});

// --- Runner -----------------------------------------------------------------
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
console.log(failed === 0 ? `\nAll ${tests.length} tests passed.` : `\n${failed}/${tests.length} tests FAILED.`);
process.exit(failed === 0 ? 0 : 1);
