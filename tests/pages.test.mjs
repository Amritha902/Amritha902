/*
 * E2E for the extension PAGES (dashboard, options, popup) — loaded with the
 * demo harness's chrome.* stub injected first, storage pre-seeded, and every
 * headline element asserted. Also fails on any page JS error.
 *
 * Usage: node tests/pages.test.mjs   (also run in CI)
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessPath = join(root, "demo", "harness.js");

const browser = await chromium.launch(
  existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {}
);

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

/** New page with the chrome stub + optional seeded storage + error capture. */
async function openPage(relPath, seed = {}) {
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript({ path: harnessPath });
  await page.addInitScript((s) => {
    Object.assign(window.__pcStore.local, s.local || {});
    Object.assign(window.__pcStore.sync, s.sync || {});
  }, seed);
  await page.goto("file://" + join(root, relPath));
  await page.waitForTimeout(400);
  return { page, errors };
}

const today = new Date().toISOString().slice(0, 10);
const SEED = {
  local: {
    pc_stats: { shown: 40, accepted: 10, dismissed: 5, chars_saved: 1200 },
    pc_stats_daily: { [today]: { shown: 12, accepted: 4 } },
    pc_lengths: [5, 9, 14, 22, 31],
    pc_lab: [
      { t: Date.now() - 60000, words: 6, health: 20, missing: ["format", "specificity"] },
      { t: Date.now(), words: 28, health: 100, missing: [] },
    ],
    pc_ngrams: { "write an email": { to: 4 }, "analyze the churn": { cohort: 3 } },
  },
  sync: { enabled: true, mode: "local" },
};

// --- Dashboard ---------------------------------------------------------------

await test("dashboard renders KPIs, trend, lab, and coach from seeded data", async () => {
  const { page, errors } = await openPage("dashboard/dashboard.html", SEED);
  assert.equal(await page.locator("#acceptRate").textContent(), "25%", "acceptance rate = 10/40");
  assert.equal(await page.locator("#shown").textContent(), "40");
  assert.equal((await page.locator("#learned").textContent()).trim(), "2");
  assert.ok((await page.locator("#trend path.line").count()) > 0, "trend line should render");
  assert.ok((await page.locator("#lab tbody tr").count()) === 2, "lab should list both experiments");
  const coach = await page.locator("#coach").innerText();
  assert.ok(/Format|Specifics/.test(coach), `coach should name the most-skipped dimension: ${coach}`);
  const schema = await page.locator("#schema").textContent();
  const parsed = JSON.parse(schema);
  assert.equal(parsed.metrics.acceptance_rate, 0.25);
  assert.equal(errors.length, 0, `page errors: ${errors.join("; ")}`);
  await page.context().close();
});

await test("dashboard is stable with completely empty storage (first run)", async () => {
  const { page, errors } = await openPage("dashboard/dashboard.html", {});
  assert.equal(await page.locator("#acceptRate").textContent(), "—");
  assert.equal((await page.locator("#lab-empty").getAttribute("hidden")) !== null, false, "lab empty-state should show");
  assert.equal(errors.length, 0, `page errors: ${errors.join("; ")}`);
  await page.context().close();
});

// --- Options -----------------------------------------------------------------

await test("options: switching to AI mode reveals key settings and persists", async () => {
  const { page, errors } = await openPage("options/options.html", SEED);
  assert.ok(await page.locator("#ai-settings").isHidden(), "AI settings hidden in local mode");
  await page.check('input[name="mode"][value="ai"]');
  await page.waitForTimeout(300);
  assert.ok(await page.locator("#ai-settings").isVisible(), "AI settings should reveal");
  const saved = await page.evaluate(() => window.__pcStore.sync.mode);
  assert.equal(saved, "ai", "mode should persist to storage.sync");
  assert.equal(errors.length, 0, `page errors: ${errors.join("; ")}`);
  await page.context().close();
});

// --- Popup -------------------------------------------------------------------

await test("popup: toggles persist and links navigate", async () => {
  const { page, errors } = await openPage("popup/popup.html", SEED);
  assert.ok(await page.locator('.mode[data-mode="local"]').evaluate((el) => el.classList.contains("active")));
  await page.click('.mode[data-mode="ai"]');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__pcStore.sync.mode), "ai");
  await page.click("#enabled");
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__pcStore.sync.enabled), false);
  await page.click("#open-dashboard");
  const opened = await page.evaluate(() => window.__pcOpened);
  assert.ok(String(opened).includes("dashboard"), `dashboard link should navigate, got ${opened}`);
  assert.equal(errors.length, 0, `page errors: ${errors.join("; ")}`);
  await page.context().close();
});

await browser.close();
console.log(failed === 0 ? "\nAll page tests passed." : `\n${failed} page test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
