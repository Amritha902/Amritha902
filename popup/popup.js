/* PromptComplete — popup logic */

const DEFAULTS = { enabled: true, mode: "local" };
const enabled = document.getElementById("enabled");
const modeButtons = document.querySelectorAll(".mode");

function paintMode(mode) {
  modeButtons.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  enabled.checked = s.enabled;
  paintMode(s.mode);
});

enabled.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabled.checked });
});

modeButtons.forEach((b) =>
  b.addEventListener("click", () => {
    const mode = b.dataset.mode;
    paintMode(mode);
    chrome.storage.sync.set({ mode });
  })
);

document.getElementById("open-dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
});

document.getElementById("open-options").addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL("options/options.html"));
});
