import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { LANGUAGES, LANGUAGE_NAMES, type Language } from "./dictionary";
import { France, Germany, Italy, Spain, UnitedKingdom } from "./flags";
import { useTranslation } from "./context";

const FLAGS: Record<Language, (props: { title: string }) => React.ReactElement> = {
  en: UnitedKingdom,
  it: Italy,
  fr: France,
  es: Spain,
  de: Germany,
};

/// Flag menu in the top bar.
///
/// Each language names itself — a reader looking for Deutsch is not helped by
/// "German" — so the labels come from `LANGUAGE_NAMES` and are never
/// translated.
export function LanguageSelector() {
  const { language, setLanguage, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const Current = FLAGS[language];

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="language-selector" ref={containerRef}>
      <button
        type="button"
        className="language-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("language.current", { name: LANGUAGE_NAMES[language] })}
        title={t("language.choose")}
      >
        <Current title={LANGUAGE_NAMES[language]} />
        <ChevronDown aria-hidden="true" />
      </button>

      {open && (
        <ul className="language-menu" role="listbox" aria-label={t("language.choose")}>
          {LANGUAGES.map((candidate) => {
            const Flag = FLAGS[candidate];
            const selected = candidate === language;
            return (
              <li key={candidate}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? "is-selected" : ""}
                  onClick={() => {
                    setLanguage(candidate);
                    setOpen(false);
                  }}
                >
                  <Flag title={LANGUAGE_NAMES[candidate]} />
                  <span>{LANGUAGE_NAMES[candidate]}</span>
                  {selected && <Check aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
