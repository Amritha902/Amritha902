/*
 * PromptComplete — slash-command scaffold palette
 *
 * Type "/" at the start of the composer to open a searchable palette of
 * curated prompt scaffolds (src/templates.js). Selecting one inserts the
 * scaffold and enters snippet mode: every {{placeholder}} becomes a
 * Tab-navigable field — Tab selects the next placeholder, typing replaces
 * it, and snippet mode exits when none remain (returning Tab to the
 * ghost-text accept action).
 *
 * Exposes `window.PromptPalette = { isOpen, inSnippetMode }` so the main
 * content script can yield keyboard priority.
 */

(function () {
  "use strict";

  let paletteEl = null;
  let open = false;
  let items = [];
  let selected = 0;
  let targetInput = null;
  let snippetEl = null; // element currently in snippet mode

  const PLACEHOLDER_RE = /\{\{[^}]*\}\}/;

  // --- Text helpers (shared across textarea + contenteditable) -------------
  const readText = (el) => (el.tagName === "TEXTAREA" ? el.value : el.innerText);

  /** Map a plain-text offset range to a DOM Range inside a contenteditable. */
  function selectInEditable(el, start, end) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let range = document.createRange();
    let startSet = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const len = node.nodeValue.length;
      if (!startSet && pos + len >= start) {
        range.setStart(node, start - pos);
        startSet = true;
      }
      if (startSet && pos + len >= end) {
        range.setEnd(node, end - pos);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
      pos += len;
      // innerText renders block boundaries as newlines that have no text
      // node; nudge the offset when crossing block-level children.
    }
    return false;
  }

  function selectSpan(el, start, end) {
    if (el.tagName === "TEXTAREA") {
      el.focus();
      el.setSelectionRange(start, end);
      return true;
    }
    el.focus();
    return selectInEditable(el, start, end);
  }

  /** Select the next {{placeholder}}; returns false when none remain. */
  function selectNextPlaceholder(el) {
    const text = readText(el);
    const m = text.match(PLACEHOLDER_RE);
    if (!m) return false;
    return selectSpan(el, m.index, m.index + m[0].length);
  }

  function insertScaffold(el, body) {
    if (el.tagName === "TEXTAREA") {
      el.value = body;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand("insertText", false, body);
      } catch (_) {
        el.textContent = body;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    // Enter snippet mode on the first placeholder.
    snippetEl = selectNextPlaceholder(el) ? el : null;
  }

  // --- Palette UI ----------------------------------------------------------
  function ensurePalette() {
    if (paletteEl) return paletteEl;
    paletteEl = document.createElement("div");
    paletteEl.className = "pc-palette";
    document.body.appendChild(paletteEl);
    return paletteEl;
  }

  function fuzzyScore(query, t) {
    const q = query.toLowerCase();
    const hay = (t.trigger + " " + t.title + " " + t.category).toLowerCase();
    if (!q) return 1;
    if (t.trigger.slice(1).startsWith(q)) return 3; // "/em" → /email
    if (hay.includes(q)) return 2;
    return 0;
  }

  function renderPalette(query, anchor) {
    const all = window.PromptTemplates || [];
    items = all
      .map((t) => ({ t, s: fuzzyScore(query, t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.t);
    if (items.length === 0) return closePalette();

    selected = Math.min(selected, items.length - 1);
    const el = ensurePalette();
    el.innerHTML =
      '<div class="pc-palette-head">Prompt scaffolds — ↑↓ choose, Enter insert, Esc close</div>' +
      items
        .map(
          (t, i) =>
            `<div class="pc-palette-item ${i === selected ? "sel" : ""}" data-i="${i}">` +
            `<span class="pc-palette-trigger">${t.trigger}</span>` +
            `<span class="pc-palette-title">${t.title}</span>` +
            `<span class="pc-palette-why">${t.technique.split(",")[0]}</span></div>`
        )
        .join("");
    el.querySelectorAll(".pc-palette-item").forEach((item) =>
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(parseInt(item.dataset.i, 10));
      })
    );

    const rect = anchor.getBoundingClientRect();
    el.style.left = rect.left + "px";
    el.style.top = Math.max(8, rect.top - Math.min(340, el.offsetHeight || 300) - 6) + "px";
    el.style.display = "block";
    open = true;
  }

  function closePalette() {
    if (paletteEl) paletteEl.style.display = "none";
    open = false;
  }

  function choose(i) {
    const t = items[i];
    if (!t || !targetInput) return closePalette();
    closePalette();
    insertScaffold(targetInput, t.body);
  }

  // --- Event wiring --------------------------------------------------------
  function isComposer(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.isContentEditable) {
      const r = el.getBoundingClientRect();
      return r.width > 200 && r.height > 20;
    }
    return false;
  }

  document.addEventListener(
    "input",
    (e) => {
      const el = e.target;
      if (!isComposer(el)) return;
      const text = readText(el).trimStart();
      // Palette engages only while the draft is just a slash command.
      if (/^\/[a-z]*$/i.test(text)) {
        targetInput = el;
        renderPalette(text.slice(1), el);
      } else if (open) {
        closePalette();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      // Palette navigation takes priority while open.
      if (open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          e.stopImmediatePropagation();
          selected = (selected + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
          renderPalette(readText(targetInput).trimStart().slice(1), targetInput);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          e.stopImmediatePropagation();
          choose(selected);
          return;
        }
        if (e.key === "Escape") {
          e.stopImmediatePropagation();
          closePalette();
          return;
        }
      }
      // Snippet mode: Tab hops placeholders until none remain.
      if (snippetEl && e.target === snippetEl && e.key === "Tab" && !e.shiftKey) {
        if (selectNextPlaceholder(snippetEl)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        } else {
          snippetEl = null; // exit snippet mode; Tab returns to ghost accept
        }
      }
      if (snippetEl && e.key === "Escape") snippetEl = null;
    },
    true
  );

  document.addEventListener("focusout", () => closePalette(), true);

  window.PromptPalette = {
    isOpen: () => open,
    inSnippetMode: () => snippetEl !== null,
  };
})();
