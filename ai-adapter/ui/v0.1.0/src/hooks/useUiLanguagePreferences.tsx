// SPDX-License-Identifier: MIT
// UI-only preferences: no library activation, model calls, restart or AI waits.
import { useEffect, useRef, useState } from "react";
import { workbenchFetch as fetch } from "../execution-recovery";
import { cacheUiLanguage, isUiLanguage, readCachedUiLanguage, type UiLanguage } from "../ui-language";
type Preference = { locale: UiLanguage; revision: number; source: "explicit" | "library-first-use" | "environment"; initialized: boolean };
function validatePreference(value: any): Preference {
  if (!value?.ok || !isUiLanguage(value.locale) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !["explicit", "library-first-use", "environment"].includes(value.source) || typeof value.initialized !== "boolean" ||
      (value.initialized ? value.revision < 1 : value.revision !== 0)) throw Error(value?.code || value?.error || "UI_PREFERENCES_INVALID_RESPONSE");
  return value;
}
async function readPreferences() {
  const response = await fetch("/api/ui-preferences");
  const value = await response.json();
  if (!response.ok) throw Error(value?.code || value?.error || "UI_PREFERENCES_LOAD_FAILED");
  return validatePreference(value);
}
export function useUiLanguagePreferences() {
  const [lang, setLang] = useState<UiLanguage>(readCachedUiLanguage);
  const [localeReady, setLocaleReady] = useState(false);
  const [localeError, setLocaleError] = useState("");
  const revision = useRef(0), busy = useRef(false), generation = useRef(0), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const epoch = ++generation.current;
    const valid = () => mounted.current && generation.current === epoch;
    (async () => {
      try {
        let prefs = await readPreferences();
        if (!valid()) return;
        if (!prefs.initialized) {
          const response = await fetch("/api/ui-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: prefs.locale, source: prefs.source, expectedRevision: prefs.revision }) });
          const value = await response.json();
          if (!valid()) return;
          // StrictMode/two windows may race first-use CAS. Read the winner once;
          // never retry initialization or overwrite an explicit choice blindly.
          if (response.status === 409 || value?.code === "UI_PREFERENCES_CONFLICT") {
            prefs = await readPreferences();
            if (!prefs.initialized) throw Error("UI_PREFERENCES_CONFLICT");
          } else {
            if (!response.ok) throw Error(value?.code || value?.error || "UI_PREFERENCES_SAVE_FAILED");
            prefs = validatePreference(value);
            if (!prefs.initialized) throw Error("UI_PREFERENCES_INVALID_RESPONSE");
          }
        }
        if (!valid()) return;
        revision.current = prefs.revision; setLang(prefs.locale); cacheUiLanguage(prefs.locale, prefs.revision); setLocaleError("");
      } catch (error: any) { if (valid()) setLocaleError(String(error.message)); }
      finally { if (valid()) setLocaleReady(true); }
    })();
    return () => { mounted.current = false; generation.current++; };
  }, []);
  const selectLanguage = async (locale: UiLanguage) => {
    if (!localeReady || busy.current || !isUiLanguage(locale)) return;
    busy.current = true; setLocaleReady(false);
    const epoch = ++generation.current;
    const valid = () => mounted.current && generation.current === epoch;
    try {
      const response = await fetch("/api/ui-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale, source: "explicit", expectedRevision: revision.current }) });
      const value = await response.json();
      if (!valid()) return;
      if (response.status === 409 || value?.code === "UI_PREFERENCES_CONFLICT") {
        // Refresh only the revision; keep the displayed/cached choice unchanged
        // and ask for another explicit user selection, not automatic write retry.
        const latest = await readPreferences();
        if (valid()) revision.current = latest.revision;
        throw Error("UI_PREFERENCES_CONFLICT");
      }
      if (!response.ok) throw Error(value?.code || value?.error || "UI_PREFERENCES_SAVE_FAILED");
      const saved = validatePreference(value);
      if (!saved.initialized || saved.source !== "explicit" || saved.locale !== locale || saved.revision <= revision.current) throw Error("UI_PREFERENCES_INVALID_RESPONSE");
      if (valid()) { revision.current = saved.revision; setLang(saved.locale); cacheUiLanguage(saved.locale, saved.revision); setLocaleError(""); }
    } catch (error: any) { if (valid()) setLocaleError(String(error.message)); }
    finally { busy.current = false; if (valid()) setLocaleReady(true); }
  };
  return { lang, localeReady, localeError, selectLanguage };
}
