import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { LanguageSelector } from "./LanguageSelector";
import { TranslationProvider } from "./TranslationProvider";
import { useTranslation } from "./context";
import { LANGUAGE_NAMES } from "./dictionary";

/// Shows a translated string next to the selector, so a test can tell that
/// choosing a language actually changed what the application says.
function Sample() {
  const { t } = useTranslation();
  return (
    <>
      <LanguageSelector />
      <p data-testid="sample">{t("common.cancel")}</p>
    </>
  );
}

function renderSelector() {
  render(
    <TranslationProvider>
      <Sample />
    </TranslationProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("language selector", () => {
  it("starts in English and offers every language by its own name", async () => {
    const user = userEvent.setup();
    renderSelector();

    expect(screen.getByTestId("sample").textContent).toBe("Cancel");

    await user.click(screen.getByRole("button", { name: /English/ }));
    for (const name of Object.values(LANGUAGE_NAMES)) {
      expect(screen.getByRole("option", { name: new RegExp(name) })).toBeTruthy();
    }
  });

  // The point of the whole feature: choosing a language must change the text,
  // not just the flag.
  it("translates the interface when a language is chosen", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole("button", { name: /English/ }));
    await user.click(screen.getByRole("option", { name: /Deutsch/ }));

    expect(screen.getByTestId("sample").textContent).toBe("Abbrechen");
    expect(document.documentElement.lang).toBe("de");
  });

  it("remembers the choice across a restart", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole("button", { name: /English/ }));
    await user.click(screen.getByRole("option", { name: /Français/ }));
    expect(screen.getByTestId("sample").textContent).toBe("Annuler");

    // Unmounting and mounting again stands in for a restart: the language comes
    // back from storage, not from the default.
    cleanup();
    renderSelector();
    expect(screen.getByTestId("sample").textContent).toBe("Annuler");
  });

  it("closes the menu with Escape", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole("button", { name: /English/ }));
    expect(screen.getByRole("listbox")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  // Flags are drawn inline because Windows has no flag emoji glyphs; if they
  // ever became text again, the accessible name would stop being a flag.
  it("draws each flag as an image with a name", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole("button", { name: /English/ }));
    const flags = screen.getAllByRole("img");
    expect(flags.length).toBeGreaterThanOrEqual(5);
    for (const flag of flags) {
      expect(flag.tagName.toLowerCase()).toBe("svg");
    }
  });
});
