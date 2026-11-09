import test from "node:test";
import assert from "node:assert/strict";
import { isTranslationEnabled, missingTranslationTitles, needsTranslation, translateMissing, translationKey, workersAIRequest, workersAIReservation, WORKERS_AI_MODEL } from "../server/translation.mjs";

const config = { provider: "workers-ai", model: WORKERS_AI_MODEL, batchSize: 16 };
const sources = [{ articles: [{ title: "Hello" }, { title: "World" }] }];

test("Workers AI requires its binding, not an unrelated provider key", () => {
  assert.equal(isTranslationEnabled({ ...config, apiKey: "unused" }), false);
  assert.equal(isTranslationEnabled({ ...config, ai: { run() {} } }), true);
});

test("translation queues skip predominantly Chinese titles, keep foreign scripts and deduplicate missing originals", () => {
  for (const title of ["科技爱好者周刊：本周值得关注的消息", "如何部署 Cloudflare Workers", "2026 / 11 / 09", ""]) assert.equal(needsTranslation(title), false, title);
  for (const title of ["Hello world", "Ask HN: What are you working on?", "What does 中国 mean in this context?", "生成AIの新しい使い方", "새로운 기술", "Les outils du futur"]) assert.equal(needsTranslation(title), true, title);
  const titles = ["Hello", "中文标题", "Hello", "World", "Cached"];
  assert.deepEqual(missingTranslationTitles([{ articles: titles.map(title => ({ title })) }], { [translationKey("Cached")]: "已有译文", [translationKey("World")]: " " }), ["Hello", "World"]);
});

test("Workers AI uses fixed model, bounded output and strict marker mapping, preserving successful cache", async () => {
  const cache = {};
  let calls = 0, progress = 0;
  const options = { ...config, ai: { async run(model, request) {
    calls++;
    assert.equal(model, WORKERS_AI_MODEL);
    assert.deepEqual(request, workersAIRequest(["Hello", "World"]));
    assert.equal(request.chat_template_kwargs.enable_thinking, false);
    assert.equal(request.max_completion_tokens, 2048);
    return { choices: [{ finish_reason: "stop", message: { content: "[S0001] 世界\n[S0000] 你好" } }] };
  } }, onProgress: async () => { progress++; } };
  assert.equal(await translateMissing(sources, cache, options), true);
  assert.equal(await translateMissing(sources, cache, options), false);
  assert.deepEqual(cache, { [translationKey("Hello")]: "你好", [translationKey("World")]: "世界" });
  assert.equal(calls, 1);
  assert.equal(progress, 1);
});

test("truncated, missing and duplicated translations never poison cache, provider errors are redacted", async () => {
  for (const [finish_reason, content] of [["length", "[S0000] 你好\n[S0001] 世界"], ["stop", "[S0000] 你好"], ["stop", "[S0000] 你好\n[S0000] 世界"]]) {
    const cache = {};
    await assert.rejects(translateMissing(sources, cache, { ...config, ai: { async run() { return { choices: [{ finish_reason, message: { content } }] }; } } }));
    assert.deepEqual(cache, {});
  }
  await assert.rejects(translateMissing(sources, {}, { ...config, ai: { async run() { throw new Error("private-provider-details"); } } }), { message: "Workers AI translation failed" });
});

test("unknown models and oversized batches cannot bypass the fixed-model reservation", async () => {
  let calls = 0;
  const ai = { async run() { calls++; } };
  await assert.rejects(translateMissing(sources, {}, { ...config, model: "expensive-model", ai }), /configuration/);
  await assert.rejects(translateMissing([{ articles: Array.from({ length: 17 }, (_, i) => ({ title: `Title ${i}` })) }], {}, { ...config, batchSize: 17, ai }), /configuration/);
  assert.equal(calls, 0);
  assert.ok(workersAIReservation(["Hello"]) > 2048 * 0.0364);
  assert.ok(workersAIReservation(["A".repeat(10000)]) > workersAIReservation(["Hello"]));
});
