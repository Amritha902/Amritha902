/*
 * Records the hero GIF for the README: type → ghost text → Tab accept,
 * then the "/" palette, in the Claude-style demo composer.
 *
 * Produces demo/shots/hero.gif via Playwright video capture + ffmpeg
 * (palette-optimized two-pass GIF encode).
 *
 * Usage:  node demo/record.mjs
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
await page.waitForTimeout(600);

const input = page.locator(".input");

// Scene 1: ghost text + Tab accept.
await input.click();
await page.keyboard.type("write an email", { delay: 90 });
await page.waitForSelector(".pc-ghost", { state: "visible", timeout: 5000 });
await page.waitForTimeout(1100); // let the viewer read the ghost
await page.keyboard.press("Tab");
await page.waitForTimeout(1400);

// Scene 2: the "/" palette.
await page.keyboard.press("Control+a");
await page.keyboard.press("Delete");
await page.waitForTimeout(500);
await page.keyboard.type("/", { delay: 90 });
await page.waitForSelector(".pc-palette", { state: "visible", timeout: 5000 });
await page.waitForTimeout(700);
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(450);
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(900);

await ctx.close(); // flushes the video
await browser.close();

const webm = readdirSync(vidDir).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no video produced");
const webmPath = join(vidDir, webm);

if (!FFMPEG) {
  renameSync(webmPath, join(outDir, "hero.webm"));
  console.log("ffmpeg not found — kept hero.webm instead of GIF");
} else {
  // Playwright's ffmpeg is a minimal build (no palettegen / GIF muxer), so:
  // extract downscaled PNG frames, then assemble the GIF with our own
  // dependency-free encoder (tools/gif.mjs).
  const framesDir = join(vidDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  execFileSync(FFMPEG, [
    "-y", "-i", webmPath,
    "-vf", "scale=880:-2",
    "-r", "8",
    join(framesDir, "%04d.png"),
  ]);
  const { encodeGif, pngDecode } = await import("../tools/gif.mjs");
  const { readFileSync, writeFileSync } = await import("node:fs");
  let frames = readdirSync(framesDir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => readFileSync(join(framesDir, f)));
  // Drop the leading pre-paint frames (pure white; the composer canvas is
  // cream), so the GIF opens on content.
  const isBlank = (buf) => {
    const { rgb } = pngDecode(buf);
    return rgb[0] > 250 && rgb[1] > 250 && rgb[2] > 250;
  };
  while (frames.length > 1 && isBlank(frames[0])) frames = frames.slice(1);
  const gif = encodeGif(frames, { delayCs: 12 }); // ~8fps playback
  writeFileSync(join(outDir, "hero.gif"), gif);
  console.log(`wrote demo/shots/hero.gif (${frames.length} frames, ${(gif.length / 1024).toFixed(0)} KB)`);
}
rmSync(vidDir, { recursive: true, force: true });
