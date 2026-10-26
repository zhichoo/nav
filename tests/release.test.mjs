import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { checkRelease } from "../scripts/check-release.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "nav-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "--quiet");
  const write = async (path, value) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), value); };
  return { root, git, write };
}
const token = () => ["sk", "aB9".repeat(16)].join("-");

test("release check accepts source, placeholders and explicitly allowed production files", async t => {
  const { root, git, write } = await fixture(t);
  await write(".env.example", "TRANSLATION_API_KEY=\n");
  await write("src/App.tsx", "export default function App() {}\n");
  git("add", ".");
  await write(".gitignore", "dist/\n.wrangler/\n");
  for (const path of ["index.html", "favicon.svg", "_headers", ".assetsignore", "assets/index-Ab09.js", "assets/index-Ab09.css"]) await write(`dist/${path}`, "safe");
  for (const path of ["index.js", "index.js.map", "README.md"]) await write(`.wrangler/build/${path}`, "safe");
  assert.deepEqual(await checkRelease(root, { dist: true, worker: true }), []);
});

test("private or generated files cannot be committed even with force-add", async t => {
  const { root, git, write } = await fixture(t);
  await write(".gitignore", "*\n");
  const paths = [".env", ".dev.vars", ".cache/feeds.json", "reference/mirror.html", "public/baseline/index.html", "dist/index.html", "private.pem", "debug.log", "backup.zip", "local-ops/OPERATIONS.md"];
  for (const path of paths) await write(path, "private");
  git("add", "--force", ...paths);
  const issues = await checkRelease(root);
  for (const path of paths) assert.ok(issues.some(issue => issue.startsWith(`${path}:`)), path);
});

test("staged credentials are found even after the working copy has been cleaned", async t => {
  const { root, git, write } = await fixture(t);
  await write("config.mjs", token());
  git("add", "config.mjs");
  await write("config.mjs", "clean");
  const issues = await checkRelease(root);
  assert.ok(issues.some(issue => issue.startsWith("index:config.mjs:")));
  assert.ok(!issues.join("\n").includes(token()));
});

test("nonstandard provider secrets in ignored local env files are checked without logging values", async t => {
  const { root, write } = await fixture(t);
  const secret = ["local", "provider", "value", "123456789"].join("_");
  await write(".gitignore", ".env.local\n");
  await write(".env.local", `TRANSLATION_API_KEY=${secret}\n`);
  await write("README.md", `accidental example: ${secret}`);
  const issues = await checkRelease(root);
  assert.ok(issues.some(issue => issue.startsWith("README.md:")));
  assert.ok(!issues.join("\n").includes(secret));
});

test("history scan catches credentials removed from the current tree", async t => {
  const { root, git, write } = await fixture(t);
  const commit = () => git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
  await write("old.mjs", token()); git("add", "."); commit();
  await write("old.mjs", "clean"); git("add", "."); commit();
  assert.deepEqual(await checkRelease(root), []);
  const issues = await checkRelease(root, { history: true });
  assert.ok(issues.some(issue => issue.startsWith("history:old.mjs:")));
  assert.ok(!issues.join("\n").includes(token()));
});

test("production output rejects extra files and scans frontend and Worker contents", async t => {
  const { root, write } = await fixture(t);
  await write(".gitignore", "dist/\n.wrangler/\n");
  await write("dist/index.html", "safe");
  await write("dist/assets/index.js", token());
  await write("dist/baseline/index.html", "private reference");
  await write("dist/assets/index.js.map", "private source map");
  await write(".wrangler/build/index.js", token());
  const issues = await checkRelease(root, { dist: true, worker: true });
  for (const path of ["dist/assets/index.js", "dist/baseline/index.html", "dist/assets/index.js.map", ".wrangler/build/index.js"]) assert.ok(issues.some(issue => issue.startsWith(`${path}:`)), path);
});

test("symlinks cannot smuggle outside files into Git or production assets", async t => {
  const { root, git, write } = await fixture(t);
  await write("safe.txt", "safe");
  await symlink("safe.txt", join(root, "linked.txt"));
  git("add", "linked.txt");
  const issues = await checkRelease(root);
  assert.ok(issues.some(issue => issue.startsWith("linked.txt:")));
  assert.ok(issues.some(issue => issue.startsWith("index:linked.txt:")));
});

test("requested but missing build directories fail closed", async t => {
  const { root } = await fixture(t);
  await assert.rejects(checkRelease(root, { dist: true }), { code: "ENOENT" });
});
