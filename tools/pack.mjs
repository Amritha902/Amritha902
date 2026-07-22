/*
 * Builds the Chrome Web Store package: dist/promptcomplete-<version>.zip
 *
 * Includes only what the extension ships (manifest, src, icons, popup,
 * options, dashboard) — never the demo harness, docs, tests, or tooling.
 *
 *   node tools/pack.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { zip } from "./zip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIP = ["manifest.json", "src", "icons", "popup", "options", "dashboard"];

function collect(path, out) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const f of readdirSync(path).sort()) collect(join(path, f), out);
  } else {
    out.push({
      name: relative(root, path).split("\\").join("/"),
      data: readFileSync(path),
    });
  }
  return out;
}

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const entries = SHIP.flatMap((p) => collect(join(root, p), []));

mkdirSync(join(root, "dist"), { recursive: true });
const outPath = join(root, "dist", `promptcomplete-${manifest.version}.zip`);
writeFileSync(outPath, zip(entries));

const kb = (statSync(outPath).size / 1024).toFixed(0);
console.log(`packed ${entries.length} files → dist/promptcomplete-${manifest.version}.zip (${kb} KB)`);
