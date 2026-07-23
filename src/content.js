/*
 * PromptComplete — content script
 *
 * Watches the chat composer on Claude / ChatGPT, and renders inline ghost-text
 * suggestions at the caret. Tab accepts, Esc dismisses. Works with both plain
 * <textarea> composers and the contenteditable (ProseMirror) editors both
 * sites use.
 */

(function () {
  "use strict";

  // Two-stage adaptive debounce, tuned for latency AND cost:
  //   - Local tiers cost < 1ms, so they run after a short 120ms quiet gap —
  //     the ghost feels instant.
  //   - The AI tier is a network call, so it waits for a further quiet
  //     period. Fast typists get local ghosts continuously and only spend an
  //     API call when they actually pause to think.
  const DEBOUNCE_MS = 120;
  const AI_EXTRA_QUIET_MS = 350;
  const DEFAULTS = { enabled: true, mode: "local", model: "claude-haiku-4-5" };

  let settings = { ...DEFAULTS };
  let ghostEl = null;
  let activeInput = null;
  let currentSuggestion = null;
  let debounceTimer = null;
  let abortCtl = null;

  // Candidate cycling state (Alt+] / Alt+[): all distinct suggestions for the
  // current draft — AI first when it arrives, then local tiers.
  let candidates = [];
  let candidateIdx = 0;

  // Stage-2 AI timer handle — must be cancellable, or a dismissed ghost
  // resurrects when the timer fires on unchanged text.
  let aiTimer = null;
  // Accepting a suggestion inserts text, which fires an 'input' event we
  // dispatched ourselves; without suppression that event re-runs the pipeline
  // 120ms later and clobbers the remainder ghost after a partial accept.
  let suppressInputUntil = 0;

  // --- Streaming AI tier over a long-lived port ----------------------------
  // The service worker streams Claude deltas back per request; a new request
  // (or port disconnect) aborts the in-flight one server-side.
  let port = null;
  let reqCounter = 0;
  let aiReq = null; // { id, baseText, el, accum }

  function getPort() {
    if (port) return port;
    try {
      port = chrome.runtime.connect({ name: "pc-stream" });
    } catch (_) {
      return null;
    }
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => {
      port = null;
    });
    return port;
  }

  function onPortMessage(msg) {
    if (!aiReq || msg.reqId !== aiReq.id) return; // stale request
    if (msg.type === "delta") {
      aiReq.accum += msg.delta;
      maybeShowAi();
    } else if (msg.type === "done") {
      if (msg.completion) {
        aiReq.accum = msg.completion;
        maybeShowAi(true);
      }
      aiReq = null;
    }
  }

  /** Render the streaming AI suggestion if the draft hasn't moved on. */
  function maybeShowAi(final = false) {
    const { el, baseText, accum } = aiReq;
    if (el !== activeInput || readText(el) !== baseText || !caretAtEnd(el)) return;
    const s = window.PromptComplete.sanitize(baseText, accum);
    if (!s) return;
    // AI leads the candidate list; local tiers stay reachable via Alt+].
    if (candidates.aiLed) {
      candidates[0] = s; // grow in place as deltas stream
    } else {
      candidates = [s, ...candidates];
      candidates.aiLed = true;
      // Everything shifted down one slot — keep the user's cycled-to
      // candidate (and the counter pill) pointing at the same suggestion.
      if (candidateIdx > 0) candidateIdx++;
    }
    // Upgrade the visible ghost only if the user hasn't cycled away from
    // the top candidate.
    if (candidateIdx === 0) setSuggestion(el, s, final);
    else updateCounterPill();
  }

  function requestAi(el, text) {
    const p = getPort();
    if (!p) return;
    aiReq = { id: ++reqCounter, baseText: text, el, accum: "" };
    try {
      p.postMessage({ type: "complete", reqId: aiReq.id, text });
    } catch (_) {
      aiReq = null;
      port = null;
    }
  }

  // --- Settings -----------------------------------------------------------
  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    if (!settings.enabled) {
      hideGhost();
      hideHealth();
      hideRepair();
    }
  });

  // --- Element detection --------------------------------------------------
  function isComposer(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.isContentEditable) {
      // Skip tiny inline editables (search boxes etc.) — the composer is large.
      const r = el.getBoundingClientRect();
      return r.width > 200 && r.height > 20;
    }
    return false;
  }

  function readText(el) {
    return el.tagName === "TEXTAREA" ? el.value : el.innerText;
  }

  function caretAtEnd(el) {
    if (el.tagName === "TEXTAREA") {
      return el.selectionStart === el.selectionEnd && el.selectionEnd === el.value.length;
    }
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(el);
    range.setStart(sel.anchorNode, sel.anchorOffset);
    return range.toString().trim() === "";
  }

  // --- Caret geometry -----------------------------------------------------
  function caretRect(el) {
    if (el.tagName === "TEXTAREA") return textareaCaretRect(el);
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    let rect = range.getClientRects()[0];
    if (!rect) rect = range.getBoundingClientRect();
    if (!rect || (rect.x === 0 && rect.y === 0)) {
      const er = el.getBoundingClientRect();
      return { left: er.left + 8, top: er.top + 8, height: 20 };
    }
    return { left: rect.left, top: rect.top, height: rect.height || 20 };
  }

  // Mirror-div technique to locate the caret inside a <textarea>.
  let mirror = null;
  function textareaCaretRect(el) {
    if (!mirror) {
      mirror = document.createElement("div");
      mirror.className = "pc-mirror";
      document.body.appendChild(mirror);
    }
    const cs = getComputedStyle(el);
    const props = [
      "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom",
      "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
      "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "lineHeight",
      "letterSpacing", "textTransform", "wordSpacing",
    ];
    for (const p of props) mirror.style[p] = cs[p];
    mirror.style.width = el.clientWidth + "px";

    const value = el.value.slice(0, el.selectionEnd);
    mirror.textContent = value;
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.appendChild(marker);

    const er = el.getBoundingClientRect();
    const mRect = marker.getBoundingClientRect();
    const mirRect = mirror.getBoundingClientRect();
    return {
      left: er.left + (mRect.left - mirRect.left) - el.scrollLeft,
      top: er.top + (mRect.top - mirRect.top) - el.scrollTop,
      height: parseFloat(cs.lineHeight) || 20,
    };
  }

  // --- Ghost rendering ----------------------------------------------------
  function ensureGhost() {
    if (ghostEl) return ghostEl;
    ghostEl = document.createElement("span");
    ghostEl.className = "pc-ghost";
    ghostEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(ghostEl);
    return ghostEl;
  }

  function showGhost(el, text) {
    const rect = caretRect(el);
    if (!rect) return;
    const g = ensureGhost();
    g.textContent = text;
    const cs = getComputedStyle(el);
    g.style.font = cs.font;
    g.style.fontSize = cs.fontSize;
    g.style.fontFamily = cs.fontFamily;
    g.style.lineHeight = cs.lineHeight;
    g.style.left = rect.left + "px";
    g.style.top = rect.top + "px";
    g.style.height = rect.height + "px";
    g.style.display = "block";
  }

  function hideGhost() {
    currentSuggestion = null;
    candidates = [];
    candidateIdx = 0;
    aiReq = null; // orphan any in-flight stream; the next request supersedes it
    clearTimeout(aiTimer); // a dismissed ghost must stay dismissed
    aiTimer = null;
    if (ghostEl) {
      ghostEl.style.display = "none";
      delete ghostEl.dataset.count;
    }
    if (abortCtl) {
      abortCtl.abort();
      abortCtl = null;
    }
  }

  // --- Garble repair ("did you mean") chip ---------------------------------
  // When the trailing words look badly typed (typos, jammed words, misplaced
  // spaces), src/repair.js proposes a cleaned version and this chip offers it.
  // Ctrl/Cmd+. (or a click) applies; Esc or further typing dismisses.
  let repairEl = null;
  let pendingRepair = null; // { el, from, to, fixed } in text-node coordinates

  // Text in TEXT-NODE coordinates (same mapping used to select the span —
  // innerText offsets don't map onto text nodes; see palette.js).
  function repairText(el) {
    if (el.tagName === "TEXTAREA") return el.value;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let out = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) out += node.nodeValue;
    return out;
  }

  function selectTextRange(el, from, to) {
    if (el.tagName === "TEXTAREA") {
      el.focus();
      el.setSelectionRange(from, to);
      return true;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let pos = 0;
    let startSet = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const len = node.nodeValue.length;
      if (!startSet && pos + len >= from) {
        range.setStart(node, from - pos);
        startSet = true;
      }
      if (startSet && pos + len >= to) {
        range.setEnd(node, to - pos);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
      pos += len;
    }
    return false;
  }

  function ensureRepairChip() {
    if (repairEl) return repairEl;
    repairEl = document.createElement("div");
    repairEl.className = "pc-repair";
    repairEl.addEventListener("mousedown", (e) => {
      e.preventDefault(); // keep composer focus
      applyRepair();
    });
    document.body.appendChild(repairEl);
    return repairEl;
  }

  function hideRepair() {
    pendingRepair = null;
    if (repairEl) repairEl.style.display = "none";
  }

  function maybeShowRepair(el) {
    if (!window.PromptRepair) return;
    const text = repairText(el);
    const r = window.PromptRepair.repairTail(text);
    if (!r) return hideRepair();
    pendingRepair = { el, ...r };
    const chip = ensureRepairChip();
    chip.innerHTML = `✎ Did you mean: <b></b>? <kbd>Ctrl+.</kbd>`;
    chip.querySelector("b").textContent = r.fixed;
    const rect = caretRect(el);
    if (!rect) return hideRepair();
    chip.style.left = Math.max(8, Math.min(rect.left, innerWidth - 320)) + "px";
    chip.style.top = rect.top + (rect.height || 20) + 8 + "px";
    chip.style.display = "block";
  }

  function applyRepair() {
    if (!pendingRepair) return false;
    const { el, from, to, fixed } = pendingRepair;
    hideRepair();
    if (!selectTextRange(el, from, to)) return false;
    suppressInputUntil = Date.now() + 80; // our own insertion, not user typing
    if (el.tagName === "TEXTAREA") {
      el.setRangeText(fixed, from, to, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      try {
        document.execCommand("insertText", false, fixed);
      } catch (_) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(fixed));
          range.collapse(false);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    }
    updateHealth(el);
    return true;
  }

  // --- Suggestion flow ----------------------------------------------------
  function paletteActive() {
    return (
      window.PromptPalette &&
      (window.PromptPalette.isOpen() || window.PromptPalette.inSnippetMode())
    );
  }

  function setSuggestion(el, suggestion, isNew = true) {
    if (isNew && suggestion !== currentSuggestion) bumpStat("shown");
    currentSuggestion = suggestion;
    showGhost(el, suggestion);
    updateCounterPill();
  }

  function updateCounterPill() {
    if (!ghostEl) return;
    if (candidates.length > 1) {
      ghostEl.dataset.count = `  ${candidateIdx + 1}/${candidates.length} ⌥]`;
    } else {
      delete ghostEl.dataset.count;
    }
  }

  function requestSuggestion(el) {
    clearTimeout(debounceTimer);
    if (!settings.enabled) return;
    debounceTimer = setTimeout(async () => {
      if (el !== activeInput || paletteActive()) {
        hideRepair();
        return hideGhost();
      }
      const text = readText(el);
      if (!caretAtEnd(el) || text.trim().length < 2) return hideGhost();

      if (abortCtl) abortCtl.abort();
      abortCtl = new AbortController();
      const signal = abortCtl.signal;

      let local = [];
      try {
        local = await window.PromptComplete.getCandidates(text);
      } catch (_) {
        local = [];
      }
      if (signal.aborted || el !== activeInput) return;
      // Guard: the text may have changed while we awaited.
      if (readText(el) !== text || !caretAtEnd(el)) return;

      candidates = local;
      candidateIdx = 0;

      if (local.length) {
        // Show the best local candidate immediately; if AI mode is on, the
        // streamed AI candidate will upgrade the ghost when it arrives.
        setSuggestion(el, local[0]);
      } else {
        hideGhost();
      }

      // Garble check rides the same quiet gap.
      maybeShowRepair(el);

      // Stage 2: the AI call waits for a further quiet period so rapid
      // typing never sprays network requests (each would be aborted anyway).
      // The handle is kept so hideGhost (Escape, blur, etc.) can cancel it.
      if (settings.mode === "ai") {
        clearTimeout(aiTimer);
        aiTimer = setTimeout(() => {
          aiTimer = null;
          if (el === activeInput && readText(el) === text && caretAtEnd(el) && !paletteActive()) {
            requestAi(el, text);
          }
        }, AI_EXTRA_QUIET_MS);
      }
    }, DEBOUNCE_MS);
  }

  function cycleCandidate(dir) {
    if (!activeInput || candidates.length < 2) return;
    candidateIdx = (candidateIdx + dir + candidates.length) % candidates.length;
    setSuggestion(activeInput, candidates[candidateIdx], false);
  }

  /** Insert literal text at the caret (textarea or contenteditable). */
  function insertAtCaret(el, text) {
    // The insertion below fires an 'input' event (dispatched for textareas,
    // native for execCommand). Mark it so the input listener doesn't treat
    // our own insertion as user typing and clobber the remainder ghost.
    suppressInputUntil = Date.now() + 80;
    if (el.tagName === "TEXTAREA") {
      const start = el.value.length;
      el.value = el.value + text;
      el.selectionStart = el.selectionEnd = start + text.length;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    // execCommand integrates with ProseMirror's input handling.
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (_) {
      ok = false;
    }
    if (!ok) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  function acceptSuggestion(el) {
    if (!currentSuggestion) return false;
    const text = currentSuggestion;
    insertAtCaret(el, text);
    // Value accounting: an accepted suggestion of length L saved ~L
    // keystrokes. The dashboard derives time saved (avg typing speed) and
    // tokens auto-completed from this single honest primitive.
    bumpStats({ accepted: 1, chars_saved: text.length });
    currentSuggestion = null;
    candidates = [];
    if (ghostEl) ghostEl.style.display = "none";
    if (abortCtl) {
      abortCtl.abort();
      abortCtl = null;
    }
    return true;
  }

  /**
   * Partial accept (Copilot muscle memory): consume the next word of the
   * ghost, re-render the remainder. When the last word is consumed the whole
   * suggestion counts as accepted.
   */
  function acceptWord(el) {
    if (!currentSuggestion) return false;
    const m = currentSuggestion.match(/^\s*\S+\s?/);
    if (!m) return false;
    insertAtCaret(el, m[0]);
    bumpStat("chars_saved", m[0].length);
    const rest = currentSuggestion.slice(m[0].length);
    if (rest.trim()) {
      currentSuggestion = rest;
      // The other candidates' first word was just consumed — they are stale
      // now. Only the remainder is a valid candidate.
      candidates = [rest];
      candidateIdx = 0;
      // Re-anchor the ghost at the new caret position.
      showGhost(el, rest);
      updateCounterPill();
    } else {
      bumpStat("accepted");
      currentSuggestion = null;
      candidates = [];
      if (ghostEl) ghostEl.style.display = "none";
    }
    return true;
  }

  // --- Event wiring -------------------------------------------------------
  document.addEventListener(
    "focusin",
    (e) => {
      if (isComposer(e.target)) {
        activeInput = e.target;
      }
    },
    true
  );

  document.addEventListener(
    "input",
    (e) => {
      if (e.target === activeInput && isComposer(e.target)) {
        // Self-generated event (suggestion just inserted): keep the ghost
        // exactly as the accept path left it, but let the health ring track
        // the new text.
        if (Date.now() < suppressInputUntil) {
          suppressInputUntil = 0;
          updateHealth(e.target);
          return;
        }
        requestSuggestion(e.target);
        updateHealth(e.target);
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.target !== activeInput) return;
      // The slash palette and snippet mode own the keyboard while active
      // (their capture listener runs first — see manifest script order).
      if (paletteActive()) return;

      // Accept all with Tab.
      if (e.key === "Tab" && !e.shiftKey && currentSuggestion) {
        e.preventDefault();
        e.stopPropagation();
        acceptSuggestion(activeInput);
        return;
      }
      // Partial accept: Ctrl/Cmd+Right takes the next word.
      if (e.key === "ArrowRight" && (e.ctrlKey || e.metaKey) && currentSuggestion) {
        e.preventDefault();
        e.stopPropagation();
        acceptWord(activeInput);
        return;
      }
      // Cycle alternative candidates: Alt+] / Alt+[. Match the PHYSICAL key
      // (e.code) — on macOS, Option+] produces "'" or "‘" in e.key, so a
      // key-based match never fires there.
      const cycleFwd = e.code === "BracketRight" || e.key === "]";
      const cycleBack = e.code === "BracketLeft" || e.key === "[";
      if (e.altKey && (cycleFwd || cycleBack) && candidates.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        cycleCandidate(cycleFwd ? 1 : -1);
        return;
      }
      // Accept the "did you mean" repair with Ctrl/Cmd+.
      if (e.key === "." && (e.ctrlKey || e.metaKey) && pendingRepair) {
        e.preventDefault();
        e.stopPropagation();
        applyRepair();
        return;
      }
      // Dismiss with Escape.
      if (e.key === "Escape" && pendingRepair) hideRepair();
      if (e.key === "Escape" && currentSuggestion) {
        bumpStat("dismissed");
        hideGhost();
        return;
      }
      // Learn from the submitted prompt (Enter without Shift is "send").
      // Enter during IME composition commits a candidate, not the message —
      // never treat that as a send.
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        const text = readText(activeInput);
        if (text && window.PromptComplete) {
          window.PromptComplete.learn(text);
          recordPromptLength(text);
          recordLabEntry(text);
        }
        hideGhost();
        hideRepair();
        return;
      }
      // Any other navigation/caret key hides the stale ghost.
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        hideGhost();
        hideRepair();
      }
    },
    true
  );

  // --- Local, privacy-preserving analytics --------------------------------
  // We track how often suggestions are shown vs. accepted so the user can see
  // their personal acceptance rate — the core offline metric for an
  // autocomplete model. Alongside the lifetime totals we keep DAILY buckets
  // (a time-series dataset for the dashboard's trend chart) and a bounded
  // sample of prompt lengths (for descriptive statistics). Everything stays
  // in chrome.storage.local; nothing is ever transmitted.
  const STATS_KEY = "pc_stats";
  const DAILY_KEY = "pc_stats_daily";
  const LENGTHS_KEY = "pc_lengths";
  const DAILY_RETENTION = 30; // keep a month of daily buckets
  const LENGTH_SAMPLE_MAX = 200; // reservoir of recent prompt lengths

  const todayKey = () => new Date().toISOString().slice(0, 10);

  // Stat writes are get→mutate→set and therefore NOT atomic: two back-to-back
  // bumps both read the pre-increment snapshot and the second write clobbers
  // the first (deterministically losing e.g. the "accepted" count). All bumps
  // therefore accumulate into a pending-delta map and flush strictly one
  // get/set pair at a time.
  let pendingBumps = null;
  let flushingBumps = false;

  function bumpStats(deltas) {
    pendingBumps = pendingBumps || {};
    for (const [k, v] of Object.entries(deltas)) pendingBumps[k] = (pendingBumps[k] || 0) + v;
    flushBumps();
  }
  const bumpStat = (field, by = 1) => bumpStats({ [field]: by });

  function flushBumps() {
    if (flushingBumps || !pendingBumps) return;
    flushingBumps = true;
    const batch = pendingBumps;
    pendingBumps = null;
    try {
      chrome.storage.local.get([STATS_KEY, DAILY_KEY], (data) => {
        const s = data[STATS_KEY] || { shown: 0, accepted: 0, dismissed: 0 };
        const daily = data[DAILY_KEY] || {};
        const day = (daily[todayKey()] = daily[todayKey()] || { shown: 0, accepted: 0, dismissed: 0 });
        for (const [field, by] of Object.entries(batch)) {
          s[field] = (s[field] || 0) + by;
          day[field] = (day[field] || 0) + by;
        }
        // Retention: drop buckets older than the window (keys sort by date).
        const days = Object.keys(daily).sort();
        while (days.length > DAILY_RETENTION) delete daily[days.shift()];

        chrome.storage.local.set({ [STATS_KEY]: s, [DAILY_KEY]: daily }, () => {
          flushingBumps = false;
          flushBumps(); // drain anything that accumulated mid-flight
        });
      });
    } catch (_) {
      flushingBumps = false; // non-fatal; drop the batch
    }
  }

  // --- Prompt Lab: local experiment log ------------------------------------
  // Every sent prompt is logged like an ML experiment run: timestamp, size,
  // health score, and WHICH best-practice dimensions were missing. No prompt
  // text is stored — the analytical value is in the structure, and keeping
  // text out makes the privacy story absolute.
  const LAB_KEY = "pc_lab";
  const LAB_MAX = 100;

  function recordLabEntry(text) {
    if (!window.PromptHealth) return;
    const h = window.PromptHealth.score(text);
    const entry = {
      t: Date.now(),
      words: h.words,
      health: h.total,
      missing: h.dims.filter((d) => d.applicable && !d.ok).map((d) => d.key),
    };
    try {
      chrome.storage.local.get(LAB_KEY, (data) => {
        const arr = data[LAB_KEY] || [];
        arr.push(entry);
        if (arr.length > LAB_MAX) arr.splice(0, arr.length - LAB_MAX);
        chrome.storage.local.set({ [LAB_KEY]: arr });
      });
    } catch (_) {
      /* non-fatal */
    }
  }

  // Record the token length of each submitted prompt (bounded FIFO sample).
  function recordPromptLength(text) {
    const tokens = (text.match(/\S+/g) || []).length;
    if (!tokens) return;
    try {
      chrome.storage.local.get(LENGTHS_KEY, (data) => {
        const arr = data[LENGTHS_KEY] || [];
        arr.push(tokens);
        if (arr.length > LENGTH_SAMPLE_MAX) arr.splice(0, arr.length - LENGTH_SAMPLE_MAX);
        chrome.storage.local.set({ [LENGTHS_KEY]: arr });
      });
    } catch (_) {
      /* non-fatal */
    }
  }

  // --- Prompt Health ring + Intent Compiler --------------------------------
  // A small live gauge anchored to the composer scoring the draft across the
  // five best-practice dimensions (src/health.js). Clicking it opens a panel
  // with per-dimension status and a one-click "Compile" action that rewrites
  // the rough draft into a structured prompt via the background worker.
  let ringEl = null;
  let panelEl = null;
  let lastHealth = null;

  function ensureRing() {
    if (ringEl) return ringEl;
    ringEl = document.createElement("div");
    ringEl.className = "pc-ring";
    ringEl.title = "Prompt health — click for details";
    ringEl.innerHTML =
      '<svg viewBox="0 0 36 36"><circle class="pc-ring-bg" cx="18" cy="18" r="15.5"/>' +
      '<circle class="pc-ring-fg" cx="18" cy="18" r="15.5"/></svg><span class="pc-ring-num"></span>';
    ringEl.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });
    document.body.appendChild(ringEl);
    return ringEl;
  }

  function healthColor(total) {
    // coral (low) → amber → green (high), matching the warm palette.
    if (total >= 80) return "#4a7c59";
    if (total >= 50) return "#d8a25f";
    return "#cc785c";
  }

  function updateHealth(el) {
    if (!settings.enabled || !window.PromptHealth) return;
    const text = readText(el);
    const words = (text.match(/\S+/g) || []).length;
    if (words < 5) return hideHealth();

    lastHealth = window.PromptHealth.score(text);
    const ring = ensureRing();
    const rect = el.getBoundingClientRect();
    ring.style.left = rect.right - 34 + "px";
    // Clamp inside the viewport; fall back to just inside the composer when
    // there's no room above it.
    ring.style.top = (rect.top >= 42 ? rect.top - 34 : rect.top + 4) + "px";
    ring.style.display = "flex";

    const C = 2 * Math.PI * 15.5;
    const fg = ring.querySelector(".pc-ring-fg");
    fg.style.strokeDasharray = C;
    fg.style.strokeDashoffset = C * (1 - lastHealth.total / 100);
    fg.style.stroke = healthColor(lastHealth.total);
    ring.querySelector(".pc-ring-num").textContent = lastHealth.total;
    if (panelEl && panelEl.style.display !== "none") renderPanel();
  }

  function hideHealth() {
    if (ringEl) ringEl.style.display = "none";
    if (panelEl) panelEl.style.display = "none";
  }

  function togglePanel() {
    if (!panelEl) {
      panelEl = document.createElement("div");
      panelEl.className = "pc-panel";
      panelEl.addEventListener("click", (e) => e.stopPropagation());
      document.body.appendChild(panelEl);
      document.addEventListener("click", () => {
        if (panelEl) panelEl.style.display = "none";
      });
    }
    if (panelEl.style.display === "block") {
      panelEl.style.display = "none";
      return;
    }
    renderPanel();
    const r = ringEl.getBoundingClientRect();
    panelEl.style.left = Math.max(8, r.right - 300) + "px";
    panelEl.style.top = r.bottom + 8 + "px";
    panelEl.style.display = "block";
  }

  function renderPanel() {
    if (!lastHealth) return;
    const rows = lastHealth.dims
      .filter((d) => d.applicable)
      .map(
        (d) =>
          `<div class="pc-dim ${d.ok ? "ok" : ""}"><span class="pc-dim-mark">${d.ok ? "✓" : "○"}</span>` +
          `<span class="pc-dim-label">${d.label}</span>` +
          `<span class="pc-dim-hint">${d.ok ? "" : d.hint}</span></div>`
      )
      .join("");
    panelEl.innerHTML =
      `<div class="pc-panel-head">Prompt health <b>${lastHealth.total}</b>/100</div>` +
      rows +
      `<button class="pc-compile">⚡ Compile into a structured prompt</button>` +
      `<div class="pc-panel-foot">Scored locally against prompt-engineering best practices. Compile uses your API key.</div>`;
    panelEl.querySelector(".pc-compile").addEventListener("click", compileDraft);
  }

  function compileDraft() {
    if (!activeInput) return;
    const draft = readText(activeInput);
    if (!draft.trim()) return;
    const btn = panelEl.querySelector(".pc-compile");
    btn.textContent = "Compiling…";
    btn.disabled = true;
    chrome.runtime.sendMessage({ type: "pc:improve", text: draft }, (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError || !resp || !resp.ok || !resp.completion) {
        btn.textContent = resp && resp.reason === "no-key"
          ? "Add your API key in Settings first"
          : "Couldn't compile — try again";
        setTimeout(() => (btn.textContent = "⚡ Compile into a structured prompt"), 2200);
        return;
      }
      replaceDraft(activeInput, resp.completion);
      btn.textContent = "⚡ Compile into a structured prompt";
      panelEl.style.display = "none";
      updateHealth(activeInput);
    });
  }

  function replaceDraft(el, text) {
    if (el.tagName === "TEXTAREA") {
      el.value = text;
      el.selectionStart = el.selectionEnd = text.length;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    // contenteditable: select-all then insertText keeps ProseMirror in sync.
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    try {
      document.execCommand("insertText", false, text);
    } catch (_) {
      el.textContent = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // Scroll/resize invalidate every position:fixed overlay's coordinates —
  // hide them all (they re-anchor on the next input).
  const hideOverlays = () => {
    hideGhost();
    hideHealth();
    hideRepair();
  };
  window.addEventListener("scroll", hideOverlays, true);
  window.addEventListener("resize", hideOverlays, true);
  document.addEventListener("selectionchange", () => {
    if (activeInput && currentSuggestion && !caretAtEnd(activeInput)) hideGhost();
  });

  // Leaving the composer hides the overlays — unless the blur was caused by
  // clicking one of our own surfaces (ring, panel, palette). Those are
  // mostly non-focusable divs, so relatedTarget is null for them; the
  // pointer-down target is the reliable signal.
  let overlayPointerDown = false;
  document.addEventListener(
    "mousedown",
    (e) => {
      const t = e.target;
      overlayPointerDown = !!(
        (ringEl && ringEl.contains(t)) ||
        (panelEl && panelEl.contains(t)) ||
        (t.closest && t.closest(".pc-palette"))
      );
    },
    true
  );
  document.addEventListener(
    "focusout",
    (e) => {
      if (e.target !== activeInput) return;
      if (overlayPointerDown) return; // interacting with our own UI
      const to = e.relatedTarget;
      if (
        to &&
        ((ringEl && ringEl.contains(to)) ||
          (panelEl && panelEl.contains(to)) ||
          (to.closest && to.closest(".pc-palette")))
      ) {
        return;
      }
      hideOverlays();
    },
    true
  );
})();
