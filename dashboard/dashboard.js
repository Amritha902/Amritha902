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

// --- EDA: time series + descriptive statistics ------------------------------

/** Last `days` daily buckets as an ordered [{date, rate}] series (nulls for
 *  days with no impressions, so gaps render as gaps — not as zeros). */
function dailySeries(daily, days = 14) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const b = daily[key];
    out.push({
      date: key.slice(5), // MM-DD
      rate: b && b.shown ? b.accepted / b.shown : null,
    });
  }
  return out;
}

function renderTrend(daily) {
  const series = dailySeries(daily);
  const svg = document.getElementById("trend");
  const W = 560;
  const H = 120;
  const PAD = 8;
  const step = (W - PAD * 2) / Math.max(1, series.length - 1);
  const y = (r) => H - PAD - r * (H - PAD * 2);

  let path = "";
  const dots = [];
  series.forEach((p, i) => {
    if (p.rate === null) return;
    const px = PAD + i * step;
    const py = y(p.rate);
    path += (path ? " L" : "M") + px.toFixed(1) + " " + py.toFixed(1);
    dots.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" />`);
  });

  svg.innerHTML =
    `<line class="grid" x1="${PAD}" y1="${y(0.5).toFixed(1)}" x2="${W - PAD}" y2="${y(0.5).toFixed(1)}" />` +
    (path ? `<path class="line" d="${path}" />` : "") +
    dots.join("");

  const axis = document.getElementById("trend-axis");
  axis.innerHTML = "";
  [series[0], series[Math.floor(series.length / 2)], series[series.length - 1]].forEach((p) => {
    const s = document.createElement("span");
    s.textContent = p.date;
    axis.appendChild(s);
  });
}

/** Classic five-number-ish summary over the bounded length sample. */
function renderLengthStats(lengths) {
  const put = (id, v) => (document.getElementById(id).textContent = v);
  if (!lengths || lengths.length === 0) {
    ["len-mean", "len-median", "len-min", "len-max", "len-n"].forEach((id) => put(id, "—"));
    return;
  }
  const sorted = [...lengths].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  put("len-mean", mean.toFixed(1));
  put("len-median", String(median));
  put("len-min", String(sorted[0]));
  put("len-max", String(sorted[n - 1]));
  put("len-n", String(n));
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
  chrome.storage.local.get(["pc_stats", "pc_ngrams", "pc_stats_daily", "pc_lengths"], (data) => {
    render(data.pc_stats || {}, data.pc_ngrams || {});
    renderTrend(data.pc_stats_daily || {});
    renderLengthStats(data.pc_lengths || []);
  });
}

$("export").addEventListener("click", () => {
  chrome.storage.local.get(["pc_stats", "pc_ngrams", "pc_stats_daily", "pc_lengths"], (data) => {
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
