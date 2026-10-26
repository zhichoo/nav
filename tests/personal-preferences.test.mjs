import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createPersonalTranslator, translatePersonalTitle, validatePersonalConfig } from "../src/personal-translation.ts";

import { savePersonalConfig, readPersonalConfig, clearPersonalConfig } from "../src/personal-preferences.ts";

const origin = "https://reader.example";
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

const input = { provider: "openai", endpoint: "https://translator.example/v1", model: "hy-mt2-pro", apiKey: "private-browser-only-key" };
const config = () => validatePersonalConfig(input, "https://reader.example");
const response = title => Response.json({ choices: [{ finish_reason: "stop", message: { content: `[S0000] ${title}` } }] });
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await delay(1); }
  assert.fail("Translator state did not settle");
}

test("personal endpoints normalize base or full addresses and reject own-site or non-public endpoints", () => {
  assert.equal(config().endpoint, "https://translator.example/v1/chat/completions");
  assert.equal(validatePersonalConfig({ ...input, endpoint: config().endpoint }).endpoint, config().endpoint);
  for (const endpoint of ["/api/translate", "http://translator.example/v1", "https://reader.example/api/translate", "https://user:password@translator.example", "https://localhost/v1", "https://127.0.0.1/v1", "https://192.168.1.1/v1", "https://[::1]/v1", "https://[fd00::1]/v1", "https://translator.example/#private"]) {
    assert.throws(() => validatePersonalConfig({ ...input, endpoint }, "https://reader.example"));
  }
  assert.throws(() => validatePersonalConfig({ ...input, apiKey: "" }));
  assert.throws(() => validatePersonalConfig({ ...input, model: "" }));
});

test("personal requests go directly to the configured endpoint without site cookies or redirects", async () => {
  const title = await translatePersonalTitle(config(), "Open source tools", { fetcher: async (url, request) => {
    assert.equal(url, "https://translator.example/v1/chat/completions");
    assert.equal(request.mode, "cors");
    assert.equal(request.credentials, "omit");
    assert.equal(request.referrerPolicy, "no-referrer");
    assert.equal(request.redirect, "error");
    assert.equal(request.cache, "no-store");
    assert.equal(request.headers.Authorization, `Bearer ${input.apiKey}`);
    const body = JSON.parse(request.body);
    assert.equal(body.stream, false);
    assert.equal(body.model, input.model);
    assert.match(body.messages[0].content, /\[S0000\] Open source tools/);
    return response("开源工具");
  } });
  assert.equal(title, "开源工具");
});

test("DeepLX supports token-bearing URLs without adding an unrelated bearer key", async () => {
  const settings = validatePersonalConfig({ ...input, provider: "deeplx", endpoint: "https://translator.example/private-token/translate", model: "", apiKey: "" });
  assert.equal(settings.apiKey, "");
  assert.equal(await translatePersonalTitle(settings, "Hello", { fetcher: async (url, request) => {
    assert.equal(url, settings.endpoint);
    assert.equal(request.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(request.body), { text: "Hello", source_lang: "auto", target_lang: "ZH" });
    return Response.json({ code: 200, data: "你好" });
  } }), "你好");
});

test("CORS failures never retry through the site and never expose credentials", async () => {
  let calls = 0;
  await assert.rejects(translatePersonalTitle(config(), "Hello", { fetcher: async () => {
    calls++;
    throw new Error(`Failed ${input.apiKey} at private-token URL`);
  } }), error => {
    assert.equal(error.code, "NETWORK");
    assert.match(error.message, /CORS/);
    assert.ok(!error.message.includes(input.apiKey));
    assert.ok(!error.message.includes("private-token"));
    return true;
  });
  assert.equal(calls, 1);
});

test("HTTP, moderation, malformed and truncated results fail safely", async () => {
  for (const [fetcher, code] of [
    [async () => new Response("private error body", { status: 401 }), "HTTP"],
    [async () => Response.json({ choices: [{ finish_reason: "content_filter", message: { content: "" } }] }), "FILTERED"],
    [async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "[S0000] 半句" } }] }), "FORMAT"],
    [async () => Response.json(null), "FORMAT"],
    [async () => Response.json({ choices: [] }), "FORMAT"],
    [async () => Response.json({ choices: [{ message: { content: "[S0001] Wrong ID" } }] }), "FORMAT"],
    [async () => new Response("not JSON"), "FORMAT"],
  ]) {
    await assert.rejects(translatePersonalTitle(config(), "Hello", { fetcher }), error => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes("private error body"));
      return true;
    });
  }
});

test("configuration alone does not request translations while the site is healthy", async () => {
  let calls = 0;
  const translator = createPersonalTranslator({ fetcher: async () => { calls++; return response("你好"); } });
  translator.enable(input);
  translator.request("Hello");
  assert.equal(calls, 0);
  assert.equal(translator.snapshot().active, true);
  assert.equal(JSON.stringify(translator.snapshot()).includes(input.apiKey), false);
  translator.disable();
});

test("missing visible titles are deduplicated, serialized and cached only in page memory", async () => {
  let active = 0, max = 0, calls = 0;
  const translator = createPersonalTranslator({ intervalMs: 0, fetcher: async () => {
    active++; max = Math.max(active, max); calls++;
    await delay(1); active--;
    return response("译文");
  } });
  translator.enable(input); translator.setAvailable(true);
  for (const title of ["Hello", "Hello", "World", "World"]) translator.request(title);
  await until(() => translator.get("World"));
  translator.request("Hello");
  assert.equal(calls, 2);
  assert.equal(max, 1);
  assert.equal(translator.get("Hello"), "译文");
  const freshPage = createPersonalTranslator();
  assert.equal(freshPage.get("Hello"), undefined);
  assert.equal(freshPage.snapshot().active, false);
  translator.disable();
  assert.equal(translator.get("Hello"), undefined);
});

test("a filtered title does not stop another visible title", async () => {
  let calls = 0;
  const translator = createPersonalTranslator({ intervalMs: 0, fetcher: async () => ++calls === 1
    ? Response.json({ choices: [{ finish_reason: "content_filter", message: { content: "" } }] }) : response("正常译文") });
  translator.enable(input); translator.setAvailable(true);
  translator.request("Filtered"); translator.request("Allowed");
  await until(() => translator.get("Allowed"));
  assert.equal(translator.snapshot().paused, false);
  assert.equal(translator.get("Filtered"), undefined);
  assert.equal(calls, 2);
  translator.disable();
});

test("connection failures pause the personal queue instead of burning through all titles", async () => {
  let calls = 0;
  const translator = createPersonalTranslator({ fetcher: async () => { calls++; throw new TypeError("Failed to fetch"); } });
  translator.enable(input); translator.setAvailable(true);
  translator.request("Hello"); translator.request("World");
  await until(() => translator.snapshot().paused);
  translator.request("Third");
  assert.equal(calls, 1);
  translator.disable();
});

test("clearing credentials aborts pending work and discards late results", async () => {
  let release;
  let signal;
  const translator = createPersonalTranslator({ fetcher: async (_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { release = resolve; });
  } });
  translator.enable(input); translator.setAvailable(true); translator.request("Hello");
  translator.disable();
  assert.equal(signal.aborted, true);
  release(response("不应显示"));
  await delay(1);
  assert.equal(translator.get("Hello"), undefined);
  assert.equal(translator.snapshot().active, false);
});

test("site recovery cancels queued work and does not spend personal API credits", async () => {
  let calls = 0;
  const translator = createPersonalTranslator({ intervalMs: 1000, fetcher: async () => { calls++; return response("你好"); } });
  translator.enable(input); translator.setAvailable(true);
  translator.request("Hello"); translator.request("World");
  await until(() => translator.get("Hello"));
  translator.setAvailable(false);
  translator.request("Another");
  assert.equal(calls, 1);
  assert.equal(translator.get("Hello"), "你好");
  translator.disable();
});

test("translation transport and settings delegate storage without a site API path", async () => {
  for (const path of ["src/personal-translation.ts", "src/TranslationSettings.tsx"]) {
    const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie|\/api\//);
  }
});


test("DeepLX optional key uses a Bearer header without rewriting the endpoint or requiring a model", async () => {
  const settings = validatePersonalConfig({ provider: "deeplx", endpoint: "https://translator.example/translate?region=auto", model: "", apiKey: "  separate-private-key  " });
  assert.equal(settings.apiKey, "separate-private-key");
  assert.equal(settings.model, "");
  assert.equal(await translatePersonalTitle(settings, "Hello", { fetcher: async (url, request) => {
    assert.equal(url, "https://translator.example/translate?region=auto");
    assert.equal(request.headers.Authorization, "Bearer separate-private-key");
    assert.equal(request.mode, "cors");
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "error");
    assert.deepEqual(JSON.parse(request.body), { text: "Hello", source_lang: "auto", target_lang: "ZH" });
    return Response.json({ code: 200, data: "你好" });
  } }), "你好");
});

test("DeepLX optional keys reject invalid header content and remain redacted on failure", async () => {
  const base = { provider: "deeplx", endpoint: "https://translator.example/translate", model: "", apiKey: "" };
  for (const apiKey of ["secret\r\nInjected: yes", "x".repeat(8193)]) assert.throws(() => validatePersonalConfig({ ...base, apiKey }));
  const config = validatePersonalConfig({ ...base, apiKey: "private-deeplx-key" });
  await assert.rejects(translatePersonalTitle(config, "Hello", { fetcher: async () => { throw new Error(config.apiKey); } }), error => {
    assert.equal(error.code, "NETWORK");
    assert.ok(!error.message.includes(config.apiKey));
    return true;
  });
});


test("DeepLX separate header key survives browser storage roundtrip and can be cleared", () => {
  const storage = memoryStorage();
  const deeplx = { provider: "deeplx", endpoint: "https://translator.example/translate", model: "", apiKey: "dummy-header-key" };
  assert.equal(savePersonalConfig(deeplx, storage, origin), true);
  assert.deepEqual(readPersonalConfig(storage, origin), deeplx);
  assert.equal(clearPersonalConfig(storage), true);
  assert.equal(readPersonalConfig(storage, origin), null);
});
