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

await test("clicking the ghost accepts (touch devices have no Tab key)", async () => {
  await fresh();
  await typeText("write an email");
  assert.ok(await ghostVisible());
  await page.locator(".pc-ghost").click();
  const t = await text();
  assert.ok(t.includes("{recipient}"), `click-accept failed: ${JSON.stringify(t)}`);
});

await test("everyday lead-ins get suggestions (tell me / i need)", async () => {
  await fresh();
  await typeText("tell me");
  assert.ok(await ghostVisible(), "'tell me' should suggest");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await typeText("i need");
  assert.ok(await ghostVisible(), "'i need' should suggest");
});

await test("demo shows the why-no-suggestion hint on unknown lead-ins", async () => {
  await fresh();
  // All dictionary words (so no repair chip), but no known lead-in either.
  await typeText("the report was about the market");
  await page.waitForSelector("#nsh:not([hidden])", { timeout: 4000 });
});

// --- Word completion (mid-word tier) ---------------------------------------

await test("one letter ghosts the user's own word and Tab completes it (h → hello)", async () => {
  await fresh();
  await page.evaluate(async () => {
    await window.PromptComplete.learn("hello can you help me with my report");
    await window.PromptComplete.learn("hello i need a summary of this paper");
  });
  await typeText("h");
  assert.ok(await ghostVisible(), "single letter should ghost a personal word");
  const g = await page.locator(".pc-ghost").textContent();
  assert.ok(g.startsWith("ello"), `expected "ello…", got ${JSON.stringify(g)}`);
  await page.keyboard.press("Tab");
  const t = (await text()).trim();
  assert.ok(t.startsWith("hello"), `Tab should complete to hello, got ${JSON.stringify(t)}`);
});

await test("phrase judgment: mid-word prefix ghosts the whole learned phrase, Tab accepts it", async () => {
  await fresh();
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++)
      await window.PromptComplete.learn("analyze the sales dataset and plot the monthly revenue trend by region");
  });
  await typeText("analyze the sa");
  assert.ok(await ghostVisible(), "phrase ghost should appear mid-word");
  const g = await page.locator(".pc-ghost").textContent();
  assert.ok(g.startsWith("les dataset and plot"), `expected the whole phrase, got ${JSON.stringify(g)}`);
  await page.keyboard.press("Tab");
  const t = (await text()).trim();
  assert.ok(
    t.startsWith("analyze the sales dataset and plot"),
    `Tab should accept the phrase, got ${JSON.stringify(t)}`
  );
});

await test("dictionary completes an unseen prefix and suppresses the repair chip", async () => {
  await fresh();
  await typeText("underst");
  assert.ok(await ghostVisible(), "dictionary tier should ghost mid-word");
  const g = await page.locator(".pc-ghost").textContent();
  assert.ok(g.startsWith("and"), `expected "and…", got ${JSON.stringify(g)}`);
  const chipVisible = await page.locator(".pc-repair").isVisible().catch(() => false);
  assert.equal(chipVisible, false, "repair chip must yield to an active ghost");
});

await test("grammar guard: 'i want to creat' Tab-completes to create (never created)", async () => {
  await fresh();
  await typeText("i want to creat");
  await page.waitForFunction(() => {
    const g = document.querySelector(".pc-ghost");
    return g && getComputedStyle(g).display !== "none" && g.textContent.startsWith("e");
  }, { timeout: 4000 });
  await page.keyboard.press("Tab");
  const t = (await text()).trim();
  assert.ok(/^i want to create\b/.test(t), `expected "create", got ${JSON.stringify(t)}`);
  assert.ok(!/created/.test(t), `inflected completion leaked: ${JSON.stringify(t)}`);
});

// --- Leading prompts (guidance tier) ---------------------------------------

await test("leading prompts: an original draft gets a guidance ghost that Tab-accepts", async () => {
  await fresh();
  await typeText("the team met today and we discussed many things");
  await page.waitForFunction(() => {
    const g = document.querySelector(".pc-ghost");
    return g && getComputedStyle(g).display !== "none" && /—/.test(g.textContent);
  }, { timeout: 4000 });
  const g = await page.locator(".pc-ghost").textContent();
  assert.ok(/specific/.test(g), `guidance should name the missing ingredient, got ${JSON.stringify(g)}`);
  await page.keyboard.press("Tab");
  const t = await text();
  assert.ok(/be specific/.test(t), `Tab should accept the guidance, got ${JSON.stringify(t)}`);
});

// --- Garble repair ("did you mean") ---------------------------------------

await test("garbled tail shows a repair chip and Ctrl+. applies it", async () => {
  await fresh();
  await typeText("help me with computign");
  await page.waitForSelector(".pc-repair", { state: "visible", timeout: 4000 });
  const chip = await page.locator(".pc-repair").innerText();
  assert.ok(chip.includes("computing"), `chip should propose the fix, got ${JSON.stringify(chip)}`);
  await page.keyboard.press("Control+.");
  await page.waitForTimeout(300);
  const t = await text();
  assert.ok(/help me with computing\s*$/.test(t), `repair should apply, got ${JSON.stringify(t)}`);
});

await test("clean text never shows the repair chip", async () => {
  await fresh();
  await typeText("write an email to my manager");
  await page.waitForTimeout(600);
  const visible = await page.locator(".pc-repair").isVisible().catch(() => false);
  assert.equal(visible, false, "no chip on clean text");
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
