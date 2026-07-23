/*
 * Unit tests for the garble-repair tier (src/repair.js) — Norvig-style
 * correction, jammed-word splitting, misplaced spaces, and (equally
 * important) staying silent on clean text.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
globalThis.window = {};
eval(readFileSync(join(here, "..", "src", "repair.js"), "utf8"));
const R = window.PromptRepair;

const apply = (text) => {
  const r = R.repairTail(text);
  return r ? text.slice(0, r.from) + r.fixed : null;
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("fixes a transposition typo", () => {
  assert.equal(apply("help me with computign"), "help me with computing");
});

test("splits a jammed word into two known words", () => {
  assert.equal(apply("i need help understandingkinda"), "i need help understanding kinda");
});

test("fixes a dropped letter", () => {
  assert.equal(apply("explain machine lerning to me"), "explain machine learning to me");
});

test("repairs at least part of a heavily garbled tail", () => {
  const out = apply("computign udnerstandisn gkidna");
  assert.ok(out && out.startsWith("computing"), `expected leading fix, got ${out}`);
  assert.ok(out.endsWith("kinda"), `expected trailing fix, got ${out}`);
});

test("stays silent on clean text", () => {
  assert.equal(apply("write an email"), null);
  assert.equal(apply("analyze the sales dataset"), null);
  assert.equal(apply("please summarize this report"), null);
});

test("leaves numbers and punctuation alone", () => {
  assert.equal(apply("the revenue was 12345"), null);
});

test("isKnown covers informal prompt vocabulary", () => {
  for (const w of ["kinda", "idk", "resume", "summarize", "claude"]) {
    assert.ok(R.isKnown(w), `${w} should be known`);
  }
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
console.log(failed === 0 ? `\nAll ${tests.length} repair tests passed.` : `\n${failed} repair test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
