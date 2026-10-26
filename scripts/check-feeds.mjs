import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { SOURCES, fetchSourceDetailed } from "../server/sources.mjs";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

// Use the same routing as the server, with gentle upstream concurrency.
let cursor = 0;
let failed = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < SOURCES.length) {
    const source = SOURCES[cursor++];
    try {
      const { articles, transport, attempts } = await fetchSourceDetailed(source);
      const fallback = attempts.length ? `; fallback after ${attempts.map(item => item.code).join(", ")}` : "";
      console.log(`OK ${source.id}: ${articles.length} articles via ${transport}${fallback}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${source.id} [${error.feedCode}]: ${error.message}`);
    }
  }
}));
console.log(`${SOURCES.length - failed}/${SOURCES.length} sources available`);
if (failed) process.exitCode = 1;
