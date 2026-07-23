/*
 * Records the REAL-COMPARISON GIF (demo/shots/compare.gif):
 *
 *   Scene A — WITHOUT: the full prompt typed by hand, every keystroke
 *             counted live by a real keydown listener.
 *   Scene B — WITH: the same prompt via trigger + Tab. Same counter.
 *   End card — the two real numbers side by side + the business line.
 *
 * The counts are measured, not scripted: a keydown listener increments on
 * actual key events, and the end card reads whatever the counter measured.
 *
 * Usage:  node demo/compare.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
const vidDir = join(here, ".video-cmp");
mkdirSync(outDir, { recursive: true });
rmSync(vidDir, { recursive: true, force: true });

const FFMPEG = [process.env.FFMPEG_PATH, "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux", "ffmpeg"].find(
  (p) => p && (p === "ffmpeg" || existsSync(p))
);

const browser = await chromium.launch(
  existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {}
);
const ctx = await browser.newContext({
  viewport: { width: 960, height: 600 },
  recordVideo: { dir: vidDir, size: { width: 960, height: 600 } },
});
const page = await ctx.newPage();
await page.goto("file://" + join(here, "composer.html"));
await page.waitForTimeout(700);

const input = page.locator(".input");

// --- Injected chrome: scene label + live keystroke counter ------------------
await page.evaluate(() => {
  const label = document.createElement("div");
  label.id = "scene-label";
  label.style.cssText =
    "position:fixed;top:26px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "font:700 21px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "color:#fdfcfa;background:#3d3929;padding:12px 26px;border-radius:999px;" +
    "box-shadow:0 6px 20px rgba(60,50,40,.25);opacity:0;transition:opacity .3s;";
  document.body.appendChild(label);
  window.__label = (html) => {
    label.style.opacity = "0";
    setTimeout(() => {
      label.innerHTML = html;
      label.style.opacity = html ? "1" : "0";
    }, 320);
  };

  const counter = document.createElement("div");
  counter.id = "key-counter";
  counter.style.cssText =
    "position:fixed;top:24px;right:26px;z-index:2147483647;text-align:center;" +
    "background:#fdfcfa;border:2px solid #cc785c;border-radius:14px;padding:10px 18px;" +
    "font:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "box-shadow:0 6px 18px rgba(60,50,40,.18);";
  counter.innerHTML =
    '<div id="kc-num" style="font:750 30px/1 inherit;color:#b8613f;font-variant-numeric:tabular-nums">0</div>' +
    '<div style="font:600 10.5px/1 inherit;color:#6f6a62;letter-spacing:.06em;margin-top:5px">KEYSTROKES</div>';
  document.body.appendChild(counter);

  // REAL counting: every physical keydown aimed at the composer increments —
  // including Tab. (Listen on document: the extension stopPropagation()s Tab
  // before it reaches element-level listeners, and honest means counting the
  // Tab press too.)
  window.__keys = 0;
  const composerEl = document.querySelector(".input");
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.target !== composerEl) return;
      window.__keys++;
      document.getElementById("kc-num").textContent = window.__keys;
    },
    true
  );
  window.__resetKeys = () => {
    window.__keys = 0;
    document.getElementById("kc-num").textContent = "0";
  };

  window.__endCard = (a, b) => {
    const pct = Math.round((1 - b / a) * 100);
    const card = document.createElement("div");
    card.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:center;gap:18px;background:#f0eee5;opacity:0;transition:opacity .5s;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;";
    card.innerHTML =
      '<div style="font:500 34px/1.2 Georgia,serif;color:#3d3929">Same prompt. Really counted.</div>' +
      '<div style="display:flex;gap:26px;align-items:center">' +
      `<div style="background:#fdfcfa;border:1px solid #e3dfd3;border-radius:16px;padding:20px 30px">` +
      `<div style="font:750 44px/1 inherit;color:#6f6a62">${a}</div>` +
      '<div style="font:600 12px/1 inherit;color:#6f6a62;margin-top:8px">KEYSTROKES TYPED</div></div>' +
      '<div style="font:700 26px/1 inherit;color:#cc785c">→</div>' +
      `<div style="background:#fdfcfa;border:2px solid #cc785c;border-radius:16px;padding:20px 30px">` +
      `<div style="font:750 44px/1 inherit;color:#b8613f">${b}</div>` +
      '<div style="font:600 12px/1 inherit;color:#6f6a62;margin-top:8px">WITH PROMPTCOMPLETE</div></div></div>' +
      `<div style="font:650 20px/1.4 inherit;color:#3d3929">${pct}% less typing — and a structured prompt<br>` +
      '<span style="font-weight:400;color:#6f6a62;font-size:16px">that lands right the first time: fewer retry round-trips, fewer wasted tokens.</span></div>';
    document.body.appendChild(card);
    requestAnimationFrame(() => (card.style.opacity = "1"));
  };
});

const label = (h) => page.evaluate((v) => window.__label(v), h);

// The identical final text for both scenes — the comparison is honest.
const FULL = "write an email to {recipient} about {topic}. Keep it concise and professional.";

// --- Scene A: WITHOUT ---------------------------------------------------------
await label("WITHOUT — typing it all by hand");
await input.click();
await page.keyboard.type(FULL, { delay: 34 });
await page.waitForTimeout(1400);
const withoutKeys = await page.evaluate(() => window.__keys);

// --- Scene B: WITH ------------------------------------------------------------
await label("WITH PromptComplete — type the start, press Tab");
await page.keyboard.press("Control+a");
await page.keyboard.press("Delete");
await page.evaluate(() => window.__resetKeys());
await page.waitForTimeout(500);
await page.keyboard.type("write an email", { delay: 95 });
await page.waitForSelector(".pc-ghost", { state: "visible", timeout: 5000 });
await page.waitForTimeout(1000);
await page.keyboard.press("Tab"); // autofill
await page.waitForTimeout(1500);
const withKeys = await page.evaluate(() => window.__keys);

// --- End card with the two REAL numbers --------------------------------------
await label("");
await page.evaluate(([a, b]) => window.__endCard(a, b), [withoutKeys, withKeys]);
await page.waitForTimeout(2600);

await ctx.close();
await browser.close();
console.log(`measured: without=${withoutKeys} with=${withKeys}`);

// --- Encode -------------------------------------------------------------------
const webm = readdirSync(vidDir).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no video produced");
const webmPath = join(vidDir, webm);
if (!FFMPEG) {
  renameSync(webmPath, join(outDir, "compare.webm"));
} else {
  const framesDir = join(vidDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  execFileSync(FFMPEG, ["-y", "-i", webmPath, "-vf", "scale=820:-2", "-r", "9", join(framesDir, "%04d.png")], {
    stdio: "pipe",
  });
  const { encodeGif, pngDecode } = await import("../tools/gif.mjs");
  const { readFileSync, writeFileSync } = await import("node:fs");
  let frames = readdirSync(framesDir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => readFileSync(join(framesDir, f)));
  const isBlank = (buf) => {
    const { rgb } = pngDecode(buf);
    return rgb[0] > 250 && rgb[1] > 250 && rgb[2] > 250;
  };
  while (frames.length > 1 && isBlank(frames[0])) frames = frames.slice(1);
  const gif = encodeGif(frames, { delayCs: 11 });
  writeFileSync(join(outDir, "compare.gif"), gif);
  console.log(`wrote demo/shots/compare.gif (${frames.length} frames, ${(gif.length / 1024).toFixed(0)} KB)`);
}
rmSync(vidDir, { recursive: true, force: true });
