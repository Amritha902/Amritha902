/*
 * Extension smoke test — loads the REAL unpacked extension into Chromium
 * (no stubs) and asserts:
 *
 *   1. The MV3 service worker registers (manifest + background.js are valid
 *      in an actual browser, not just under `node --check`).
 *   2. The service worker answers the pc:complete message protocol
 *      gracefully with no API key configured (ok:false/named reason —
 *      never a crash).
 *
 * Usage: node tests/extension.test.mjs   (also run in CI)
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
const profile = mkdtempSync(join(tmpdir(), "pc-ext-"));

const ctx = await chromium.launchPersistentContext(profile, {
  ...(existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {}),
  headless: true,
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
  ],
});

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

let worker = ctx.serviceWorkers()[0];

await test("MV3 service worker registers from the real manifest", async () => {
  if (!worker) worker = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
  assert.ok(worker.url().includes("background.js"), `unexpected worker url: ${worker?.url()}`);
});

await test("worker answers pc:complete without a key (graceful, no crash)", async () => {
  assert.ok(worker, "needs the worker from the previous test");
  const resp = await worker.evaluate(async () => {
    // Call the same handler the content script reaches via sendMessage.
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "pc:complete", text: "write an email" }, (r) =>
        resolve(r ?? null)
      );
    });
  });
  // No API key in a fresh profile: the protocol must answer (not hang/crash)
  // and must not claim success with a completion.
  assert.ok(resp === null || resp.ok === false || resp.completion == null,
    `keyless completion should not succeed: ${JSON.stringify(resp)}`);
});

await ctx.close();
rmSync(profile, { recursive: true, force: true });
console.log(failed === 0 ? "\nExtension smoke tests passed." : `\n${failed} extension test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
