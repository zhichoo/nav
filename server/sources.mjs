import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { feedFailure, finalFeedError, proxyDispatcher } from "./feed-network.mjs";

import { parseThePaperNews } from "./thepaper.mjs";

import sourceCatalog from "../shared/sources.json" with { type: "json" };

export const SOURCES = sourceCatalog;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  htmlEntities: false,
});
export const list = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
export const text = (value) =>
  typeof value === "object" && value !== null
    ? String(value["#text"] ?? "")
    : String(value ?? "");
export function cleanText(value) {
  return text(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const number =
        code[0].toLowerCase() === "x"
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return number >= 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : "";
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, entity) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[
          entity
        ],
    )
    .trim();
}
export function safeUrl(value, base) {
  if (!text(value).trim()) return null;
  try {
    const url = new URL(text(value), base);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function normalizeArticle(source, item) {
  const url = safeUrl(item.url, source.home);
  const title = cleanText(item.title);
  if (!url || !title) return null;
  const published = Date.parse(item.publishedAt);
  return {
    id: `${source.id}-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`,
    sourceId: source.id,
    title,
    translatedTitle: null,
    image: safeUrl(item.image, url),
    url,
    domain: new URL(url).hostname.replace(/^www\./, ""),
    publishedAt: Number.isFinite(published)
      ? new Date(published).toISOString()
      : null,
    points:
      Number.isFinite(Number(item.points)) && item.points != null
        ? Number(item.points)
        : null,
    comments:
      Number.isFinite(Number(item.comments)) && item.comments != null
        ? Number(item.comments)
        : null,
    discussionUrl: safeUrl(item.discussionUrl, source.home),
    tags: list(item.tags).map(cleanText).filter(Boolean).slice(0, 3),
  };
}
// Anthropic has no confirmed official RSS. Read only its public news-list rows.
export function parseAnthropicNews(html) {
  return [...String(html).matchAll(/<li\b[^>]*data-listing-row[^>]*>([\s\S]*?)<\/li>/gi)].flatMap(([, row]) => {
    const url = row.match(/href=["'](\/news\/[^"']+)["']/i)?.[1];
    const title = row.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1];
    const time = row.match(/<time\b([^>]*)>([\s\S]*?)<\/time>/i);
    const explicitDate = time?.[1].match(/datetime=["']([^"']+)["']/i)?.[1];
    // Date-only labels are calendar dates, not the server's local midnight.
    const date = Date.parse(`${cleanText(time?.[2])} UTC`);
    const publishedAt = explicitDate || (Number.isFinite(date) ? new Date(date).toISOString() : null);
    return url && title ? [{ url, title, publishedAt }] : [];
  });
}

function nodeSeekUpdatedAt(payload) {
  return typeof payload?.updated_at === "number" && payload.updated_at > 0 ? new Date(payload.updated_at * 1000).toJSON() : null;
}

export function parseSource(source, payload) {
  let items;
  if (source.kind === "anthropic") {
    items = parseAnthropicNews(payload);
  } else if (source.kind === "thepaper") {
    items = parseThePaperNews(payload);
  } else if (source.kind === "nodeseek") {
    if (!payload || !Array.isArray(payload.posts) || !nodeSeekUpdatedAt(payload)) throw new Error("Invalid NodeSeek ranking response");
    items = payload.posts.flatMap(item => {
      const post = item?.post;
      if (!post || !Number.isSafeInteger(post.id) || post.id <= 0) return [];
      return [{
        title: post.title,
        url: `https://www.nodeseek.com/post-${post.id}-1`,
        publishedAt: typeof post.post_timestamp === "number" && post.post_timestamp > 0 ? new Date(post.post_timestamp * 1000).toJSON() : null,
        comments: Number.isInteger(post.comments) && post.comments >= 0 ? post.comments : null,
        discussionUrl: `https://www.nodeseek.com/post-${post.id}-1`,
        tags: typeof post.category === "string" ? [post.category] : [],
      }];
    });
  } else if (source.kind === "nodeloc") {
    if (payload?.topic_list?.filter !== "hot" || !Array.isArray(payload.topic_list.topics)) throw new Error("Invalid NodeLoc hot response");
    items = payload.topic_list.topics.filter(item => item && Number.isSafeInteger(item.id) && item.id > 0 &&
      !item.deleted && !item.deleted_at && item.visible !== false && item.can_read_topic !== false && item.archetype !== "private_message").map(item => ({
      title: typeof item.title === "string" ? item.title : "",
      url: `https://www.nodeloc.com/t/${item.id}`,
      publishedAt: typeof item.created_at === "string" ? item.created_at : null,
      image: typeof item.image_url === "string" ? item.image_url : null,
      // Discourse posts_count includes the original post; reply_count only counts direct replies.
      comments: Number.isSafeInteger(item.posts_count) && item.posts_count > 0 ? item.posts_count - 1 : null,
      discussionUrl: `https://www.nodeloc.com/t/${item.id}`,
      tags: Array.isArray(item.tags) ? item.tags.flatMap(tag => typeof tag === "string" ? [tag] : typeof tag?.name === "string" ? [tag.name] : []) : [],
    }));
  } else if (source.kind === "v2ex") {
    if (!Array.isArray(payload)) throw new Error("Invalid V2EX hot response");
    // Keep the official hot-list order; replies are discussions, not votes.
    items = payload.filter(item => item && !item.deleted && Number.isSafeInteger(item.id) && item.id > 0).map(item => ({
      title: item.title,
      url: `https://www.v2ex.com/t/${item.id}`,
      publishedAt: typeof item.created === "number" && item.created > 0 ? new Date(item.created * 1000).toJSON() : null,
      comments: Number.isInteger(item.replies) && item.replies >= 0 ? item.replies : null,
      discussionUrl: `https://www.v2ex.com/t/${item.id}`,
      tags: item.node?.title ? [item.node.title] : [],
    }));
  } else if (source.kind === "dev") {
    if (!Array.isArray(payload)) throw new Error("Invalid DEV response");
    items = payload.map((item) => ({
      title: item.title,
      url: item.url,
      publishedAt: item.published_at,
      points: item.positive_reactions_count,
      comments: item.comments_count,
      discussionUrl: `${item.url}#comments`,
      tags: item.tag_list,
      image: item.cover_image,
    }));
  } else if (source.kind === "lobsters") {
    if (!Array.isArray(payload)) throw new Error("Invalid Lobsters response");
    items = payload.map((item) => ({
      title: item.title,
      url: item.url || item.comments_url,
      publishedAt: item.created_at,
      points: item.score,
      comments: item.comment_count,
      discussionUrl: item.comments_url,
      tags: item.tags,
    }));
  } else {
    const xml = parser.parse(payload);
    const raw =
      xml.rss?.channel?.item ?? xml.feed?.entry ?? xml["rdf:RDF"]?.item;
    if (!raw) throw new Error("Feed contains no articles");
    items = list(raw).map((item) => {
      const links = list(item.link);
      const link =
        links.find((entry) => entry?.["@_rel"] === "alternate") ?? links[0];
      const description = text(item.description);
      const content = text(
        item["content:encoded"] ?? item.content ?? item.description,
      );
      const thumbnail =
        list(item["media:thumbnail"])[0] ?? list(item["media:content"])[0];
      const enclosure = list(item.enclosure).find((entry) =>
        String(entry["@_type"] || "").startsWith("image/"),
      );
      const image =
        thumbnail?.["@_url"] ??
        enclosure?.["@_url"] ??
        content.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
      const points =
        item["hn:score"] ??
        (source.id === "hn"
          ? description.match(/<p>Points:\s*(\d+)/i)?.[1]
          : null);
      const comments =
        item["hn:comments"] ??
        (source.id === "hn"
          ? description.match(/<p># Comments:\s*(\d+)/i)?.[1]
          : null);
      return {
        title: item.title,
        image,
        url:
          typeof link === "object" ? (link["@_href"] ?? link["#text"]) : link,
        publishedAt: text(
          item.pubDate ?? item.published ?? item.updated ?? item["dc:date"],
        ),
        points,
        comments,
        discussionUrl: text(item.comments),
        tags: list(item.category).map(
          (category) => category?.["@_term"] ?? text(category),
        ),
      };
    });
  }
  const seen = new Set();
  const articles = items
    .map((item) => normalizeArticle(source, item))
    .filter((item) => {
      if (!item || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, 24);
  return source.id === "hn"
    ? articles.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    : articles;
}

export async function fetchSourceDetailed(source, {
  fetcher = fetch, proxyFetcher = null, proxyUrl = process.env.FEED_PROXY_URL,
  directTimeoutMs = 10000, proxyTimeoutMs = 18000,
} = {}) {
  const attempts = [];
  for (const route of ["direct", ...(proxyUrl || proxyFetcher ? ["proxy"] : [])]) {
    const signal = AbortSignal.timeout(route === "proxy" ? proxyTimeoutMs : directTimeoutMs);
    try {
      let dispatcher;
      if (route === "proxy" && !proxyFetcher) {
        try { dispatcher = proxyDispatcher(proxyUrl); }
        catch { const error = new Error("Proxy configuration error"); error.feedCode = "PROXY_CONFIG"; throw error; }
      }
      const response = await (route === "proxy" && proxyFetcher ? proxyFetcher : fetcher)(source.feed, {
        headers: {
          "User-Agent": "SignalFeed/0.1 (public feed reader)",
          Accept: "application/rss+xml, application/atom+xml, application/json, text/xml;q=0.9, */*;q=0.5",
        },
        signal,
        ...(dispatcher ? { dispatcher } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const error = new Error(`Upstream HTTP ${response.status}`);
        error.feedCode = `HTTP_${response.status}`; throw error;
      }
      let data;
      try {
        data = ["rss", "anthropic", "thepaper"].includes(source.kind) ? await response.text() : await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) error.feedCode = "PARSE";
        throw error;
      }
      let articles;
      try {
        articles = parseSource(source, data);
        if (!articles.length) throw new Error("Feed contains no usable articles");
      } catch (error) {
        error.feedCode = "PARSE";
        throw error;
      }
      return { articles, transport: route, attempts, ...(source.kind === "nodeseek" ? { upstreamUpdatedAt: nodeSeekUpdatedAt(data) } : {}) };
    } catch (error) {
      attempts.push(feedFailure(signal.aborted ? signal.reason : error, route));
    }
  }
  throw finalFeedError(attempts);
}

// The array-only adapter remains useful to existing consumers and test fixtures.
export async function fetchSource(source, fetcher) {
  const result = await fetchSourceDetailed(source, fetcher ? { fetcher, proxyUrl: "" } : {});
  return result.articles;
}
