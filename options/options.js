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
