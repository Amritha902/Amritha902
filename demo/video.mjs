/*
 * Records the full product-tour VIDEO (demo/shots/tour.webm): every headline
 * feature in one continuous take, with on-screen captions.
 *
 *   Scene 1  Ghost text → Tab accept
 *   Scene 2  Personal model (learns YOUR phrasing, on-device)
 *   Scene 3  "/" scaffold palette + placeholder jumping
 *   Scene 4  Prompt Health ring + breakdown panel
 *   Scene 5  Intent Compiler: rough draft → structured prompt
 *
 * Usage:  node demo/video.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
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
const outDir = join(here, "shots");
const vidDir = join(here, ".video");
mkdirSync(outDir, { recursive: true });
rmSync(vidDir, { recursive: true, force: true });

const browser = await chromium.launch(
  existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {}
);
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 660 },
  recordVideo: { dir: vidDir, size: { width: 1100, height: 660 } },
});
const page = await ctx.newPage();
await page.goto("file://" + join(here, "composer.html"));
await page.waitForTimeout(800);

const input = page.locator(".input");

// --- Caption bar -----------------------------------------------------------
await page.evaluate(() => {
  const cap = document.createElement("div");
  cap.id = "pc-caption";
  cap.style.cssText =
    "position:fixed;left:50%;bottom:48px;transform:translateX(-50%);" +
    "background:#3d3929;color:#fdfcfa;padding:10px 22px;border-radius:999px;" +
    "font:600 16px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "box-shadow:0 6px 20px rgba(60,50,40,.25);opacity:0;transition:opacity .35s;" +
    "z-index:2147483647;max-width:80vw;text-align:center;pointer-events:none;";
  document.body.appendChild(cap);
});
async function caption(text) {
  await page.evaluate((t) => {
    const cap = document.getElementById("pc-caption");
    cap.style.opacity = "0";
    setTimeout(() => {
      cap.textContent = t;
      cap.style.opacity = t ? "1" : "0";
    }, 360);
  }, text);
  await page.waitForTimeout(700);
}
async function clearComposer() {
  await input.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(400);
}

// --- Scene 1: ghost text → Tab --------------------------------------------
await caption("Ghost-text autocomplete — press Tab to accept");
await input.click();
await page.keyboard.type("write an email", { delay: 95 });
await page.waitForSelector(".pc-ghost", { state: "visible", timeout: 5000 });
await page.waitForTimeout(1300);
await page.keyboard.press("Tab");
await page.waitForTimeout(1600);

// --- Scene 2: personal model -----------------------------------------------
await caption("It learns YOUR phrasing — a private, on-device model");
await page.evaluate(async () => {
  const p = "analyze the sales dataset and plot the monthly revenue trend by region";
  for (let i = 0; i < 4; i++) await window.PromptComplete.learn(p);
});
await clearComposer();
await page.keyboard.type("analyze the sales dataset and ", { delay: 85 });
await page.waitForSelector(".pc-ghost", { state: "visible", timeout: 5000 });
await page.waitForTimeout(1400);
await page.keyboard.press("Tab");
await page.waitForTimeout(1500);

// --- Scene 3: "/" palette --------------------------------------------------
await caption("Type / for 16 curated prompt scaffolds");
await clearComposer();
await page.keyboard.type("/", { delay: 90 });
await page.waitForSelector(".pc-palette", { state: "visible", timeout: 5000 });
await page.waitForTimeout(900);
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(500);
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(700);
await page.keyboard.press("Enter"); // insert the scaffold
await page.waitForTimeout(1200);
await caption("Tab jumps between {{placeholders}}");
await page.keyboard.press("Tab");
await page.waitForTimeout(900);
await page.keyboard.press("Tab");
await page.waitForTimeout(1300);

// --- Scene 4: health ring --------------------------------------------------
await caption("A live Prompt Health score, as you write");
await clearComposer();
await page.keyboard.type(
  "You are a career coach. Rewrite my resume summary for a data science internship. " +
    "Context: third-year student, two ML projects. Return three bullets under 20 words each.",
  { delay: 18 }
);
await page.waitForSelector(".pc-ring", { state: "visible", timeout: 5000 });
await page.waitForTimeout(800);
await page.locator(".pc-ring").click();
await page.waitForSelector(".pc-panel", { state: "visible", timeout: 5000 });
await page.waitForTimeout(1800);
await page.keyboard.press("Escape");

// --- Scene 5: Intent Compiler ----------------------------------------------
await caption("Rough draft? One click compiles it into a structured prompt");
await clearComposer();
await page.keyboard.type("fix my resume idk make it good", { delay: 75 });
await page.waitForSelector(".pc-ring", { state: "visible", timeout: 5000 });
await page.waitForTimeout(600);
await page.locator(".pc-ring").click();
await page.waitForSelector(".pc-panel", { state: "visible", timeout: 5000 });
await page.waitForTimeout(1400);
await page.click(".pc-compile");
await page.waitForFunction(
  () => document.querySelector(".input").innerText.includes("resume coach"),
  { timeout: 5000 }
);
await page.waitForTimeout(2200);

// --- Outro -------------------------------------------------------------
await caption("PromptComplete — the prompt box, upgraded. Claude-first.");
await page.waitForTimeout(2400);
await caption("");
await page.waitForTimeout(500);

await ctx.close();
await browser.close();

const webm = readdirSync(vidDir).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no video produced");
renameSync(join(vidDir, webm), join(outDir, "tour.webm"));
rmSync(vidDir, { recursive: true, force: true });
console.log("wrote demo/shots/tour.webm");
