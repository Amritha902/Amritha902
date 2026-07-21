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

  const DEBOUNCE_MS = 220;
  const DEFAULTS = { enabled: true, mode: "local", model: "claude-haiku-4-5" };

  let settings = { ...DEFAULTS };
  let ghostEl = null;
  let activeInput = null;
  let currentSuggestion = null;
  let debounceTimer = null;
  let abortCtl = null;

  // --- Settings -----------------------------------------------------------
  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    if (!settings.enabled) hideGhost();
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
    if (ghostEl) ghostEl.style.display = "none";
    if (abortCtl) {
      abortCtl.abort();
      abortCtl = null;
    }
  }

  // --- Suggestion flow ----------------------------------------------------
  function requestSuggestion(el) {
    clearTimeout(debounceTimer);
    if (!settings.enabled) return;
    debounceTimer = setTimeout(async () => {
      if (el !== activeInput) return;
      const text = readText(el);
      if (!caretAtEnd(el) || text.trim().length < 2) return hideGhost();

      if (abortCtl) abortCtl.abort();
      abortCtl = new AbortController();
      const signal = abortCtl.signal;

      let suggestion = null;
      try {
        suggestion = await window.PromptComplete.getSuggestion(text, settings, signal);
      } catch (_) {
        suggestion = null;
      }
      if (signal.aborted || el !== activeInput) return;
      // Guard: the text may have changed while we awaited.
      if (readText(el) !== text || !caretAtEnd(el)) return;

      if (suggestion && suggestion.trim()) {
        if (suggestion !== currentSuggestion) bumpStat("shown");
        currentSuggestion = suggestion;
        showGhost(el, suggestion);
      } else {
        hideGhost();
      }
    }, DEBOUNCE_MS);
  }

  function acceptSuggestion(el) {
    if (!currentSuggestion) return false;
    const text = currentSuggestion;
    if (el.tagName === "TEXTAREA") {
      const start = el.value.length;
      el.value = el.value + text;
      el.selectionStart = el.selectionEnd = start + text.length;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
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
    bumpStat("accepted");
    currentSuggestion = null;
    if (ghostEl) ghostEl.style.display = "none";
    if (abortCtl) {
      abortCtl.abort();
      abortCtl = null;
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
      if (e.target === activeInput && isComposer(e.target)) requestSuggestion(e.target);
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.target !== activeInput) return;

      // Accept with Tab.
      if (e.key === "Tab" && currentSuggestion) {
        e.preventDefault();
        e.stopPropagation();
        acceptSuggestion(activeInput);
        return;
      }
      // Dismiss with Escape.
      if (e.key === "Escape" && currentSuggestion) {
        bumpStat("dismissed");
        hideGhost();
        return;
      }
      // Learn from the submitted prompt (Enter without Shift is "send").
      if (e.key === "Enter" && !e.shiftKey) {
        const text = readText(activeInput);
        if (text && window.PromptComplete) window.PromptComplete.learn(text);
        hideGhost();
        return;
      }
      // Any other navigation/caret key hides the stale ghost.
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        hideGhost();
      }
    },
    true
  );

  // --- Local, privacy-preserving analytics --------------------------------
  // We track how often suggestions are shown vs. accepted so the user can see
  // their personal acceptance rate — the core offline metric for an
  // autocomplete model. Everything stays in chrome.storage.local; nothing is
  // ever transmitted.
  const STATS_KEY = "pc_stats";
  function bumpStat(field, by = 1) {
    try {
      chrome.storage.local.get(STATS_KEY, (data) => {
        const s = data[STATS_KEY] || { shown: 0, accepted: 0, dismissed: 0 };
        s[field] = (s[field] || 0) + by;
        chrome.storage.local.set({ [STATS_KEY]: s });
      });
    } catch (_) {
      /* non-fatal */
    }
  }

  window.addEventListener("scroll", hideGhost, true);
  window.addEventListener("resize", hideGhost, true);
  document.addEventListener("selectionchange", () => {
    if (activeInput && currentSuggestion && !caretAtEnd(activeInput)) hideGhost();
  });
})();
