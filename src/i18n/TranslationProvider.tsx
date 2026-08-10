import { useCallback, useEffect, useMemo, useState } from "react";
import { TranslationContext, format, type Translation } from "./context";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LOCALES,
  MESSAGES,
  type Language,
  type MessageId,
} from "./dictionary";
import type { Params } from "./context";

const LANGUAGE_KEY = "rubyrepo.language";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    // Storage unavailable: English, like a first run.
    return DEFAULT_LANGUAGE;
  }
}

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(readStoredLanguage);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // Persisting the choice is a convenience, not a requirement.
    }
    // The document language matters to screen readers and to hyphenation.
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (id: MessageId, params?: Params) => format(MESSAGES[id][language], params),
    [language],
  );

  const value = useMemo<Translation>(
    () => ({ language, locale: LOCALES[language], setLanguage, t }),
    [language, t],
  );

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}
