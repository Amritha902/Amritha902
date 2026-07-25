/* PromptComplete — options page logic */

const DEFAULTS = {
  enabled: true,
  mode: "local",
  apiKey: "",
  model: "claude-haiku-4-5",
  improveModel: "claude-sonnet-5",
};

const $ = (id) => document.getElementById(id);
const enabled = $("enabled");
const apiKey = $("apiKey");
const model = $("model");
const improveModel = $("improveModel");
const aiSettings = $("ai-settings");
const savedBadge = $("saved");
const testBtn = $("test");
const testResult = $("test-result");

let savedTimer = null;
function flashSaved() {
  savedBadge.classList.add("show");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedBadge.classList.remove("show"), 1200);
}

function currentMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : "local";
}

function syncAiVisibility() {
  aiSettings.hidden = currentMode() !== "ai";
}

function save() {
  const prefs = {
    enabled: enabled.checked,
    mode: currentMode(),
    model: model.value,
    improveModel: improveModel.value,
  };
  // Preferences sync across the user's browsers; the API key is a SECRET and
  // stays in storage.local — this device only, never replicated.
  chrome.storage.sync.set(prefs, flashSaved);
  chrome.storage.local.set({ apiKey: apiKey.value.trim() });
}

// Load existing settings. The key reads from storage.local; a legacy value
// left in storage.sync by earlier versions is shown once (the background
// worker migrates and scrubs it on its next request).
chrome.storage.sync.get(DEFAULTS, (s) => {
  enabled.checked = s.enabled;
  model.value = s.model || "claude-haiku-4-5";
  improveModel.value = s.improveModel || "claude-sonnet-5";
  const radio = document.querySelector(`input[name="mode"][value="${s.mode}"]`);
  if (radio) radio.checked = true;
  syncAiVisibility();
  chrome.storage.local.get({ apiKey: "" }, (loc) => {
    apiKey.value = loc.apiKey || s.apiKey || "";
  });
});

// Wire up change handlers.
enabled.addEventListener("change", save);
apiKey.addEventListener("input", save);
model.addEventListener("change", save);
improveModel.addEventListener("change", save);
document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener("change", () => {
    syncAiVisibility();
    save();
  })
);

// Test key.
testBtn.addEventListener("click", () => {
  testResult.textContent = "Testing…";
  testResult.className = "result";
  // Persist first so the worker uses the latest key.
  save();
  chrome.runtime.sendMessage({ type: "pc:test-key" }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      testResult.textContent = "Could not reach the worker.";
      testResult.className = "result err";
      return;
    }
    testResult.textContent = resp.ok ? "Key works ✓" : "Key failed — check it.";
    testResult.className = "result " + (resp.ok ? "ok" : "err");
  });
});

// --- Personal model export / import -----------------------------------------
// The model is three structures: pc_ngrams (history -> continuation counts),
// pc_cont (Kneser-Ney continuation counts), and pc_words (the user's unigram
// vocabulary — powers personalized word completion). Export bundles all three
// with a format tag; import validates the tag and shape before replacing.
// Bundles exported before pc_words existed import cleanly (vocabulary starts
// empty and relearns).
const MODEL_KEYS = ["pc_ngrams", "pc_cont", "pc_words"];
const MODEL_FORMAT = "promptcomplete-model-v1";
const modelResult = document.getElementById("model-result");

function modelStatus(msg, ok) {
  modelResult.textContent = msg;
  modelResult.className = "result " + (ok ? "ok" : "err");
  setTimeout(() => (modelResult.textContent = ""), 3000);
}

document.getElementById("export-model").addEventListener("click", () => {
  chrome.storage.local.get(MODEL_KEYS, (data) => {
    const bundle = {
      format: MODEL_FORMAT,
      exported_at: new Date().toISOString(),
      pc_ngrams: data.pc_ngrams || {},
      pc_cont: data.pc_cont || { counts: {}, pairs: 0 },
      pc_words: data.pc_words || {},
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "promptcomplete-model.json";
    a.click();
    URL.revokeObjectURL(url);
    modelStatus("Exported ✓", true);
  });
});

document.getElementById("import-model").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (!file) return;
  try {
    const bundle = JSON.parse(await file.text());
    if (bundle.format !== MODEL_FORMAT) throw new Error("not a PromptComplete model file");
    if (typeof bundle.pc_ngrams !== "object" || bundle.pc_ngrams === null)
      throw new Error("missing model data");
    const cont =
      bundle.pc_cont && typeof bundle.pc_cont.counts === "object"
        ? bundle.pc_cont
        : { counts: {}, pairs: 0 };
    const words = bundle.pc_words && typeof bundle.pc_words === "object" ? bundle.pc_words : {};
    chrome.storage.local.set({ pc_ngrams: bundle.pc_ngrams, pc_cont: cont, pc_words: words }, () => {
      modelStatus(`Imported ${Object.keys(bundle.pc_ngrams).length} phrases ✓`, true);
    });
  } catch (err) {
    modelStatus("Import failed: " + err.message, false);
  }
});

// --- Personalize: teach the model your style upfront ------------------------
// Runs the REAL suggestion pipeline (window.PromptComplete.learn, loaded from
// src/suggest.js) over pasted prompts, so bootstrap training is byte-identical
// to what happens when you send a prompt in the composer. Turns a cold-start
// install into one that already knows the user's vocabulary and phrasing.
const STARTER_PACKS = {
  ds: [
    "analyze the churn dataset and plot retention by cohort over the last six months",
    "explain gradient descent with a small worked example and the update rule",
    "summarize this paper in three bullet points for my study notes",
    "write python code to load the csv, clean missing values, and show the correlation matrix",
    "compare logistic regression and random forests for this classification problem",
    "help me structure my resume for a data science internship application",
    "what are the assumptions behind linear regression and how do i check them",
    "give me a study plan to prepare for the machine learning exam next week",
    "rewrite this prompt to be clearer and more specific for better results",
    "create a pandas snippet to group by region and compute the monthly average",
  ],
  eng: [
    "review this pull request for bugs, edge cases, and readability",
    "explain why this function is slow and suggest a faster approach",
    "write unit tests for this module covering the main edge cases",
    "refactor this code to reduce duplication without changing behavior",
    "debug this error and explain the root cause step by step",
    "design a rest api for a todo app with the main endpoints and status codes",
    "write a clear commit message for the changes described below",
    "compare these two approaches and recommend one with the trade-offs",
    "add error handling to this function and explain each case",
    "document this function with a concise docstring and one usage example",
  ],
  writer: [
    "write a friendly but professional email to my manager about the deadline",
    "rewrite this paragraph to be more concise and clear while keeping my voice",
    "draft a short linkedin post announcing our product launch",
    "proofread the following text for grammar, tone, and flow",
    "turn these rough notes into a polished summary for the team",
    "suggest three subject lines for this newsletter and explain each",
    "make this message warmer without losing the key ask",
    "outline a blog post about productivity with a clear structure",
    "summarize this long thread into the key decisions and next steps",
    "give me a concise, confident reply to this client email",
  ],
};

const teachText = $("teach-text");
const teachBtn = $("teach-btn");
const teachResult = $("teach-result");

function teachStatus(msg, ok) {
  teachResult.textContent = msg;
  teachResult.className = "result " + (ok ? "ok" : "err");
  if (ok) setTimeout(() => (teachResult.textContent = ""), 4000);
}

document.querySelectorAll(".pack").forEach((btn) => {
  btn.addEventListener("click", () => {
    const lines = STARTER_PACKS[btn.dataset.pack] || [];
    const existing = teachText.value.trim();
    teachText.value = (existing ? existing + "\n" : "") + lines.join("\n");
    teachText.focus();
  });
});

if (teachBtn) {
  teachBtn.addEventListener("click", async () => {
    if (!window.PromptComplete || !window.PromptComplete.learn) {
      teachStatus("Engine not loaded — reopen this page.", false);
      return;
    }
    const prompts = teachText.value
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length >= 8);
    if (!prompts.length) {
      teachStatus("Add a few prompts first (one per line).", false);
      return;
    }
    teachBtn.disabled = true;
    teachStatus("Learning…", true);
    // Train each prompt through the real pipeline. Learn twice so a
    // one-paste bootstrap clears the support≥2 gate the runtime model uses.
    let learned = 0;
    for (const p of prompts) {
      try {
        await window.PromptComplete.learn(p);
        await window.PromptComplete.learn(p);
        learned++;
      } catch (_) {
        /* skip a bad line, keep going */
      }
    }
    teachBtn.disabled = false;
    teachStatus(`Learned your style from ${learned} prompt${learned === 1 ? "" : "s"} ✓`, true);
    teachText.value = "";
  });
}
