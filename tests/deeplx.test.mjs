import test from "node:test";
import assert from "node:assert/strict";
import { isTranslationEnabled, parseDeepLXResult, translateMissing, translationKey } from "../server/translation.mjs";

const endpoint = "https://translator.example/private-test-token/translate";
const sources = [{ articles: [{ title: "Hello" }, { title: "World" }, { title: "Hello" }] }];
const config = { provider: "deeplx", deeplxUrl: endpoint, intervalMs: 0 };

test("DeepLX is opt-in with its URL, without requiring an OpenAI key", () => {
  assert.equal(isTranslationEnabled({ provider: "deeplx" }), false);
  assert.equal(isTranslationEnabled(config), true);
  assert.equal(isTranslationEnabled({ provider: "unknown", apiKey: "x" }), false);
});
test("DeepLX posts EN/ZH titles, validates IDs, deduplicates and caches", async () => {
  const cache = {};
  let calls = 0, progress = 0;
  const fetcher = async (url, request) => {
    calls++;
    assert.equal(url, endpoint);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(request.body), { text: "[S0000] Hello\n[S0001] World", source_lang: "EN", target_lang: "ZH" });
    return Response.json({ code: 200, data: "[S0001] 世界\n[S0000] 你好" });
  };
  const options = { ...config, fetcher, onProgress: async () => { progress++; } };
  assert.equal(await translateMissing(sources, cache, options), true);
  assert.equal(cache[translationKey("Hello")], "你好");
  assert.equal(cache[translationKey("World")], "世界");
  assert.equal(await translateMissing(sources, cache, options), false);
  assert.equal(calls, 1);
  assert.equal(progress, 1);
});
test("DeepLX rejects missing, duplicated or out-of-range mapping IDs", () => {
  for (const value of ["你好\n世界", "[S0000] 你好", "[S0000] 你好\n[S0000] 世界", "[S0000] 你好\n[S9999] 世界"]) {
    assert.throws(() => parseDeepLXResult(value, 2));
  }
});
test("DeepLX keeps completed chunks on rate limit and stops further requests", async () => {
  const cache = {};
  let calls = 0, progress = 0;
  await assert.rejects(translateMissing(sources, cache, {
    ...config, chunkSize: 1, onProgress: async () => { progress++; },
    fetcher: async () => ++calls === 1 ? Response.json({ code: 200, data: "[S0000] 你好" }) : new Response("upstream secret message", { status: 429, headers: { "Retry-After": "120" } }),
  }), error => {
    assert.equal(error.message, "DeepLX HTTP 429");
    assert.equal(error.retryAfterMs, 120000);
    assert.ok(!error.message.includes("private-test-token"));
    return true;
  });
  assert.equal(cache[translationKey("Hello")], "你好");
  assert.equal(cache[translationKey("World")], undefined);
  assert.equal(progress, 1);
  assert.equal(calls, 2);
});
test("DeepLX reports API-level errors and never caches malformed translations", async () => {
  for (const data of [{ code: 429 }, { code: 200, data: "translated without IDs" }, { code: 200, data: null }]) {
    const cache = {};
    await assert.rejects(translateMissing(sources, cache, { ...config, fetcher: async () => Response.json(data) }));
    assert.deepEqual(cache, {});
  }
});
test("DeepLX transport errors redact private URLs and reject insecure endpoints", async () => {
  await assert.rejects(translateMissing(sources, {}, { ...config, fetcher: async () => { throw new Error(endpoint); } }), { message: "DeepLX connection failed or timed out" });
  await assert.rejects(translateMissing(sources, {}, { ...config, deeplxUrl: "http://insecure.example/translate" }), /HTTPS is required/);
});
