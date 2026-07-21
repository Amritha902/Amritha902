/* PromptComplete — Insights dashboard
 *
 * Reads the local dataset (pc_stats + pc_ngrams) and renders acceptance
 * analytics and the top phrases the personal model has learned. This is the
 * "just show them the data" surface — and the schema previewed here is the
 * same one a team/enterprise deployment would serve from an endpoint.
 */

const $ = (id) => document.getElementById(id);

function pct(n, d) {
  if (!d) return "—";
  return Math.round((n / d) * 100) + "%";
}

function topPhrases(ngrams, limit = 12) {
  const rows = [];
  for (const [key, choices] of Object.entries(ngrams || {})) {
    let best = null;
    let count = 0;
    for (const [w, c] of Object.entries(choices)) {
      if (c > count) {
        best = w;
        count = c;
      }
    }
    if (best && count >= 2) rows.push({ key, next: best, count });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows.slice(0, limit);
}

function render(stats, ngrams) {
  const shown = stats.shown || 0;
  const accepted = stats.accepted || 0;
  const dismissed = stats.dismissed || 0;
  const learned = Object.keys(ngrams || {}).length;

  $("acceptRate").textContent = pct(accepted, shown);
  $("shown").textContent = shown.toLocaleString();
  $("accepted").textContent = accepted.toLocaleString();
  $("learned").textContent = learned.toLocaleString();

  // Acceptance breakdown bar.
  const ignored = Math.max(0, shown - accepted - dismissed);
  const bar = $("bar");
  bar.innerHTML = "";
  const seg = (cls, val) => {
    if (!shown || val <= 0) return;
    const s = document.createElement("span");
    s.className = "seg-" + cls;
    s.style.width = (val / shown) * 100 + "%";
    bar.appendChild(s);
  };
  seg("accepted", accepted);
  seg("dismissed", dismissed);
  seg("ignored", ignored);

  // Top learned phrases.
  const rows = topPhrases(ngrams);
  const tbody = document.querySelector("#phrases tbody");
  tbody.innerHTML = "";
  if (rows.length === 0) {
    $("empty").hidden = false;
  } else {
    $("empty").hidden = true;
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><code>${r.key}</code></td><td><code>${r.next}</code></td><td class="num">${r.count}</td>`;
      tbody.appendChild(tr);
    }
  }

  // Schema preview (the shape a data-science endpoint would return).
  $("schema").textContent = JSON.stringify(
    {
      metrics: {
        acceptance_rate: shown ? +(accepted / shown).toFixed(3) : null,
        shown,
        accepted,
        dismissed,
        model_size: learned,
      },
      top_phrases: rows.slice(0, 3),
    },
    null,
    2
  );
}

function load() {
  chrome.storage.local.get(["pc_stats", "pc_ngrams"], (data) => {
    render(data.pc_stats || {}, data.pc_ngrams || {});
  });
}

$("export").addEventListener("click", () => {
  chrome.storage.local.get(["pc_stats", "pc_ngrams"], (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "promptcomplete-dataset.json";
    a.click();
    URL.revokeObjectURL(url);
  });
});

$("reset").addEventListener("click", () => {
  if (!confirm("Reset your local stats and learned model? This cannot be undone.")) return;
  chrome.storage.local.set({ pc_stats: { shown: 0, accepted: 0, dismissed: 0 }, pc_ngrams: {} }, load);
});

chrome.storage.onChanged.addListener((_c, area) => {
  if (area === "local") load();
});

load();
