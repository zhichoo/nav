import { ProxyAgent } from "undici";

const agents = new Map();
export function proxyDispatcher(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid FEED_PROXY_URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("FEED_PROXY_URL requires an HTTP(S) proxy");
  if (!agents.has(url.href)) agents.set(url.href, new ProxyAgent(url.href));
  return agents.get(url.href);
}
export function feedFailure(error, route) {
  const code = error.feedCode || (error.name === "TimeoutError" ? error.name : error.cause?.code || error.code || error.name);
  if (/^HTTP_\d+$/.test(code)) {
    const status = Number(code.slice(5));
    return { route, code, message: status === 404 || status === 410 ? `订阅地址不存在（HTTP ${status}）` : status === 401 || status === 403 ? `上游拒绝访问（HTTP ${status}）` : status === 429 ? "上游限流（HTTP 429）" : `上游服务错误（HTTP ${status}）` };
  }
  if (["TimeoutError", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code)) return { route, code: "TIMEOUT", message: "连接或读取超时" };
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return { route, code: "DNS", message: "域名解析失败" };
  if (["ECONNRESET", "UND_ERR_SOCKET"].includes(code)) return { route, code: "RESET", message: "网络连接被重置" };
  if (code === "ECONNREFUSED") return { route, code: "REFUSED", message: route === "proxy" ? "无法连接本机代理" : "连接被拒绝" };
  if (/CERT|TLS|SSL/.test(code || "")) return { route, code: "TLS", message: "TLS / 证书连接失败" };
  if (code === "PARSE") return { route, code, message: "响应不是可用订阅，或内容格式发生变化" };
  if (code === "PROXY_CONFIG") return { route, code, message: "代理地址配置无效" };
  return { route, code: "NETWORK", message: "网络请求失败" };
}
export function finalFeedError(attempts) {
  const last = attempts.at(-1);
  const suffix = attempts.length > 1 ? "；直连与代理均未成功" : "；直连未成功";
  const error = new Error(`${last.message}${suffix}`);
  error.feedCode = last.code;
  error.attempts = attempts;
  return error;
}
