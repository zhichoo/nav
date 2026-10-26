import test from "node:test";
import assert from "node:assert/strict";
import { parseModelTitles, translateMissing, translationKey } from "../server/translation.mjs";

const config = { provider: "openai", apiKey: "private-test-key", baseUrl: "https://translator.example/v1", model: "test-model", intervalMs: 0 };
const sources = [{ articles: [{ title: "Hello" }, { title: "World" }] }];
test("compatible model responses support JSON and a single enclosing markdown fence", () => {
  assert.deepEqual(parseModelTitles('{"titles":["你好", "世界"]}', 2), ["你好", "世界"]);
  assert.deepEqual(parseModelTitles('```json\n{"titles":["你好", "世界"]}\n```', 2), ["你好", "世界"]);
  for (const value of [null, '{"titles":["你好"]}', 'prefix {"titles":["你好", "世界"]}', '{"titles":["你好", ""]}']) assert.throws(() => parseModelTitles(value, 2));
});
test("model translation posts bounded chunks and reuses successful cached results", async () => {
  let calls = 0, progress = 0;
  const cache = {};
  const options = { ...config, chunkSize: 1, onProgress: async () => { progress++; }, fetcher: async (url, request) => {
    assert.equal(url, "https://translator.example/v1/chat/completions");
    assert.equal(request.headers.Authorization, "Bearer private-test-key");
    const body = JSON.parse(request.body);
    assert.equal(body.model, "test-model");
    assert.equal(body.max_tokens, 4096);
    assert.deepEqual(JSON.parse(body.messages[1].content).titles, [calls++ === 0 ? "Hello" : "World"]);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ titles: [calls === 1 ? "你好" : "世界"] }) } }] });
  } };
  assert.equal(await translateMissing(sources, cache, options), true);
  assert.equal(await translateMissing(sources, cache, options), false);
  assert.equal(calls, 2);
  assert.equal(progress, 2);
  assert.equal(cache[translationKey("World")], "世界");
});
test("later model failures retain earlier chunks and redact transport secrets", async () => {
  const cache = {};
  let calls = 0;
  await assert.rejects(translateMissing(sources, cache, { ...config, chunkSize: 1, fetcher: async () => {
    if (calls++) throw new Error("private-test-key in private endpoint");
    return Response.json({ choices: [{ message: { content: '{"titles":["你好"]}' } }] });
  } }), { message: "Translation connection failed or timed out" });
  assert.equal(cache[translationKey("Hello")], "你好");
  assert.equal(cache[translationKey("World")], undefined);
});

test("translation models use numbered plain text without forcing JSON response format", async () => {
  const cache = {};
  await translateMissing(sources, cache, { ...config, model: "hy-mt2-pro", format: "numbered", fetcher: async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.model, "hy-mt2-pro");
    assert.equal(body.stream, false);
    assert.equal(body.response_format, undefined);
    assert.equal(body.messages.length, 1);
    assert.match(body.messages[0].content, /\[S0000\] Hello\n\[S0001\] World/);
    return Response.json({ choices: [{ message: { content: "[S0000] 你好  \n[S0001] 世界" } }] });
  } });
  assert.equal(cache[translationKey("Hello")], "你好");
  assert.equal(cache[translationKey("World")], "世界");
});
