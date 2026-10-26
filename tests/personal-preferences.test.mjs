import test from "node:test";
import assert from "node:assert/strict";
import { PERSONAL_PREFERENCE_KEY, savePersonalConfig, readPersonalConfig, clearPersonalConfig } from "../src/personal-preferences.ts";

const origin = "https://reader.example";
const input = { provider: "openai", endpoint: "https://translator.example/v1", model: "hy-mt2-pro", apiKey: "private-browser-only-key" };
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test("OpenAI preferences survive browser storage roundtrip with normalized endpoint", () => {
  const storage = memoryStorage();
  assert.equal(savePersonalConfig(input, storage, origin), true);
  assert.deepEqual(readPersonalConfig(storage, origin), { ...input, endpoint: `${input.endpoint}/chat/completions` });
  assert.equal(clearPersonalConfig(storage), true);
  assert.equal(readPersonalConfig(storage, origin), null);
});

test("DeepLX URL-token and separate-key settings both survive local storage", () => {
  for (const config of [
    { provider: "deeplx", endpoint: "https://translator.example/private-token/translate", model: "", apiKey: "" },
    { provider: "deeplx", endpoint: "https://translator.example/translate", model: "", apiKey: "dummy-header-key" },
  ]) {
    const storage = memoryStorage();
    assert.equal(savePersonalConfig(config, storage, origin), true);
    assert.deepEqual(readPersonalConfig(storage, origin), config);
    assert.equal(clearPersonalConfig(storage), true);
    assert.equal(readPersonalConfig(storage, origin), null);
  }
});

test("corrupt, oversized, unknown-version and invalid preferences are not restored", () => {
  const storage = memoryStorage();
  const saved = config => JSON.stringify({ version: 1, config });
  for (const value of ["{", "null", "x".repeat(20001), "{}", JSON.stringify({ version: 2, config: input }),
    saved(null), saved({ ...input, apiKey: 123 }), saved({ ...input, provider: "unknown" }),
    saved({ ...input, model: "" }), saved({ ...input, endpoint: `${origin}/api/translate` })]) {
    storage.setItem(PERSONAL_PREFERENCE_KEY, value);
    assert.equal(readPersonalConfig(storage, origin), null);
  }
});

test("blocked storage fails safely for reading, saving and clearing", () => {
  const denied = () => { throw new Error("Storage blocked"); };
  const storage = { getItem: denied, setItem: denied, removeItem: denied };
  assert.equal(readPersonalConfig(storage, origin), null);
  assert.equal(savePersonalConfig(input, storage, origin), false);
  assert.equal(clearPersonalConfig(storage), false);
});

test("invalid input is rejected before writing browser preferences", () => {
  const storage = memoryStorage();
  assert.throws(() => savePersonalConfig({ ...input, endpoint: "http://translator.example" }, storage, origin));
  assert.equal(storage.getItem(PERSONAL_PREFERENCE_KEY), null);
});
