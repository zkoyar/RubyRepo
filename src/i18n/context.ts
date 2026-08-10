import { createContext, useContext } from "react";
import type { Language, MessageId } from "./dictionary";

/// Context, hook and placeholder substitution.
///
/// These live apart from the provider component because a module that mixes
/// components and plain functions breaks fast refresh: the whole file reloads
/// instead of the component.

/// Parameters filling `{name}` placeholders. Numbers are formatted by the
/// caller, so a translation never has to know how a locale writes them.
export type Params = Record<string, string | number>;

export interface Translation {
  language: Language;
  /// BCP-47 tag for `Intl`, so dates follow the chosen language.
  locale: string;
  setLanguage: (language: Language) => void;
  t: (id: MessageId, params?: Params) => string;
}

export const TranslationContext = createContext<Translation | null>(null);

/// Replaces `{name}` with the matching parameter.
///
/// A placeholder without a parameter is left as written instead of becoming an
/// empty space: a visible `{count}` says which translation is wrong, while a
/// blank hides it.
export function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

export function useTranslation(): Translation {
  const value = useContext(TranslationContext);
  if (!value) {
    throw new Error("useTranslation needs a TranslationProvider above it in the tree.");
  }
  return value;
}
