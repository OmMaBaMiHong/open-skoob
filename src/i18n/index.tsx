import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { zh } from "./zh";
import { en } from "./en";

export type Locale = "zh" | "en";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const messages: Record<Locale, Record<string, string>> = { zh, en };

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let result = template;
  for (const key of Object.keys(params)) {
    result = result.replace("{" + key + "}", String(params[key]));
  }
  return result;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem("skoob-locale");
    if (saved === "en" || saved === "zh") return saved;
    return "zh";
  });

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("skoob-locale", newLocale);
    document.documentElement.lang = newLocale === "zh" ? "zh-CN" : "en";
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const template = messages[locale][key];
    if (template === undefined) {
      console.warn("[i18n] Missing translation for key: " + key);
      return key;
    }
    return interpolate(template, params);
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
