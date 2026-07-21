/* PromptComplete — options page logic */

const DEFAULTS = {
  enabled: true,
  mode: "local",
  apiKey: "",
  model: "claude-haiku-4-5",
};

const $ = (id) => document.getElementById(id);
const enabled = $("enabled");
const apiKey = $("apiKey");
const model = $("model");
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
  const data = {
    enabled: enabled.checked,
    mode: currentMode(),
    apiKey: apiKey.value.trim(),
    model: model.value,
  };
  chrome.storage.sync.set(data, flashSaved);
}

// Load existing settings.
chrome.storage.sync.get(DEFAULTS, (s) => {
  enabled.checked = s.enabled;
  apiKey.value = s.apiKey || "";
  model.value = s.model || "claude-haiku-4-5";
  const radio = document.querySelector(`input[name="mode"][value="${s.mode}"]`);
  if (radio) radio.checked = true;
  syncAiVisibility();
});

// Wire up change handlers.
enabled.addEventListener("change", save);
apiKey.addEventListener("input", save);
model.addEventListener("change", save);
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
