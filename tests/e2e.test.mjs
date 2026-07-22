/*
 * E2E completeness suite — every advertised interaction, asserted.
 *
 * Drives the REAL extension scripts in demo/composer.html via Playwright and
 * asserts each claim in the README's keyboard table:
 *
 *   Tab            accepts the whole suggestion
 *   Ctrl/Cmd+→     accepts one word
 *   Alt+] / Alt+[  cycle alternative suggestions
 *   Esc            dismisses
 *   /              opens the scaffold palette (typed search filters it)
 *   Enter          inserts a scaffold; Tab jumps between {{placeholders}}
 *   Health ring    appears, scores, opens its panel on click
 *   Compiler       replaces the draft (stubbed transport in the demo)
 *   Learning       a repeated prompt becomes a prediction
 *
 * Usage: node tests/e2e.test.mjs   (also run in CI)
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require_ = createRequire(import.meta.url);
function loadPlaywright() {
  for (const spec of [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/node22/lib/node_modules/playwright"]) {
    if (!spec) continue;
    try {
      return require_(spec);
    } catch (_) {}
  }
  throw new Error("playwright not found");
}
const { chromium } = loadPlaywright();

const here = dirname(fileURLToPath(import.meta.url));
const demoPage = "file://" + join(here, "..", "demo", "composer.html");

const browser = await chromium.launch(
  existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {}
);
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();

const input = () => page.locator(".input");
const ghostVisible = () =>
  page.waitForSelector(".pc-ghost", { state: "visible", timeout: 4000 }).then(() => true, () => false);

async function fresh() {
  await page.goto(demoPage);
  await input().click();
}
async function typeText(t, delay = 30) {
  await page.keyboard.type(t, { delay });
}
const text = async () => (await input().innerText()).replace(/ /g, " ");

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

// --- Ghost text & acceptance ------------------------------------------------

await test("Tab accepts the whole suggestion", async () => {
  await fresh();
  await typeText("write an email");
  assert.ok(await ghostVisible(), "ghost should appear on a template trigger");
  await page.keyboard.press("Tab");
  const t = await text();
  assert.ok(t.includes("{recipient}"), `accepted text missing template body: ${JSON.stringify(t)}`);
});

await test("Ctrl+ArrowRight accepts exactly one word", async () => {
  await fresh();
  await typeText("write an email");
  assert.ok(await ghostVisible());
  await page.keyboard.press("Control+ArrowRight");
  const t = await text();
  assert.ok(/write an email to$/.test(t.trim()), `expected one word ("to") accepted, got: ${JSON.stringify(t)}`);
  // Ghost must re-show the remainder, still accept-able.
  assert.ok(await ghostVisible(), "remainder ghost should still be visible after word-accept");
});

await test("Esc dismisses the ghost", async () => {
  await fresh();
  await typeText("write an email");
  assert.ok(await ghostVisible());
  await page.keyboard.press("Escape");
  const display = await page.locator(".pc-ghost").evaluate((el) => getComputedStyle(el).display);
  assert.equal(display, "none", "ghost should be hidden after Esc");
});

await test("Alt+] cycles to an alternative suggestion when several tiers fire", async () => {
  await fresh();
  // Train the personal model so BOTH the model and the template tier produce
  // candidates for the same lead-in.
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) await window.PromptComplete.learn("write an email every morning before standup");
  });
  await typeText("write an email ");
  assert.ok(await ghostVisible());
  const first = await page.locator(".pc-ghost").textContent();
  await page.keyboard.press("Alt+]");
  await page.waitForTimeout(250);
  const second = await page.locator(".pc-ghost").textContent();
  assert.notEqual(second, first, "Alt+] should show a different candidate");
  await page.keyboard.press("Alt+[");
  await page.waitForTimeout(250);
  const back = await page.locator(".pc-ghost").textContent();
  assert.equal(back, first, "Alt+[ should cycle back to the first candidate");
});

await test("personal model predicts a learned continuation", async () => {
  await fresh();
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++)
      await window.PromptComplete.learn("analyze the churn cohort and report retention by month");
  });
  await typeText("analyze the churn cohort and ");
  assert.ok(await ghostVisible(), "learned lead-in should produce a ghost");
  const g = await page.locator(".pc-ghost").textContent();
  assert.ok(g.includes("report"), `expected learned continuation, got ${JSON.stringify(g)}`);
});

// --- Palette & snippet mode -------------------------------------------------

await test("/ opens the palette and typed text filters it", async () => {
  await fresh();
  await typeText("/");
  await page.waitForSelector(".pc-palette", { state: "visible", timeout: 4000 });
  const countAll = await page.locator(".pc-palette-item").count();
  await typeText("deb"); // filter down to /debug
  await page.waitForTimeout(300);
  const countFiltered = await page.locator(".pc-palette-item").count();
  assert.ok(countFiltered > 0, "filtered palette should still show a match");
  assert.ok(countFiltered < countAll, `typing should filter (${countAll} -> ${countFiltered})`);
});

await test("Enter inserts a scaffold and Tab jumps placeholders", async () => {
  await fresh();
  await typeText("/");
  await page.waitForSelector(".pc-palette", { state: "visible", timeout: 4000 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const t = await text();
  assert.ok(t.length > 20, "scaffold should be inserted");
  // Snippet mode: Tab should move the selection to a placeholder, not insert a tab.
  const selBefore = await page.evaluate(() => String(window.getSelection()));
  await page.keyboard.press("Tab");
  await page.waitForTimeout(250);
  const selAfter = await page.evaluate(() => String(window.getSelection()));
  assert.ok(selAfter.length > 0 && selAfter !== selBefore, `Tab should select next placeholder, selection=${JSON.stringify(selAfter)}`);
});

// --- Health ring & compiler ---------------------------------------------

await test("health ring scores low on a bare draft, high on a structured one", async () => {
  await fresh();
  await typeText("fix my resume idk make it good");
  await page.waitForSelector(".pc-ring", { state: "visible", timeout: 4000 });
  const low = parseInt(await page.locator(".pc-ring-num").textContent(), 10);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await typeText(
    "You are a career coach. Rewrite my resume summary for a data science internship. " +
      "Context: third-year student, two ML projects. Return three bullets under 20 words each.",
    8
  );
  await page.waitForTimeout(600);
  const high = parseInt(await page.locator(".pc-ring-num").textContent(), 10);
  assert.ok(low < 40, `bare draft should score low, got ${low}`);
  assert.ok(high >= 80, `structured prompt should score high, got ${high}`);
});

await test("ring click opens the panel naming missing dimensions", async () => {
  await fresh();
  await typeText("fix my resume idk make it good");
  await page.waitForSelector(".pc-ring", { state: "visible", timeout: 4000 });
  await page.locator(".pc-ring").click();
  await page.waitForSelector(".pc-panel", { state: "visible", timeout: 4000 });
  const panel = await page.locator(".pc-panel").innerText();
  assert.ok(/Specifics|Format|Role|Context|Structure/.test(panel), "panel should name dimensions");
});

await test("Intent Compiler replaces the draft and re-scores", async () => {
  await fresh();
  await typeText("fix my resume idk make it good");
  await page.waitForSelector(".pc-ring", { state: "visible", timeout: 4000 });
  await page.locator(".pc-ring").click();
  await page.waitForSelector(".pc-panel", { state: "visible", timeout: 4000 });
  await page.click(".pc-compile");
  await page.waitForFunction(() => document.querySelector(".input").innerText.includes("resume coach"), {
    timeout: 4000,
  });
  const score = parseInt(await page.locator(".pc-ring-num").textContent(), 10);
  assert.ok(score >= 60, `compiled prompt should re-score well, got ${score}`);
});

// --- Learning-on-send ---------------------------------------------------

await test("Enter (send) trains the model for the next session", async () => {
  await fresh();
  await typeText("draft the quarterly budget review for the finance team");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const learned = await page.evaluate(() => {
    const grams = window.__pcStore.local.pc_ngrams || {};
    return Object.keys(grams).length;
  });
  assert.ok(learned > 0, "sending a prompt should index n-grams into storage");
});

await browser.close();
console.log(failed === 0 ? "\nAll E2E tests passed." : `\n${failed} E2E test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
