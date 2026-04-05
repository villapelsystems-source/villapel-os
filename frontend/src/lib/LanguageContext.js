import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { messages } from './i18n/messages';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'villapel-lang';
const PRIMARY = 'es';
const SECONDARY = 'en';

function applyVars(template, vars) {
  if (vars == null || typeof template !== 'string') return template;
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(String(v)), template);
}

function detectInitialLang() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === PRIMARY || s === SECONDARY) return s;
  } catch {
    /* ignore */
  }
  return PRIMARY;
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(detectInitialLang);

  const setLang = useCallback((next) => {
    if (next !== PRIMARY && next !== SECONDARY) return;
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key, vars) => {
      const raw = messages[lang]?.[key] ?? messages[PRIMARY]?.[key] ?? messages[SECONDARY]?.[key] ?? key;
      return applyVars(raw, vars);
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      lang: PRIMARY,
      setLang: () => {},
      t: (key, vars) => {
        const raw = messages[PRIMARY]?.[key] ?? messages[SECONDARY]?.[key] ?? key;
        return applyVars(raw, vars);
      },
    };
  }
  return ctx;
}
