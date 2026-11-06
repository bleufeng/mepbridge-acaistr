// MACAI platform UI language; presentation only, never alters library or draft data.
import { createContext, useContext } from "react";
export type UiLanguage = "zh-CN" | "en-US";
export const UiLanguageContext = createContext<UiLanguage>("zh-CN");
export const useUiLanguage = () => useContext(UiLanguageContext);
export const uiText = (lang: string, zh: string, en: string) => lang === "en-US" ? en : zh;
