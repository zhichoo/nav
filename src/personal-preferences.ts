import { validatePersonalConfig } from "./personal-translation.ts";
import type { PersonalConfig } from "./personal-translation.ts";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const PERSONAL_PREFERENCE_KEY = "shixun:personal-translation:v1";
export const emptyPersonalConfig = (): PersonalConfig => ({ provider: "openai", endpoint: "", model: "", apiKey: "" });

function browserStorage(): PreferenceStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function readPersonalConfig(storage = browserStorage(), siteOrigin?: string): PersonalConfig | null {
  try {
    const raw = storage?.getItem(PERSONAL_PREFERENCE_KEY);
    if (!raw || raw.length > 20000) return null;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 || !("config" in saved)) return null;
    const config = saved.config;
    if (!config || typeof config !== "object") return null;
    if (!(["provider", "endpoint", "model", "apiKey"] as const).every(key => key in config && typeof config[key as keyof typeof config] === "string")) return null;
    return validatePersonalConfig(config as PersonalConfig, siteOrigin);
  } catch { return null; }
}

// User-owned device storage only; this module never sends configuration to the server.
export function savePersonalConfig(input: PersonalConfig, storage = browserStorage(), siteOrigin?: string): boolean {
  const config = validatePersonalConfig(input, siteOrigin);
  try {
    if (!storage) return false;
    storage.setItem(PERSONAL_PREFERENCE_KEY, JSON.stringify({ version: 1, config }));
    return true;
  } catch { return false; }
}

export function clearPersonalConfig(storage = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(PERSONAL_PREFERENCE_KEY);
    return true;
  } catch { return false; }
}
