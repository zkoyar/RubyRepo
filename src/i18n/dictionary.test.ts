import { describe, expect, it } from "vitest";
import { LANGUAGES, LANGUAGE_NAMES, LOCALES, MESSAGES, type MessageId } from "./dictionary";
import { format } from "./context";

const ids = Object.keys(MESSAGES) as MessageId[];

describe("dictionary", () => {
  // The type system already forbids a missing language, but only for entries
  // written by hand in this file. This checks the object that actually ships.
  it("has every language for every message", () => {
    for (const id of ids) {
      for (const language of LANGUAGES) {
        const text = MESSAGES[id][language];
        expect(text, `${id} is missing ${language}`).toBeTypeOf("string");
        expect(text.trim(), `${id} is empty in ${language}`).not.toBe("");
      }
    }
  });

  // A translation that forgets a placeholder silently drops information — the
  // sentence still reads, so nothing looks wrong.
  it("keeps the same placeholders across languages", () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    for (const id of ids) {
      const expected = placeholders(MESSAGES[id].en);
      for (const language of LANGUAGES) {
        expect(placeholders(MESSAGES[id][language]), `${id} in ${language}`).toEqual(expected);
      }
    }
  });

  it("names every language and gives it a locale", () => {
    for (const language of LANGUAGES) {
      expect(LANGUAGE_NAMES[language]).toBeTruthy();
      expect(LOCALES[language]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      // The locale must be one `Intl` accepts, or every date silently falls
      // back to the system one.
      expect(() => new Intl.DateTimeFormat(LOCALES[language])).not.toThrow();
    }
  });

  it("copre ogni codice di errore generico GitHub", () => {
    const codes = [
      "invalidRequest",
      "network",
      "timeout",
      "invalidResponse",
      "invalidDeviceFlow",
      "noPendingLogin",
      "loginSuperseded",
      "authorizationDenied",
      "authenticationRequired",
      "authenticationExpired",
      "rateLimited",
      "forbidden",
      "notFound",
      "storageUnavailable",
      "internal",
    ] as const;

    for (const code of codes) {
      const id = `github.error.${code}` as MessageId;
      expect(MESSAGES[id], id).toBeDefined();
      for (const language of LANGUAGES) expect(MESSAGES[id][language], `${id}.${language}`).toBeTruthy();
    }
    expect(MESSAGES["github.error.authenticationRequired"].it).toBe(
      "Accedi a GitHub per continuare.",
    );
  });
});

describe("placeholder substitution", () => {
  it("fills the parameters it is given", () => {
    expect(format("{done} operations completed.", { done: 3 })).toBe("3 operations completed.");
    expect(format("Language: {name}", { name: "Deutsch" })).toBe("Language: Deutsch");
  });

  // Leaving `{count}` visible says which translation is wrong; an empty space
  // would hide the mistake.
  it("leaves an unmatched placeholder in place", () => {
    expect(format("{count} skipped")).toBe("{count} skipped");
    expect(format("{count} skipped", { other: 1 })).toBe("{count} skipped");
  });
});
