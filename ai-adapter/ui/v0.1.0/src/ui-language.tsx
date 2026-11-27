// MACAI platform UI language; presentation only, never alters library or draft data.
import { createContext, useContext } from "react";
export type UiLanguage = "zh-CN" | "en-US";
export const UiLanguageContext = createContext<UiLanguage>("en-US");
export const useUiLanguage = () => useContext(UiLanguageContext);
export const uiText = (lang: string, zh: string, en: string) => lang === "en-US" ? en : zh;

// Cache is only a first-paint hint. Server preferences remain authoritative.
export const UI_LANGUAGE_CACHE_KEY = "mepbridge_ui_language_v1";
export const isUiLanguage = (value: unknown): value is UiLanguage => value === "en-US" || value === "zh-CN";
export function readCachedUiLanguage(): UiLanguage {
  try {
    const cached = JSON.parse(localStorage.getItem(UI_LANGUAGE_CACHE_KEY) || "null");
    if (cached?.version === 1 && isUiLanguage(cached.locale) && Number.isSafeInteger(cached.revision) && cached.revision >= 1) return cached.locale;
  } catch { /* Restricted or corrupt cache must not block the workbench. */ }
  return "en-US";
}
export function cacheUiLanguage(locale: UiLanguage, revision: number) {
  try { localStorage.setItem(UI_LANGUAGE_CACHE_KEY, JSON.stringify({ version: 1, locale, revision })); } catch { /* Server has already persisted the choice. */ }
}
