/*
 * Records the cinematic hero GIF for the README: the camera ZOOMS into the
 * composer while typing, the ghost suggestion appears, a "Tab ⇥" key badge
 * pops, and the text autofills — then the "/" palette scene, and an end card.
 *
 * Pipeline: Playwright video → PNG frames (ffmpeg) → animated GIF assembled
 * by our dependency-free GIF89a encoder (tools/gif.mjs).
 *
 * Usage:  node demo/record.mjs     → demo/shots/hero.gif
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
const vidDir = join(here, ".video");
mkdirSync(outDir, { recursive: true });
rmSync(vidDir, { recursive: true, force: true });

const FFMPEG = [
  process.env.FFMPEG_PATH,
  "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux",
  "ffmpeg",
].find((p) => p && (p === "ffmpeg" || existsSync(p)));

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

// --- In-page cinematography helpers ---------------------------------------
await page.evaluate(() => {
  // The "camera": animate the non-standard-but-Chrome `zoom` property with an
  // eased rAF tween, scroll-correcting each frame to keep the composer
  // centered. Unlike transform:scale, zoom does NOT create a containing
  // block, so the extension's position:fixed ghost/ring keep true viewport
  // coordinates.
  const composer = document.querySelector(".composer");
  window.__cam = (target, ms) => {
    const start = performance.now();
    const from = parseFloat(document.body.style.zoom || "1");
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    return new Promise((done) => {
      (function frame(now) {
        const t = Math.min(1, (now - start) / ms);
        document.body.style.zoom = String(from + (target - from) * ease(t));
        const r = composer.getBoundingClientRect();
        window.scrollBy(r.left + r.width / 2 - innerWidth / 2, r.top + r.height / 2 - innerHeight * 0.55);
        t < 1 ? requestAnimationFrame(frame) : done();
      })(performance.now());
    });
  };

  // Overlays (.pc-ghost, .pc-palette, our badge) live inside the zoomed body,
  // so their viewport-px left/top get re-scaled by the zoom — divide them
  // back out once they're rendered. Demo-only correction; the real extension
  // never runs inside a zoomed page.
  window.__fixOverlay = (selector) => {
    const z = parseFloat(document.body.style.zoom || "1");
    const el = document.querySelector(selector);
    if (!el || z === 1) return;
    el.style.left = parseFloat(el.style.left) / z + "px";
    el.style.top = parseFloat(el.style.top) / z + "px";
  };

  // The "Tab ⇥" key badge that pops beside the ghost when accepting.
  const badge = document.createElement("div");
  badge.id = "tab-badge";
  badge.textContent = "Tab ⇥";
  badge.style.cssText =
    "position:fixed;z-index:2147483647;background:#3d3929;color:#fdfcfa;" +
    "font:700 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "padding:9px 14px;border-radius:9px;box-shadow:0 6px 18px rgba(60,50,40,.3);" +
    "opacity:0;transform:scale(.6);transition:opacity .18s,transform .18s;pointer-events:none;";
  document.body.appendChild(badge);
  window.__tabBadge = (show) => {
    if (show) {
      const g = document.querySelector(".pc-ghost");
      const r = g && g.style.display !== "none" ? g.getBoundingClientRect() : composer.getBoundingClientRect();
      badge.style.left = Math.min(r.left + 40, innerWidth - 90) + "px";
      badge.style.top = r.top + 30 + "px";
      badge.style.opacity = "1";
      badge.style.transform = "scale(1)";
    } else {
      badge.style.opacity = "0";
      badge.style.transform = "scale(.6)";
    }
  };

  // End card overlay.
  window.__endCard = () => {
    const card = document.createElement("div");
    card.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:center;background:#f0eee5;opacity:0;transition:opacity .5s;";
    card.innerHTML =
      '<div style="font:500 44px/1.2 Georgia,serif;color:#3d3929">' +
      '<span style="color:#cc785c">✳</span> PromptComplete</div>' +
      '<div style="font:400 19px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;color:#6f6a62;margin-top:14px">' +
      "Finish your thought. Press <b style=\"color:#cc785c\">Tab</b>.</div>";
    document.body.appendChild(card);
    requestAnimationFrame(() => (card.style.opacity = "1"));
  };
});

const cam = (s, ms) => page.evaluate(([t, d]) => window.__cam(t, d), [s, ms]);
const tabBadge = (on) => page.evaluate((v) => window.__tabBadge(v), on);

// --- Scene 1: type → ZOOM IN → ghost → Tab badge → autofill ----------------
await input.click();
const zoomIn = cam(1.55, 1500); // camera pushes in while the words appear
await page.keyboard.type("write an email", { delay: 95 });
await zoomIn;
await page.waitForSelector(".pc-ghost", { state: "visible", timeout: 5000 });
await page.evaluate(() => window.__fixOverlay(".pc-ghost"));
await page.waitForTimeout(900); // let the viewer read the ghost
await tabBadge(true);
await page.evaluate(() => window.__fixOverlay("#tab-badge"));
await page.waitForTimeout(750);
await page.keyboard.press("Tab"); // autofill!
await tabBadge(false);
await page.waitForTimeout(1500);

// --- Scene 2: pull back → "/" palette → scaffold drops in ------------------
await cam(1.15, 900);
await page.keyboard.press("Control+a");
await page.keyboard.press("Delete");
await page.waitForTimeout(350);
await page.keyboard.type("/", { delay: 90 });
await page.waitForSelector(".pc-palette", { state: "visible", timeout: 5000 });
await page.evaluate(() => window.__fixOverlay(".pc-palette"));
await page.waitForTimeout(800);
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(450);
await page.keyboard.press("Enter"); // scaffold with {{placeholders}} drops in
await page.waitForTimeout(1500);

// --- End card ---------------------------------------------------------------
await cam(1.0, 700);
await page.evaluate(() => window.__endCard());
await page.waitForTimeout(1900);

await ctx.close();
await browser.close();

// --- Encode ------------------------------------------------------------------
const webm = readdirSync(vidDir).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no video produced");
const webmPath = join(vidDir, webm);

if (!FFMPEG) {
  renameSync(webmPath, join(outDir, "hero.webm"));
  console.log("ffmpeg not found — kept hero.webm instead of GIF");
} else {
  const framesDir = join(vidDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  execFileSync(FFMPEG, ["-y", "-i", webmPath, "-vf", "scale=880:-2", "-r", "9", join(framesDir, "%04d.png")], {
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
  const gif = encodeGif(frames, { delayCs: 11 }); // ~9fps playback
  writeFileSync(join(outDir, "hero.gif"), gif);
  console.log(`wrote demo/shots/hero.gif (${frames.length} frames, ${(gif.length / 1024).toFixed(0)} KB)`);
}
rmSync(vidDir, { recursive: true, force: true });
