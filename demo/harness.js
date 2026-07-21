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
      sendMessage: (_msg, cb) => {
        if (cb) queueMicrotask(() => cb(null));
      },
      connect: () => ({
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
        postMessage() {},
        disconnect() {},
      }),
      getURL: (p) => p,
    },
  };

  // Expose the raw store so a driver (Playwright / console) can seed or
  // inspect the model directly.
  window.__pcStore = store;
})();
