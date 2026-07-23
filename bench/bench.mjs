/*
 * PromptComplete — HONEST measurement harness
 *
 *   node bench/bench.mjs
 *
 * Measures the algorithmic core against the baselines it replaced, with the
 * guardrails that make a benchmark trustworthy rather than flattering:
 *
 *   - Deterministic workloads. A seeded LCG drives every sample and every
 *     synthetic typo — no Math.random, no Date.now seeding — so two runs of
 *     this file produce the same queries and the numbers are comparable
 *     across commits.
 *   - Correctness verified INSIDE the benchmark. Section 1 cross-checks the
 *     trie against the linear scan on every single query (by rank, so ties
 *     between equally-ranked spellings don't count as failures). A fast
 *     wrong answer is worthless; the mismatch count must be 0.
 *   - Accuracy reported NEXT TO speed. Section 2 shows top-1 correction
 *     accuracy for both the Norvig baseline and the BK-tree side by side —
 *     a speedup that traded away accuracy would be visible immediately.
 *   - Real data where it matters. Sections 3–4 run on the actual
 *     awesome-chatgpt-prompts corpus (the same CSV tools/analyze-prompts.mjs
 *     studies), not on synthetic sentences that flatter the model.
 *   - Wall-clock honesty: process.hrtime.bigint() per operation, warm-up
 *     before measurement, and the timer overhead lands on both sides of
 *     every comparison equally.
 *
 * The modules under test are the shipping browser scripts; they are loaded
 * exactly the way the test suite loads them (globalThis.window = {} + eval),
 * so this measures the code that actually runs in the extension.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH =
  "/tmp/claude-0/-home-user-Amritha902/dfe86c35-21f7-500a-bc44-dce5b84adffc/scratchpad/prompts.csv";

// --- Extension-shaped environment (mirrors tests/model.test.mjs) ------------
let store = {};
globalThis.window = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (typeof k === "string" ? { [k]: store[k] } : { ...store }),
      set: async (obj) => Object.assign(store, obj),
    },
  },
  runtime: { sendMessage: (_m, cb) => cb && cb(null), lastError: null },
};
for (const f of ["lexicon", "trie", "bktree", "repair", "templates", "suggest", "health"]) {
  // eslint-disable-next-line no-eval
  eval(readFileSync(join(root, "src", `${f}.js`), "utf8"));
}
const WORDS = window.PromptWords;
const PC = window.PromptComplete;

// --- Deterministic randomness -----------------------------------------------
// Numerical Recipes LCG. A constant seed (not Date.now) keeps every run's
// workload byte-identical, which is the whole point of benchmarking twice.
const SEED = 0xc0ffee;
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- Small stats + printing helpers -----------------------------------------
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
const usFmt = (ns) => (ns / 1000).toFixed(2);

/**
 * Time `fn` over `queries`, one hrtime.bigint() bracket per op. Warm-up runs
 * first (JIT + caches) and is discarded. Returns per-op ns percentiles and
 * throughput. Timer overhead (~two hrtime calls) is inside every sample for
 * every contender — comparisons stay fair even if absolute numbers carry it.
 */
function bench(fn, queries, warmup) {
  for (let i = 0; i < warmup; i++) fn(queries[i % queries.length]);
  const times = new Array(queries.length);
  let total = 0;
  for (let i = 0; i < queries.length; i++) {
    const a = process.hrtime.bigint();
    fn(queries[i]);
    const b = process.hrtime.bigint();
    const ns = Number(b - a);
    times[i] = ns;
    total += ns;
  }
  times.sort((x, y) => x - y);
  return {
    ops: queries.length,
    opsPerSec: Math.round((1e9 * queries.length) / total),
    p50us: +usFmt(pct(times, 0.5)),
    p95us: +usFmt(pct(times, 0.95)),
    totalMs: +(total / 1e6).toFixed(1),
  };
}

function table(headers, rows) {
  const all = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, c) => Math.max(...all.map((r) => r[c].length)));
  const fmt = (r) =>
    "  " + r.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c]))).join("  ");
  console.log(fmt(all[0]));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of all.slice(1)) console.log(fmt(r));
}

const summary = { seed: SEED, lexiconSize: WORDS.length };
console.log(`PromptComplete honest benchmark — seed ${SEED}, lexicon ${WORDS.length} words\n`);

// ===========================================================================
// 1. PREFIX-COMPLETION LATENCY — linear scan vs trie
// ===========================================================================
{
  console.log("== 1. PREFIX-COMPLETION LATENCY (linear scan vs top-K trie) ==");

  // Same rank table repair.js builds: first occurrence of a word wins.
  const RANK = new Map();
  WORDS.forEach((w, i) => {
    if (!RANK.has(w)) RANK.set(w, i);
  });

  const tTrie = process.hrtime.bigint();
  const trie = window.PromptTrie.create(WORDS);
  const trieBuildMs = +(Number(process.hrtime.bigint() - tTrie) / 1e6).toFixed(1);

  // BASELINE — verbatim replication of the bestForPrefix loop in
  // src/repair.js (filter = null path), including its "the prefix already IS
  // the finished, more-frequent word" guard.
  function baselineBest(prefix) {
    if (prefix.length < 2) return null;
    let best = null;
    let bestRank = Infinity;
    for (const [w, rank] of RANK) {
      if (w.length >= prefix.length + 1 && w.startsWith(prefix) && rank < bestRank) {
        best = w;
        bestRank = rank;
      }
    }
    if (best && RANK.has(prefix) && RANK.get(prefix) < bestRank) return null;
    return best;
  }

  // TRIE — the index answers "best extension"; the finished-word guard is
  // caller policy in both worlds, so it is applied identically here. That
  // keeps this an apples-to-apples measurement of the same semantic op.
  function trieBest(prefix) {
    const b = trie.best(prefix, { minExtra: 1 });
    if (b && RANK.has(prefix) && RANK.get(prefix) < RANK.get(b)) return null;
    return b;
  }

  // Workload: 2000 seeded-sampled real lexicon words, prefixes of length 2..6.
  const rng = lcg(SEED);
  const pool = WORDS.filter((w) => w.length >= 2);
  const queries = [];
  for (let i = 0; i < 2000; i++) {
    const w = pool[(rng() * pool.length) | 0];
    for (let L = 2; L <= Math.min(6, w.length); L++) queries.push(w.slice(0, L));
  }

  // Correctness FIRST (untimed): the trie must agree with the linear scan on
  // every query. Ties in rank aside — equality is judged on rank, not string.
  let mismatches = 0;
  for (const q of queries) {
    const a = baselineBest(q);
    const b = trieBest(q);
    const ra = a === null ? -1 : RANK.get(a);
    const rb = b === null ? -1 : RANK.get(b);
    if (ra !== rb) mismatches++;
  }

  const base = bench(baselineBest, queries, 200);
  const fast = bench(trieBest, queries, 200);
  const speedup = +(fast.opsPerSec / base.opsPerSec).toFixed(1);

  table(
    ["method", "ops", "ops/sec", "p50 (µs)", "p95 (µs)", "total (ms)"],
    [
      ["linear scan (baseline)", base.ops, base.opsPerSec, base.p50us, base.p95us, base.totalMs],
      ["trie best()", fast.ops, fast.opsPerSec, fast.p50us, fast.p95us, fast.totalMs],
    ]
  );
  console.log(`  trie build: ${trieBuildMs} ms (once, at load)`);
  console.log(`  speedup: ${speedup}x   correctness mismatches: ${mismatches} (must be 0)\n`);
  if (mismatches !== 0) {
    console.error("FATAL: trie disagrees with the linear scan — benchmark void.");
    process.exit(1);
  }
  summary.prefixCompletion = { queries: queries.length, trieBuildMs, baseline: base, trie: fast, speedup, mismatches };
}

// ===========================================================================
// 2. SPELL-CORRECTION LATENCY + TOP-1 ACCURACY — Norvig edits vs BK-tree
// ===========================================================================
{
  console.log("== 2. SPELL-CORRECTION (Norvig edits1/2 vs BK-tree) — speed AND accuracy ==");

  const RANK = new Map();
  WORDS.forEach((w, i) => {
    if (!RANK.has(w)) RANK.set(w, i);
  });
  const LETTERS = "abcdefghijklmnopqrstuvwxyz";

  // BASELINE — replication of src/repair.js candidate generation: edits1,
  // then (only when nothing known at distance 1 and the word is long) a full
  // edits1-of-edits1 sweep; rank lookup picks the most frequent survivor.
  function edits1(word) {
    const out = new Set();
    for (let i = 0; i <= word.length; i++) {
      const L = word.slice(0, i);
      const R = word.slice(i);
      if (R) out.add(L + R.slice(1));
      if (R.length > 1) out.add(L + R[1] + R[0] + R.slice(2));
      for (const c of LETTERS) {
        if (R) out.add(L + c + R.slice(1));
        out.add(L + c + R);
      }
    }
    return out;
  }
  function norvigCorrect(w) {
    if (RANK.has(w)) return w;
    let best = null;
    let bestRank = Infinity;
    const consider = (c) => {
      const r = RANK.get(c);
      if (r !== undefined && r < bestRank) {
        best = c;
        bestRank = r;
      }
    };
    const e1 = edits1(w);
    for (const c of e1) consider(c);
    if (!best && w.length > 5) {
      for (const c of e1) for (const c2 of edits1(c)) consider(c2);
    }
    return best;
  }

  const tBk = process.hrtime.bigint();
  const bk = window.PromptBK.create(WORDS);
  const bkBuildMs = +(Number(process.hrtime.bigint() - tBk) / 1e6).toFixed(1);

  // BK-TREE — distance-1 query first; same conditional widening to 2 as the
  // baseline. query() returns (distance asc, rank asc), so [0] is top-1.
  function bkCorrect(w) {
    let res = bk.query(w, 1);
    if (!res.length && w.length > 5) res = bk.query(w, 2);
    return res.length ? res[0].w : null;
  }

  // Workload: seeded corruptions of real lexicon words (length >= 5) —
  // 500 single-edit typos + 250 double-edit typos. The original word is the
  // ground truth for top-1 accuracy.
  const rng = lcg(SEED + 1);
  const pool = WORDS.filter((w) => w.length >= 5 && /^[a-z]+$/.test(w));
  function oneEdit(w) {
    for (;;) {
      const op = (rng() * 4) | 0;
      let out;
      if (op === 0) {
        const i = (rng() * (w.length + 1)) | 0;
        out = w.slice(0, i) + LETTERS[(rng() * 26) | 0] + w.slice(i);
      } else if (op === 1) {
        const i = (rng() * w.length) | 0;
        out = w.slice(0, i) + w.slice(i + 1);
      } else if (op === 2) {
        const i = (rng() * w.length) | 0;
        out = w.slice(0, i) + LETTERS[(rng() * 26) | 0] + w.slice(i + 1);
      } else {
        const i = (rng() * (w.length - 1)) | 0;
        out = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
      }
      if (out !== w) return out;
    }
  }
  const cases = [];
  for (let i = 0; i < 500; i++) {
    const orig = pool[(rng() * pool.length) | 0];
    cases.push({ orig, corrupt: oneEdit(orig), edits: 1 });
  }
  for (let i = 0; i < 250; i++) {
    const orig = pool[(rng() * pool.length) | 0];
    let c;
    do c = oneEdit(oneEdit(orig));
    while (c === orig);
    cases.push({ orig, corrupt: c, edits: 2 });
  }
  const queries = cases.map((c) => c.corrupt);

  // Accuracy (untimed) — how often the top-ranked correction IS the word the
  // typo came from. Both methods graded against the same ground truth.
  const acc = (fn) => {
    let hit = 0;
    for (const c of cases) if (fn(c.corrupt) === c.orig) hit++;
    return +((100 * hit) / cases.length).toFixed(1);
  };
  const accBase = acc(norvigCorrect);
  const accBk = acc(bkCorrect);

  const base = bench(norvigCorrect, queries, 30);
  const fast = bench(bkCorrect, queries, 30);
  const speedup = +(fast.opsPerSec / base.opsPerSec).toFixed(1);

  table(
    ["method", "ops", "ops/sec", "p50 (µs)", "p95 (µs)", "total (ms)", "top-1 acc"],
    [
      ["Norvig edits1/2 (baseline)", base.ops, base.opsPerSec, base.p50us, base.p95us, base.totalMs, `${accBase}%`],
      ["BK-tree query d=1→2", fast.ops, fast.opsPerSec, fast.p50us, fast.p95us, fast.totalMs, `${accBk}%`],
    ]
  );
  console.log(`  bk-tree build: ${bkBuildMs} ms (once, at load)`);
  console.log(`  workload: 500 one-edit + 250 two-edit corruptions of lexicon words (len >= 5)`);
  console.log(`  speedup: ${speedup}x\n`);
  summary.spellCorrection = {
    cases: cases.length,
    bkBuildMs,
    baseline: { ...base, top1AccPct: accBase },
    bkTree: { ...fast, top1AccPct: accBk },
    speedup,
  };
}

// ===========================================================================
// Shared: the real prompt corpus (RFC-4180; quoted fields span lines)
// ===========================================================================
/** Minimal RFC-4180 parser — same approach as tools/analyze-prompts.mjs. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.length)) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((f) => f.length)) rows.push(row);
  }
  return rows;
}

const csvRows = parseCsv(readFileSync(CSV_PATH, "utf8"));
const header = csvRows.shift();
const pi = header.indexOf("prompt");
const allPrompts = csvRows.map((r) => (r[pi] || "").trim()).filter((p) => p.length > 10);

// Seeded sample of 400 prompts, shared by sections 3 and 4 (Fisher–Yates
// shuffle, take the head — sampling without replacement).
const rngSample = lcg(SEED + 2);
const idx = allPrompts.map((_, i) => i);
for (let i = idx.length - 1; i > 0; i--) {
  const j = (rngSample() * (i + 1)) | 0;
  [idx[i], idx[j]] = [idx[j], idx[i]];
}
const sampled = idx.slice(0, 400).map((i) => allPrompts[i]);

// ===========================================================================
// 3. WORD-COMPLETION ACCURACY on the real corpus
// ===========================================================================
{
  console.log("== 3. WORD-COMPLETION ACCURACY (dictionary trie vs real prompt corpus) ==");
  const trie = window.PromptTrie.create(WORDS);

  // For every corpus word (len >= 4, 30 words/prompt cap) and every proper
  // prefix (2..len-1), ask the dictionary for its best completion. A HIT
  // means the dictionary's single guess was EXACTLY the word being typed —
  // the strictest possible grading, no partial credit.
  const byLen = new Map(); // prefixLen bucket -> { att, hit }
  const bucket = (L) => (L >= 10 ? "10+" : String(L));
  let words = 0;
  let wordsWithHit = 0;
  let typedChars = 0;
  let savedChars = 0;

  for (const p of sampled) {
    const toks = (p.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length >= 4).slice(0, 30);
    for (const w of toks) {
      words++;
      typedChars += w.length;
      let firstHit = 0;
      for (let L = 2; L <= w.length - 1; L++) {
        const b = bucket(L);
        const cell = byLen.get(b) || { att: 0, hit: 0 };
        cell.att++;
        const c = trie.best(w.slice(0, L), { minExtra: 1 });
        if (c === w) {
          cell.hit++;
          if (!firstHit) firstHit = L;
        }
        byLen.set(b, cell);
      }
      if (firstHit) {
        wordsWithHit++;
        // Keystrokes the user would NOT have to type: everything past the
        // earliest prefix whose top suggestion already was this exact word.
        savedChars += w.length - firstHit;
      }
    }
  }

  const order = ["2", "3", "4", "5", "6", "7", "8", "9", "10+"];
  const rows = [];
  let attTot = 0;
  let hitTot = 0;
  for (const b of order) {
    const cell = byLen.get(b);
    if (!cell) continue;
    attTot += cell.att;
    hitTot += cell.hit;
    rows.push([`prefix len ${b}`, cell.att, cell.hit, `${((100 * cell.hit) / cell.att).toFixed(1)}%`]);
  }
  rows.push(["ALL", attTot, hitTot, `${((100 * hitTot) / attTot).toFixed(1)}%`]);
  table(["prefix", "attempts", "hits", "hit-rate"], rows);
  const savingsPct = +((100 * savedChars) / typedChars).toFixed(1);
  console.log(
    `  words tested: ${words} (from ${sampled.length} prompts)  completed at some prefix: ` +
      `${wordsWithHit} (${((100 * wordsWithHit) / words).toFixed(1)}%)`
  );
  console.log(
    `  potential keystroke savings: ${savedChars}/${typedChars} chars = ${savingsPct}%` +
      ` (earliest-hit simulation; misses type every char)\n`
  );
  summary.wordCompletion = {
    prompts: sampled.length,
    words,
    wordsWithHit,
    attempts: attTot,
    hits: hitTot,
    overallHitRatePct: +((100 * hitTot) / attTot).toFixed(1),
    byPrefixLen: Object.fromEntries(
      order.filter((b) => byLen.has(b)).map((b) => [b, +((100 * byLen.get(b).hit) / byLen.get(b).att).toFixed(1)])
    ),
    keystrokeSavingsPct: savingsPct,
  };
}

// ===========================================================================
// 4. NEXT-WORD PREDICTION — the personal model's precision/coverage gate
// ===========================================================================
{
  console.log("== 4. NEXT-WORD PREDICTION (personal model, 80/20 split of real prompts) ==");

  // Fresh model: wipe fake storage and in-memory caches, then learn the
  // training split exactly the way the extension does on submitted prompts.
  store = {};
  PC.reset();
  const train = sampled.slice(0, 320);
  const test = sampled.slice(320);
  const t0 = process.hrtime.bigint();
  for (const p of train) await PC.learn(p);
  const trainMs = +(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0);

  // Every held-out position >= 2 gets one prediction from the true prefix
  // (plus trailing space → phrase tiers, never mid-word completion). The
  // corpus median prompt is 138 tokens; positions are capped per prompt to
  // keep total runtime honest-but-bounded — the cap is disclosed below.
  const CAP = 80;
  const norm = (s) => s.toLowerCase().match(/[a-z0-9']+/g) || [];
  let positions = 0;
  let nonNull = 0;
  let hits = 0;
  // Honesty breakdown: getSuggestion is the full pipeline, so non-null output
  // includes leading-guidance fragments (they start with an em dash) that are
  // coaching, not next-word predictions. They are counted against precision
  // exactly as emitted — but reported separately so "coverage" can be read
  // for what it is: predictive emissions vs guidance emissions.
  let guidance = 0;
  let predHits = 0;
  const tq = process.hrtime.bigint();
  for (const p of test) {
    const toks = norm(p).slice(0, CAP);
    for (let i = 2; i < toks.length; i++) {
      positions++;
      const prefix = toks.slice(0, i).join(" ") + " ";
      const s = await PC.getSuggestion(prefix, { mode: "local" });
      if (s === null || s === undefined) continue;
      nonNull++;
      const isGuidance = /^\s*—/.test(s);
      if (isGuidance) guidance++;
      const first = s.trim().split(/\s+/)[0] || "";
      if (first.toLowerCase() === toks[i]) {
        hits++;
        if (!isGuidance) predHits++;
      }
    }
  }
  const predictMs = +(Number(process.hrtime.bigint() - tq) / 1e6).toFixed(0);

  const predictive = nonNull - guidance;
  const coverage = +((100 * nonNull) / positions).toFixed(1);
  const precision = nonNull ? +((100 * hits) / nonNull).toFixed(1) : 0;
  const predCoverage = +((100 * predictive) / positions).toFixed(1);
  const predPrecision = predictive ? +((100 * predHits) / predictive).toFixed(1) : 0;
  table(
    ["metric", "value"],
    [
      ["train / test prompts", `${train.length} / ${test.length}`],
      ["test positions (cap 80 tokens/prompt)", positions],
      ["suggestions emitted (non-null)", nonNull],
      ["coverage (non-null rate)", `${coverage}%`],
      ["first-token hits", hits],
      ["precision (hits / non-null)", `${precision}%`],
      ["  of which guidance fragments (— …)", `${guidance} (never a word hit by construction)`],
      ["  predictive-only coverage", `${predCoverage}% (${predictive} emissions)`],
      ["  predictive-only precision", `${predPrecision}% (${predHits} hits)`],
      ["train time", `${trainMs} ms`],
      ["predict time", `${predictMs} ms (${(predictMs / Math.max(1, positions)).toFixed(2)} ms/position)`],
    ]
  );
  console.log(
    "  Reading: on held-out strangers' prompts the n-gram gate emits a word prediction\n" +
      `  at only ${predCoverage}% of positions and is right ${predPrecision}% of the time it does — the rest of\n` +
      "  the pipeline's non-null output is guidance coaching, which can never match the\n" +
      "  next word. Personal-model value comes from a user's OWN repetition; this run\n" +
      "  quantifies the floor on unfamiliar text rather than a flattering ceiling.\n"
  );
  summary.nextWord = {
    trainPrompts: train.length,
    testPrompts: test.length,
    tokenCapPerPrompt: CAP,
    positions,
    nonNull,
    hits,
    coveragePct: coverage,
    precisionPct: precision,
    guidanceEmissions: guidance,
    predictiveCoveragePct: predCoverage,
    predictivePrecisionPct: predPrecision,
    trainMs,
    predictMs,
  };
}

console.log("== JSON ==");
console.log(JSON.stringify(summary));
