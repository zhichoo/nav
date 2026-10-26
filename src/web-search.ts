export const SEARCH_ENGINES = [
  { id: "google", name: "Google", action: "https://www.google.com/search", parameter: "q" },
  { id: "bing", name: "Bing", action: "https://www.bing.com/search", parameter: "q" },
  { id: "duckduckgo", name: "DuckDuckGo", action: "https://duckduckgo.com/", parameter: "q" },
] as const;

export function searchEngine(id: string) {
  return SEARCH_ENGINES.find(engine => engine.id === id) || SEARCH_ENGINES[0];
}
