import { execFileSync } from "node:child_process";
import { readFile, readdir, lstat } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const tokenPatterns = [
  /\b(?:sk|cfat|cfut)-[A-Za-z0-9_-]{24,}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
];
const example = path => [".env.example", ".dev.vars.example"].includes(basename(path));
const forbidden = path => /(?:^|\/)(?:node_modules|dist|reference|local-ops|\.cache|\.wrangler|\.cloudflare|coverage|screenshots)(?:\/|$)/.test(path)
  || /(?:^|\/)public\/baseline(?:\/|$)/.test(path)
  || (!example(path) && /(?:^|\/)\.(?:env|dev\.vars)(?:\.[^/]*)?$/.test(path))
  || /(?:\.(?:pem|key|p12|pfx|log|tsbuildinfo|zip|tar|tgz)|\.tar\.gz|(?:^|\/)\.DS_Store)$/i.test(path);

export async function checkRelease(root, { dist = false, worker = false, history = false } = {}) {
  const issues = new Set();
  const git = args => execFileSync("git", ["-C", root, ...args], { maxBuffer: 64 * 1024 * 1024 });
  const names = buffer => buffer.toString().split("\0").filter(Boolean);
  const secrets = [];
  for (const name of await readdir(root)) {
    if (!/^\.(?:env|dev\.vars)(?:\.|$)/.test(name) || example(name)) continue;
    if (!(await lstat(resolve(root, name))).isFile()) continue;
    const env = parseEnv(await readFile(resolve(root, name), "utf8"));
    for (const [key, value] of Object.entries(env)) {
      if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|DEEPLX_URL)$/.test(key) && value.length >= 12) secrets.push(value);
    }
  }
  const scan = (label, buffer) => {
    const text = buffer.toString("utf8");
    if (tokenPatterns.some(pattern => pattern.test(text)) || secrets.some(value => text.includes(value))) {
      // Never echo a matching credential, source line or provider response.
      issues.add(`${label}: possible credential (value redacted)`);
    }
  };
  const inspect = async (path, label = path) => {
    const info = await lstat(resolve(root, path));
    if (!info.isFile()) { issues.add(`${label}: non-regular file is not allowed`); return; }
    scan(label, await readFile(resolve(root, path)));
  };
  const tracked = names(git(["ls-files", "--cached", "-z"]));
  const candidates = names(git(["ls-files", "--others", "--exclude-standard", "-z"]));
  for (const path of new Set([...tracked, ...candidates])) {
    if (forbidden(path)) issues.add(`${path}: private/generated file is not allowed in Git`);
    try { await inspect(path); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  // The index may differ from the working tree: check what a commit would actually contain.
  for (const entry of names(git(["ls-files", "--stage", "-z"]))) {
    const [metadata, path] = entry.split("\t");
    const [mode, oid, stage] = metadata.split(" ");
    if (mode !== "100644" && mode !== "100755") issues.add(`index:${path}: non-regular file is not allowed`);
    if (stage !== "0") issues.add(`index:${path}: unresolved merge`);
    scan(`index:${path}`, git(["cat-file", "blob", oid]));
  }
  if (history) {
    const seen = new Set();
    for (const commit of git(["rev-list", "--all"]).toString().trim().split("\n").filter(Boolean)) {
      for (const entry of names(git(["ls-tree", "-r", "-z", commit]))) {
        const [metadata, path] = entry.split("\t");
        const [, type, oid] = metadata.split(" ");
        if (forbidden(path)) issues.add(`history:${path}: private/generated file was committed`);
        if (type !== "blob" || seen.has(oid)) continue;
        seen.add(oid);
        scan(`history:${path}`, git(["cat-file", "blob", oid]));
      }
    }
  }
  const artifacts = async (directory, allowed) => {
    const walk = async (path, prefix = "") => {
      for (const name of await readdir(resolve(root, path))) {
        const relative = `${prefix}${name}`;
        const full = `${path}/${name}`;
        if ((await lstat(resolve(root, full))).isDirectory()) await walk(full, `${relative}/`);
        else {
          if (!allowed(relative)) issues.add(`${full}: unexpected release artifact`);
          await inspect(full);
        }
      }
    };
    await walk(directory);
  };
  if (dist) {
    await artifacts("dist", path => ["index.html", "favicon.svg", "_headers", ".assetsignore"].includes(path)
      || /^assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(path));
    await readFile(resolve(root, "dist/index.html"));
  }
  if (worker) {
    await artifacts(".wrangler/build", path => ["index.js", "index.js.map", "README.md"].includes(path));
    await readFile(resolve(root, ".wrangler/build/index.js"));
  }
  return [...issues];
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    const flags = new Set(process.argv.slice(2));
    const issues = await checkRelease(process.cwd(), { dist: flags.has("--dist"), worker: flags.has("--worker"), history: flags.has("--history") });
    if (issues.length) { console.error(issues.join("\n")); process.exitCode = 1; }
    else console.log("Release check passed: Git candidates/index and requested artifacts contain no blocked files or detected credentials.");
  } catch {
    console.error("Release check could not complete. Check Git availability and requested build directories.");
    process.exitCode = 1;
  }
}
