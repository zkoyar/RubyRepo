import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommitDialog } from "./CommitDialog";
import { TranslationProvider } from "../i18n/TranslationProvider";
import type { RepositoryInfo } from "../types";

function repository(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    path: "/w/demo",
    name: "demo",
    branch: "main",
    upstream: "origin/main",
    detached: false,
    headShort: "abc1234",
    remoteName: "origin",
    remoteUrl: "https://github.com/zkoyar/demo.git",
    ahead: 0,
    behind: 0,
    staged: 1,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    changedFiles: 1,
    lastCommit: "first",
    checkedAt: Date.now(),
    ...overrides,
  } as RepositoryInfo;
}

function renderDialog(repositories: RepositoryInfo[]) {
  const onConfirm = vi.fn();
  render(
    <TranslationProvider>
      <CommitDialog
        repositories={repositories}
        busy={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    </TranslationProvider>,
  );
  return { onConfirm };
}

describe("commit dialog", () => {
  // A repository that cannot take part must say why. Listing it silently would
  // leave the user waiting for a commit that never happens.
  it("explains why a repository is excluded", () => {
    renderDialog([
      repository(),
      repository({ path: "/w/conflict", name: "conflict", conflicted: 2 }),
      repository({ path: "/w/clean", name: "clean", staged: 0, changedFiles: 0 }),
    ]);

    expect(screen.getByText("2 repositories excluded")).toBeTruthy();
    expect(screen.getByText("Resolve the conflicts first")).toBeTruthy();
    expect(screen.getByText("Nothing to record")).toBeTruthy();
  });

  // The message is what makes a commit reviewable later: an empty one must not
  // reach the backend.
  it("refuses to commit without a message", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog([repository()]);

    await user.click(screen.getByRole("button", { name: /Create commit/ }));
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Commit message/), "a real message");
    await user.click(screen.getByRole("button", { name: /Create commit/ }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual([
      { repoPath: "/w/demo", message: "a real message", stageAll: false },
    ]);
  });

  it("speaks the chosen language", () => {
    window.localStorage.setItem("rubyrepo.language", "de");
    renderDialog([repository()]);
    // Title and confirm button carry the same words: check the title.
    expect(screen.getByRole("heading", { name: "Commit erstellen" })).toBeTruthy();
    expect(screen.getByText("1 vorgemerkt · 0 geändert · 0 neu")).toBeTruthy();
    window.localStorage.clear();
  });

});
