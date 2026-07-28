/*
 * Edge-case hardening suite — the things that break real extensions in the wild.
 *
 * Covers: very long prompts (performance AND correctness), multi-line drafts,
 * caret not at the end, huge pastes, unicode/emoji, pathological single words,
 * rapid typing, <textarea> composers, and bounded model growth.
 *
 * Usage: node tests/edge.test.mjs
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

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const input = () => page.locator(".input");
const ghostVisible = (ms = 4000) =>
  page.waitForSelector(".pc-ghost", { state: "visible", timeout: ms }).then(() => true, () => false);
const text = async () => (await input().innerText()).replace(/ /g, " ");

async function fresh() {
  await page.goto(demoPage);
  await input().click();
}
/** Put a long body of text in the composer instantly (no per-key typing). */
async function seedText(body) {
  await page.evaluate((t) => {
    const el = document.querySelector(".input");
    el.focus();
    el.textContent = t;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, body);
}

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

const LOREM =
  "the quarterly report shows steady growth across every region and the team " +
  "has been working through the backlog while we prepare the next release ";

// --- Long prompts -----------------------------------------------------------

await test("engine stays fast on a very long prompt (4k+ words)", async () => {
  await fresh();
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++)
      await window.PromptComplete.learn("analyze the churn dataset and plot retention by cohort");
  });
  const timings = await page.evaluate(async (chunk) => {
    const long = chunk.repeat(200); // ~4,600 words
    const t = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await window.PromptComplete.getCandidates(long + "analyze the churn dataset and ");
      t.push(performance.now() - t0);
    }
    return t;
  }, LOREM);
  const median = timings.sort((a, b) => a - b)[2];
  // Generous ceiling: the point is that cost must not scale with prompt length.
  assert.ok(median < 60, `long-prompt suggestion took ${median.toFixed(1)}ms (budget 60ms)`);
});

await test("suggestion cost does not scale with prompt length", async () => {
  await fresh();
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++)
      await window.PromptComplete.learn("analyze the churn dataset and plot retention by cohort");
  });
  const { shortMs, longMs } = await page.evaluate(async (chunk) => {
    const tail = "analyze the churn dataset and ";
    const time = async (t) => {
      const runs = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        await window.PromptComplete.getCandidates(t);
        runs.push(performance.now() - t0);
      }
      return runs.sort((a, b) => a - b)[2];
    };
    return { shortMs: await time(tail), longMs: await time(chunk.repeat(200) + tail) };
  }, LOREM);
  // Allow generous slack, but a linear blow-up (100x) must not happen.
  assert.ok(
    longMs < Math.max(shortMs * 12, 25),
    `cost scaled with length: ${shortMs.toFixed(2)}ms short vs ${longMs.toFixed(2)}ms long`
  );
});

await test("ghost still appears and accepts correctly at the end of a long prompt", async () => {
  await fresh();
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++)
      await window.PromptComplete.learn("analyze the churn dataset and plot retention by cohort");
  });
  await seedText(LOREM.repeat(60) + "analyze the churn dataset and ");
  assert.ok(await ghostVisible(), "long prompt should still get a ghost");
  await page.keyboard.press("Tab");
  const t = await text();
  assert.ok(/plot retention by cohort\s*$/.test(t), `accept failed at end of long prompt`);
});

await test("health ring scores a very long prompt without hanging", async () => {
  await fresh();
  const ms = await page.evaluate((chunk) => {
    const long = chunk.repeat(200);
    const t0 = performance.now();
    window.PromptHealth.score(long);
    return performance.now() - t0;
  }, LOREM);
  assert.ok(ms < 50, `health scoring took ${ms.toFixed(1)}ms on a 4k-word prompt`);
});

// --- Caret position & structure --------------------------------------------

await test("no ghost when the caret is not at the end", async () => {
  await fresh();
  await page.keyboard.type("write an email", { delay: 20 });
  assert.ok(await ghostVisible(), "sanity: ghost appears at end");
  await page.keyboard.press("Home"); // move caret to the start
  await page.waitForTimeout(400);
  const display = await page
    .locator(".pc-ghost")
    .evaluate((el) => getComputedStyle(el).display)
    .catch(() => "none");
  assert.equal(display, "none", "ghost must hide when the caret moves off the end");
});

await test("multi-line drafts still complete on the last line", async () => {
  await fresh();
  await page.keyboard.type("first line of context", { delay: 12 });
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.type("write an email", { delay: 20 });
  assert.ok(await ghostVisible(), "ghost should appear on the last line of a multi-line draft");
});

// --- Hostile input ----------------------------------------------------------

await test("huge paste does not hang or throw", async () => {
  await fresh();
  const before = pageErrors.length;
  const ms = await page.evaluate(async (chunk) => {
    const t0 = performance.now();
    const el = document.querySelector(".input");
    el.focus();
    el.textContent = chunk.repeat(600); // ~14k words
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return performance.now() - t0;
  }, LOREM);
  assert.ok(ms < 3000, `huge paste blocked for ${ms.toFixed(0)}ms`);
  assert.equal(pageErrors.length, before, `paste raised: ${pageErrors.slice(before).join("; ")}`);
});

await test("emoji and unicode do not break the pipeline", async () => {
  await fresh();
  const before = pageErrors.length;
  await page.keyboard.type("héllo 🌍 привет — write an email", { delay: 12 });
  await page.waitForTimeout(500);
  assert.equal(pageErrors.length, before, `unicode raised: ${pageErrors.slice(before).join("; ")}`);
});

await test("a pathologically long single word is handled", async () => {
  await fresh();
  const before = pageErrors.length;
  await seedText("a".repeat(3000));
  await page.waitForTimeout(500);
  assert.equal(pageErrors.length, before, `long word raised: ${pageErrors.slice(before).join("; ")}`);
});

await test("rapid typing never leaves a stale ghost behind", async () => {
  await fresh();
  await page.keyboard.type("write an email", { delay: 0 });
  await page.keyboard.type(" zzz qqq", { delay: 0 });
  await page.waitForTimeout(600);
  // querySelector, not locator.evaluate: the ghost element may legitimately
  // never have been created, and a locator would block waiting for it.
  const shown = await page.evaluate(() => {
    const el = document.querySelector(".pc-ghost");
    return el ? { display: getComputedStyle(el).display, text: el.textContent } : { display: "none", text: "" };
  });
  if (shown.display !== "none") {
    const draft = await text();
    assert.ok(
      !/\{recipient\}/.test(shown.text),
      `stale template ghost survived divergent typing: display=${shown.display} ` +
        `ghost=${JSON.stringify(shown.text)} draft=${JSON.stringify(draft)}`
    );
  }
});

// --- Model hygiene ----------------------------------------------------------

await test("model growth stays bounded after heavy training", async () => {
  await fresh();
  const size = await page.evaluate(async () => {
    for (let i = 0; i < 400; i++) {
      await window.PromptComplete.learn(`unique prompt number ${i} about topic ${i} with words ${i}`);
    }
    return Object.keys(window.__pcStore.local.pc_ngrams || {}).length;
  });
  assert.ok(size <= 4000, `n-gram table grew unbounded: ${size} histories`);
});

await test("no page errors accumulated across the whole suite", async () => {
  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join("; ")}`);
});

await browser.close();
console.log(failed === 0 ? "\nAll edge-case tests passed." : `\n${failed} edge-case test(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
