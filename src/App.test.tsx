import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { TranslationProvider } from "./i18n/TranslationProvider";

vi.mock("./demoData", () => ({
  demoRepositories: [
    {
      path: "/workspace/ene-con-tilde",
      name: "ñ-repo",
      branch: "main",
      upstream: "origin/main",
      detached: false,
      headShort: "abc1234",
      remoteName: "origin",
      remoteUrl: "https://github.com/demo/ene-con-tilde.git",
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      changedFiles: 0,
      lastCommit: "initial",
      checkedAt: 0,
    },
    {
      path: "/workspace/ene",
      name: "n-repo",
      branch: "main",
      upstream: "origin/main",
      detached: false,
      headShort: "def5678",
      remoteName: "origin",
      remoteUrl: "https://github.com/demo/ene.git",
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      changedFiles: 0,
      lastCommit: "initial",
      checkedAt: 0,
    },
  ],
  demoChanges: {},
  demoDiffs: {},
}));

function visibleNames() {
  return Array.from(document.querySelectorAll(".repository-name"), (node) => node.textContent);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ordinamento localizzato", () => {
  it("riordina le repository gia caricate quando cambia la lingua", async () => {
    const user = userEvent.setup();
    render(
      <TranslationProvider>
        <App />
      </TranslationProvider>,
    );

    // In inglese n e ñ sono equivalenti con sensitivity=base, quindi resta
    // l'ordine di caricamento. In spagnolo ñ segue n.
    expect(visibleNames()).toEqual(["ñ-repo", "n-repo"]);

    await user.click(screen.getByRole("button", { name: /English/ }));
    await user.click(screen.getByRole("option", { name: /Español/ }));

    await waitFor(() => expect(visibleNames()).toEqual(["n-repo", "ñ-repo"]));
  });
});
