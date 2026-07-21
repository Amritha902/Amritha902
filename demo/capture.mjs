/*
 * Drives demo/composer.html with the real extension scripts and captures
 * screenshots of the headline features:
 *
 *   1-ghost.png     — inline ghost text at the caret (template tier)
 *   2-accepted.png  — after Tab: suggestion accepted, health ring updated
 *   3-personal.png  — ghost from the personal model (trained in-page)
 *   4-palette.png   — the "/" scaffold palette
 *   5-health.png    — health ring + best-practice breakdown panel
 *
 * Usage:  NODE_PATH=$(npm root -g) node demo/capture.mjs
 */
// Resolve playwright: local node_modules first (CI), then the global install.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
const require_ = createRequire(import.meta.url);
function loadPlaywright() {
  for (const spec of [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
    "/opt/node22/lib/node_modules/playwright",
  ]) {
    if (!spec) continue;
    try {
      return require_(spec);
    } catch (_) {
      /* try next */
    }
  }
  throw new Error("playwright not found — npm i playwright, or set PLAYWRIGHT_PATH");
}
const { chromium } = loadPlaywright();

// Pre-provisioned browser if present (this sandbox); default download in CI.
export const launchOpts = existsSync("/opt/pw-browsers/chromium")
  ? { executablePath: "/opt/pw-browsers/chromium" }
  : {};
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "shots");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await page.goto("file://" + join(here, "composer.html"));

const input = page.locator(".input");
const ghost = page.locator(".pc-ghost");

async function clearComposer() {
  await input.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(300);
}

// --- 1. Ghost text from the curated template tier -------------------------
await input.click();
await page.keyboard.type("write an email", { delay: 40 });
await page.waitForSelector(".pc-ghost", { state: "visible", timeout: 5000 });
await page.waitForTimeout(250);
await page.screenshot({ path: join(outDir, "1-ghost.png") });
console.log("ghost text:", JSON.stringify(await ghost.textContent()));

// --- 2. Tab to accept ------------------------------------------------------
await page.keyboard.press("Tab");
await page.waitForTimeout(600);
await page.screenshot({ path: join(outDir, "2-accepted.png") });
console.log("after Tab:", JSON.stringify(await input.innerText()));

// --- 3. Personal-model ghost (train in-page, then type the lead-in) --------
await page.evaluate(async () => {
  const p = "analyze the sales dataset and plot the monthly revenue trend by region";
  for (let i = 0; i < 4; i++) await window.PromptComplete.learn(p);
});
await clearComposer();
await page.keyboard.type("analyze the sales dataset and ", { delay: 40 });
await page.waitForSelector(".pc-ghost", { state: "visible", timeout: 5000 });
await page.waitForTimeout(250);
await page.screenshot({ path: join(outDir, "3-personal.png") });
console.log("personal ghost:", JSON.stringify(await ghost.textContent()));

// --- 4. "/" scaffold palette ----------------------------------------------
await clearComposer();
await page.keyboard.type("/", { delay: 40 });
await page.waitForSelector(".pc-palette", { state: "visible", timeout: 5000 });
await page.waitForTimeout(250);
await page.screenshot({ path: join(outDir, "4-palette.png") });
await page.keyboard.press("Escape");

// --- 5. Health ring + panel ------------------------------------------------
await clearComposer();
await page.keyboard.type(
  "You are a career coach. Rewrite my resume summary for a data science internship. " +
    "Context: I am a third-year student with two ML projects. " +
    "Return three bullet points under 20 words each.",
  { delay: 12 }
);
await page.waitForSelector(".pc-ring", { state: "visible", timeout: 5000 });
const ring = page.locator(".pc-ring");
await ring.click(); // opens the best-practice breakdown panel
await page.waitForSelector(".pc-panel", { state: "visible", timeout: 5000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, "5-health.png") });
console.log("health score:", JSON.stringify(await page.locator(".pc-ring-num").textContent()));
await page.keyboard.press("Escape");

// --- 6/7. Intent Compiler before/after -------------------------------------
// (Demo harness returns a canned, representative rewrite — the real
// extension calls Claude Sonnet here.)
await clearComposer();
await page.keyboard.type("fix my resume idk make it good", { delay: 30 });
await page.waitForSelector(".pc-ring", { state: "visible", timeout: 5000 });
await ring.click();
await page.waitForSelector(".pc-panel", { state: "visible", timeout: 5000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, "6-draft.png") });
console.log("draft health:", JSON.stringify(await page.locator(".pc-ring-num").textContent()));

await page.click(".pc-compile");
await page.waitForFunction(
  () => document.querySelector(".input").innerText.includes("resume coach"),
  { timeout: 5000 }
);
await page.waitForTimeout(500);
await page.screenshot({ path: join(outDir, "7-compiled.png") });
console.log("compiled health:", JSON.stringify(await page.locator(".pc-ring-num").textContent()));

await browser.close();
console.log("done → demo/shots/");
