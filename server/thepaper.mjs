// Read only the official channel's server-rendered list, not unrelated recommendations.
export function parseThePaperNews(html) {
  const raw = String(html).match(/<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i)?.[1];
  if (!raw) throw new Error("Missing The Paper channel data");
  const payload = JSON.parse(raw);
  const rows = payload?.props?.pageProps?.data?.list;
  if (payload.page !== "/channel/[id]" || String(payload.query?.id) !== "25950" || !Array.isArray(rows)) {
    throw new Error("Invalid The Paper current affairs channel");
  }
  return rows.flatMap(item => {
    if (!item || !/^[1-9]\d*$/.test(String(item.contId ?? "")) || !Number.isSafeInteger(Number(item.contId))) return [];
    if (typeof item.name !== "string" || !item.name.trim()) return [];
    let url;
    if (item.link) {
      try { url = new URL(item.link, "https://m.thepaper.cn"); } catch { return []; }
      if (url.protocol !== "https:" || !["m.thepaper.cn", "www.thepaper.cn"].includes(url.hostname) || url.username || url.password) return [];
    } else {
      // Other forward types can represent special pages rather than article IDs.
      if (!["0", "74"].includes(String(item.forwardType))) return [];
      url = new URL(`https://m.thepaper.cn/newsDetail_forward_${item.contId}`);
    }
    const published = typeof item.pubTimeLong === "number" && item.pubTimeLong > 0 ? new Date(item.pubTimeLong) : null;
    return [{
      title: item.name,
      url: url.href,
      image: item.smallPic || item.pic || null,
      publishedAt: published && Number.isFinite(published.getTime()) ? published.toISOString() : null,
      tags: typeof item.nodeInfo?.name === "string" ? [item.nodeInfo.name] : [],
    }];
  });
}
