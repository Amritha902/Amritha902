/*
 * PromptComplete — background service worker
 *
 * Handles "ai" mode: given a partial prompt, calls the Claude API with the
 * user's own key and returns a short continuation. The key never leaves the
 * user's browser except in the direct request to api.anthropic.com.
 *
 * Model default: claude-haiku-4-5 — the fastest, cheapest Claude model, which
 * is the right tradeoff for real-time autocomplete latency. The model is
 * configurable in the options page.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT =
  "You are an inline autocomplete engine for a chat prompt box. " +
  "The user is typing a message to an AI assistant. Given the partial text " +
  "they have typed so far, output ONLY the most likely continuation that comes " +
  "immediately after it — a few words up to one short sentence. " +
  "Do NOT repeat any of the text they already typed. Do NOT add quotes, labels, " +
  "explanations, or a trailing newline. If a natural continuation isn't clear, " +
  "output nothing.";

// Small in-memory cache so identical partials within a session don't re-bill.
const cache = new Map();
const CACHE_MAX = 200;

function cacheGet(key) {
  const v = cache.get(key);
  if (v !== undefined) {
    cache.delete(key);
    cache.set(key, v); // refresh recency
  }
  return v;
}
function cacheSet(key, val) {
  cache.set(key, val);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function getSettings() {
  return chrome.storage.sync.get({ apiKey: "", model: "claude-haiku-4-5", mode: "local" });
}

async function complete(text) {
  const key = text.trim();
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const { apiKey, model } = await getSettings();
  if (!apiKey) return null;

  const body = {
    model: model || "claude-haiku-4-5",
    max_tokens: 48,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: key }],
  };

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      // Required for requests originating from a browser context.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    // Don't cache failures; surface nothing so the UI falls back to local.
    return null;
  }
  const data = await resp.json();
  const block = Array.isArray(data.content)
    ? data.content.find((b) => b.type === "text")
    : null;
  const completion = block ? block.text.trim() : null;
  cacheSet(key, completion || null);
  return completion || null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "pc:complete") {
    complete(msg.text)
      .then((completion) => sendResponse({ ok: true, completion }))
      .catch(() => sendResponse({ ok: false, completion: null }));
    return true; // keep the message channel open for the async response
  }
  if (msg && msg.type === "pc:test-key") {
    // Used by the options page to validate the key.
    complete("Hello, this is a")
      .then((c) => sendResponse({ ok: c !== null }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
