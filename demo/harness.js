/*
 * PromptComplete — demo harness
 *
 * Minimal in-page stub of the `chrome.*` extension APIs so the REAL content
 * scripts (suggest.js, health.js, palette.js, content.js — unmodified) can run
 * inside demo/composer.html for screenshots, demos, and E2E tests.
 *
 * Storage is in-memory. The AI port is a no-op (demo runs Local mode only).
 */
(function () {
  "use strict";

  const store = { sync: {}, local: {} };
  const changeListeners = [];

  function area(name) {
    return {
      get(defaults, cb) {
        let out;
        if (typeof defaults === "string") {
          out = { [defaults]: store[name][defaults] };
        } else if (Array.isArray(defaults)) {
          out = {};
          for (const k of defaults) out[k] = store[name][k];
        } else {
          out = { ...(defaults || {}) };
          for (const k of Object.keys(store[name])) out[k] = store[name][k];
        }
        queueMicrotask(() => cb(out));
      },
      set(obj, cb) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: store[name][k], newValue: v };
          store[name][k] = v;
        }
        queueMicrotask(() => {
          for (const l of changeListeners) l(changes, name);
          if (cb) cb();
        });
      },
    };
  }

  window.chrome = {
    storage: {
      sync: area("sync"),
      local: area("local"),
      onChanged: { addListener: (l) => changeListeners.push(l) },
    },
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        // In the real extension pc:improve calls Claude (Sonnet) via the
        // service worker. The demo returns a canned, representative rewrite
        // so the Intent Compiler UX can be exercised offline.
        if (msg && msg.type === "pc:improve") {
          const canned =
            "You are an experienced resume coach for early-career data scientists.\n\n" +
            "Rewrite the resume summary below to be specific and achievement-led.\n\n" +
            "<resume_summary>\n{{paste your current summary}}\n</resume_summary>\n\n" +
            "Requirements:\n" +
            "- Lead with measurable impact, not responsibilities\n" +
            "- Keep it under 60 words, active voice\n" +
            "- Mirror keywords from a data-science internship posting\n\n" +
            "Return the rewritten summary, then a one-line note on the biggest change you made.";
          setTimeout(() => cb({ ok: true, completion: canned }), 600);
          return;
        }
        if (cb) queueMicrotask(() => cb(null));
      },
      connect: () => ({
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
        postMessage() {},
        disconnect() {},
      }),
      getURL: (p) => p,
      openOptionsPage: () => {
        window.__pcOpened = "options";
      },
    },
    tabs: {
      create: ({ url }) => {
        window.__pcOpened = url;
      },
    },
  };

  // Expose the raw store so a driver (Playwright / console) can seed or
  // inspect the model directly.
  window.__pcStore = store;
})();
