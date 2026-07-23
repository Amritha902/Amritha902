/*
 * PromptComplete — real-dataset EDA over how people actually open prompts.
 *
 * Dataset: f/awesome-chatgpt-prompts (CC0), a community corpus of real
 * assistant prompts.
 *   https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv
 *
 * Questions this answers with data (not vibes):
 *   1. What are the most common lead-in phrases (first 3 words)?
 *   2. What share of real prompts open with a lead-in our template/IR tiers
 *      recognize?
 *
 *   node tools/analyze-prompts.mjs [path-to-downloaded-csv]
 */
import { readFileSync, existsSync } from "node:fs";

const SOURCE_URL =
  "https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv";

async function loadCsv(localPath) {
  if (localPath && existsSync(localPath)) return readFileSync(localPath, "utf8");
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`dataset fetch failed: HTTP ${res.status}`);
  return res.text();
}

/** Minimal RFC-4180 CSV parser (quoted fields may span lines). */
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

// Lead-ins the shipped tiers recognize (regex fast-path triggers plus the
// paraphrase openers the vector-space tier is built for).
const KNOWN_OPENERS = [
  /^i want you to act as/,
  /^act as/,
  /^you are/,
  /^imagine you are/,
  /^write/,
  /^explain/,
  /^summarize/,
  /^translate/,
  /^help me/,
  /^i want/,
  /^i need/,
  /^tell me/,
  /^can you/,
  /^please/,
  /^create/,
  /^generate/,
  /^give me/,
  /^fix/,
  /^review/,
  /^analyze/,
  /^make/,
  /^suggest/,
];

const rows = parseCsv(await loadCsv(process.argv[2]));
const header = rows.shift();
const pi = header.indexOf("prompt");
const prompts = rows.map((r) => (r[pi] || "").trim()).filter((p) => p.length > 10);

const leadCounts = new Map();
let covered = 0;
for (const p of prompts) {
  const norm = p.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  const lead3 = norm.split(" ").slice(0, 3).join(" ");
  leadCounts.set(lead3, (leadCounts.get(lead3) || 0) + 1);
  if (KNOWN_OPENERS.some((re) => re.test(norm))) covered++;
}

const top = [...leadCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`prompts analyzed: ${prompts.length}`);
console.log(`\ntop lead-ins (first 3 words):`);
for (const [lead, n] of top) {
  console.log(`  ${String(n).padStart(5)}  ${(100 * n / prompts.length).toFixed(1).padStart(5)}%  "${lead}"`);
}
console.log(
  `\ncoverage: ${covered}/${prompts.length} (${(100 * covered / prompts.length).toFixed(1)}%) ` +
    `of real prompts open with a lead-in the template/IR tiers recognize`
);
