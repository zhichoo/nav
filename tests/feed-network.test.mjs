import test from "node:test";
import assert from "node:assert/strict";
import { fetchSourceDetailed, SOURCES } from "../server/sources.mjs";
import { feedFailure, proxyDispatcher } from "../server/feed-network.mjs";
import { createFeedService } from "../server/feed-service.mjs";

const source = SOURCES[0];
const rss = '<rss><channel><item><title>Network test</title><link>https://example.com/post</link></item></channel></rss>';
const ok = () => new Response(rss);
const failed = code => Object.assign(new Error("private network details"), { code });

test("direct success never invokes a configured proxy", async () => {
  let proxyCalls = 0;
  const result = await fetchSourceDetailed(source, {
    fetcher: async (url, options) => {
      assert.equal(url, source.feed);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.dispatcher, undefined);
      return ok();
    },
    proxyFetcher: async () => { proxyCalls++; return ok(); },
  });
  assert.equal(result.transport, "direct");
  assert.equal(proxyCalls, 0);
  assert.deepEqual(result.attempts, []);
});

test("reset, DNS and upstream denial retry the same URL via proxy", async t => {
  for (const [code, expected] of [["ECONNRESET", "RESET"], ["ENOTFOUND", "DNS"], ["HTTP_403", "HTTP_403"], ["HTTP_429", "HTTP_429"]]) {
    await t.test(code, async () => {
      const result = await fetchSourceDetailed(source, {
        fetcher: async () => {
          if (code.startsWith("HTTP_")) return new Response("denied", { status: Number(code.slice(5)) });
          throw failed(code);
        },
        proxyFetcher: async url => { assert.equal(url, source.feed); return ok(); },
      });
      assert.equal(result.transport, "proxy");
      assert.equal(result.articles.length, 1);
      assert.equal(result.attempts[0].code, expected);
      assert.equal(result.attempts[0].route, "direct");
    });
  }
});

test("abort deadline falls back to proxy and is classified as timeout", async () => {
  const result = await fetchSourceDetailed(source, {
    directTimeoutMs: 2,
    fetcher: async (_url, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(ok()), 1000);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }),
    proxyFetcher: async () => ok(),
  });
  assert.equal(result.transport, "proxy");
  assert.equal(result.attempts[0].code, "TIMEOUT");
});

test("successful HTTP with unusable HTML retries, and both parse failures are explicit", async () => {
  const options = { fetcher: async () => new Response("<html>Blocked</html>"), proxyFetcher: async () => ok() };
  const result = await fetchSourceDetailed(source, options);
  assert.equal(result.attempts[0].code, "PARSE");
  assert.equal(result.transport, "proxy");
  await assert.rejects(fetchSourceDetailed(source, { ...options, proxyFetcher: options.fetcher }), error => {
    assert.equal(error.feedCode, "PARSE");
    assert.deepEqual(error.attempts.map(item => item.route), ["direct", "proxy"]);
    return true;
  });
});

test("body read network failures are not mislabeled as malformed RSS", async () => {
  const result = await fetchSourceDetailed(source, {
    fetcher: async () => ({ ok: true, text: async () => { throw failed("ECONNRESET"); } }),
    proxyFetcher: async () => ok(),
  });
  assert.equal(result.attempts[0].code, "RESET");
});

test("both HTTP 404 failures preserve safe status and route diagnostics", async () => {
  const fetcher = async () => new Response("Not found", { status: 404 });
  await assert.rejects(fetchSourceDetailed(source, { fetcher, proxyFetcher: fetcher }), error => {
    assert.equal(error.feedCode, "HTTP_404");
    assert.match(error.message, /订阅地址不存在/);
    assert.match(error.message, /直连与代理均未成功/);
    assert.equal(error.attempts.length, 2);
    return true;
  });
});

test("raw network details and proxy credentials never enter public errors", async () => {
  const secret = "private-password-and-token";
  const fetcher = async () => { throw new Error(`https://user:${secret}@proxy.invalid`); };
  await assert.rejects(fetchSourceDetailed(source, { fetcher, proxyFetcher: fetcher }), error => {
    assert.ok(!JSON.stringify({ message: error.message, attempts: error.attempts }).includes(secret));
    return true;
  });
  await assert.rejects(fetchSourceDetailed(source, { fetcher, proxyUrl: `socks5://user:${secret}@127.0.0.1:7890` }), error => {
    assert.equal(error.feedCode, "PROXY_CONFIG");
    assert.ok(!error.message.includes(secret));
    return true;
  });
  assert.equal(feedFailure(failed("ECONNREFUSED"), "proxy").code, "REFUSED");
  assert.throws(() => proxyDispatcher("not a URL"), /Invalid FEED_PROXY_URL/);
});

test("without proxy there is only one attempt", async () => {
  let calls = 0;
  await assert.rejects(fetchSourceDetailed(source, {
    proxyUrl: "",
    fetcher: async () => { calls++; throw failed("ECONNRESET"); },
  }), error => {
    assert.equal(error.attempts.length, 1);
    assert.match(error.message, /直连未成功/);
    return true;
  });
  assert.equal(calls, 1);
});

test("refresh records proxy recovery, and later dual failure retains cached articles", async () => {
  let now = Date.parse("2026-10-24T00:00:00Z");
  let fail = false;
  const service = createFeedService({
    sources: [source], clock: () => now,
    fetcher: item => fetchSourceDetailed(item, {
      fetcher: async () => { throw failed("ECONNRESET"); },
      proxyFetcher: async () => { if (fail) throw failed("ECONNREFUSED"); return ok(); },
    }),
  });
  await service.refresh();
  const first = service.snapshot()[0];
  assert.equal(first.transport, "proxy");
  assert.equal(first.status, "live");
  fail = true;
  now += 1000;
  await service.refresh({ force: true });
  const last = service.snapshot()[0];
  assert.equal(last.status, "stale");
  assert.equal(last.errorCode, "REFUSED");
  assert.equal(last.updatedAt, first.updatedAt);
  assert.notEqual(last.checkedAt, first.checkedAt);
  assert.deepEqual(last.articles, first.articles);
  assert.equal(last.attempts.length, 2);
});

test("refresh bounds concurrency and independently persists every source", async () => {
  let active = 0;
  let max = 0;
  let saved = 0;
  const release = [];
  const sources = Array.from({ length: 11 }, (_, i) => ({ ...source, id: `source-${i}` }));
  const service = createFeedService({
    sources, concurrency: 4,
    fetcher: async () => {
      active++;
      max = Math.max(max, active);
      await new Promise(resolve => release.push(resolve));
      active--;
      return [{ title: "Article" }];
    },
    onChange: async () => { saved++; },
  });
  const refreshing = service.refresh();
  assert.equal(active, 4);
  while (saved < sources.length) {
    release.splice(0).forEach(resolve => resolve());
    await new Promise(resolve => setImmediate(resolve));
  }
  await refreshing;
  assert.equal(max, 4);
  assert.equal(saved, sources.length);
  assert.ok(service.snapshot().every(item => item.status === "live"));
});
