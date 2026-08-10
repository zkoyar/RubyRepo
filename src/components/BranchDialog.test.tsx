import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BranchDialog } from "./BranchDialog";
import { TranslationProvider } from "../i18n/TranslationProvider";
import type { BranchInfo, BranchList, RepositoryInfo } from "../types";

const listBranches = vi.fn<(repoPath: string) => Promise<BranchList>>();
const switchBranch = vi.fn<(repoPath: string, branch: string) => Promise<RepositoryInfo>>();
const createBranch =
  vi.fn<(repoPath: string, name: string, checkout: boolean) => Promise<RepositoryInfo>>();

vi.mock("../api", () => ({
  listBranches: (repoPath: string) => listBranches(repoPath),
  switchBranch: (repoPath: string, branch: string) => switchBranch(repoPath, branch),
  createBranch: (repoPath: string, name: string, checkout: boolean) =>
    createBranch(repoPath, name, checkout),
}));

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
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    changedFiles: 0,
    lastCommit: "iniziale",
    checkedAt: Date.now(),
    ...overrides,
  } as RepositoryInfo;
}

function branch(overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: "main",
    current: false,
    upstream: null,
    track: null,
    subject: "commit iniziale",
    remoteOnly: false,
    ...overrides,
  };
}

function renderDialog(list: BranchList) {
  listBranches.mockResolvedValue(list);
  const onBranchChanged = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <TranslationProvider>
      <BranchDialog
        repository={repository()}
        nativeEnabled
        onClose={onClose}
        onBranchChanged={onBranchChanged}
      />
    </TranslationProvider>,
  );
  return { ...view, onBranchChanged, onClose };
}

beforeEach(() => {
  window.localStorage.clear();
  listBranches.mockReset();
  switchBranch.mockReset();
  createBranch.mockReset();
});

describe("accessibilita del dialog", () => {
  it("porta il focus dentro, lo intrappola e lo restituisce all'elemento di partenza", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderDialog({
      current: "main",
      detached: false,
      branches: [branch({ name: "main", current: true })],
    });
    await screen.findByRole("button", { name: /main/ });
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    const lastClose = closeButtons[closeButtons.length - 1];
    lastClose.focus();
    await user.tab();
    expect(closeButtons[0]).toHaveFocus();

    closeButtons[0].focus();
    await user.tab({ shift: true });
    expect(lastClose).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("traduce gli errori strutturati restituiti dal backend", async () => {
    window.localStorage.setItem("rubyrepo.language", "it");
    switchBranch.mockRejectedValue({
      code: "invalidRequest",
      message: "The folder was not picked in the dialog: choose it again.",
      messageId: "error.folderNotChosen",
      retryable: false,
    });
    const user = userEvent.setup();
    renderDialog({
      current: "main",
      detached: false,
      branches: [branch({ name: "main", current: true }), branch({ name: "lavoro" })],
    });

    await user.click(await screen.findByRole("button", { name: /lavoro/ }));
    expect(await screen.findByText(/La cartella non/)).toBeInTheDocument();
    expect(screen.queryByText(/The folder was not/)).not.toBeInTheDocument();
  });
});

describe("scelta del branch", () => {
  // È la schermata su cui si decide dove spostare la copia di lavoro: un branch
  // corrente non riconosciuto renderebbe cliccabile un cambio verso se stessi,
  // e un branch mancante lo renderebbe irraggiungibile.
  it("mostra i branch e non permette di passare a quello dove si è già", async () => {
    const user = userEvent.setup();
    const { onBranchChanged } = renderDialog({
      current: "main",
      detached: false,
      branches: [
        branch({ name: "main", current: true, upstream: "origin/main", track: "same" }),
        branch({ name: "lavoro", subject: "in corso" }),
      ],
    });

    const corrente = await screen.findByRole("button", { name: /main/ });
    expect(corrente).toBeDisabled();
    expect(screen.getByRole("button", { name: /lavoro/ })).toBeEnabled();

    // Un click sul branch dove si è già non deve produrre alcun comando.
    await user.click(corrente);
    expect(switchBranch).not.toHaveBeenCalled();
    expect(onBranchChanged).not.toHaveBeenCalled();
  });

  it("passa al branch scelto e riferisce l'esito", async () => {
    const user = userEvent.setup();
    switchBranch.mockResolvedValue(repository({ branch: "lavoro" }));
    const { onBranchChanged } = renderDialog({
      current: "main",
      detached: false,
      branches: [
        branch({ name: "main", current: true }),
        branch({ name: "lavoro", subject: "in corso" }),
      ],
    });

    await user.click(await screen.findByRole("button", { name: /lavoro/ }));

    await waitFor(() => expect(switchBranch).toHaveBeenCalledWith("/w/demo", "lavoro"));
    expect(onBranchChanged).toHaveBeenCalledTimes(1);
    expect(onBranchChanged.mock.calls[0][1]).toContain("lavoro");
  });

  // Un branch che esiste solo sul remote è il motivo principale per cui si apre
  // questo elenco: prendere ciò che un altro ha pubblicato.
  it("segnala quando il branch scelto esisteva solo sul remote", async () => {
    const user = userEvent.setup();
    switchBranch.mockResolvedValue(repository({ branch: "di-altri" }));
    const { onBranchChanged } = renderDialog({
      current: "main",
      detached: false,
      branches: [
        branch({ name: "main", current: true }),
        branch({ name: "di-altri", remoteOnly: true, upstream: "origin/di-altri" }),
      ],
    });

    await user.click(await screen.findByRole("button", { name: /di-altri/ }));

    await waitFor(() => expect(onBranchChanged).toHaveBeenCalledTimes(1));
    expect(onBranchChanged.mock.calls[0][1]).toContain("origin/di-altri");
  });

  // Git rifiuta il cambio quando ci sono modifiche che andrebbero perse: quel
  // rifiuto deve arrivare all'utente, non sparire in un catch muto.
  it("mostra il motivo per cui Git ha rifiutato il cambio", async () => {
    const user = userEvent.setup();
    switchBranch.mockRejectedValue({
      code: "internal",
      message: "modifiche locali verrebbero sovrascritte",
      retryable: false,
    });
    const { onBranchChanged } = renderDialog({
      current: "main",
      detached: false,
      branches: [branch({ name: "main", current: true }), branch({ name: "lavoro" })],
    });

    await user.click(await screen.findByRole("button", { name: /lavoro/ }));

    expect(await screen.findByText(/verrebbero sovrascritte/)).toBeTruthy();
    expect(onBranchChanged).not.toHaveBeenCalled();
  });
});

describe("creazione di un branch", () => {
  // Creare e spostarsi sono due gesti diversi: chi voleva solo preparare un
  // branch non deve ritrovarsi la copia di lavoro altrove.
  it("distingue creare e restare da creare e andare", async () => {
    const user = userEvent.setup();
    createBranch.mockResolvedValue(repository());
    renderDialog({
      current: "main",
      detached: false,
      branches: [branch({ name: "main", current: true })],
    });

    // I pulsanti restano spenti finché l'elenco non è caricato: interagire prima
    // vorrebbe dire misurare una corsa invece del comportamento.
    await screen.findByRole("button", { name: /main/ });
    await user.type(screen.getByLabelText("Name of the new branch"), "nuovo");

    await user.click(screen.getByRole("button", { name: "Create and stay" }));
    await waitFor(() => expect(createBranch).toHaveBeenCalledWith("/w/demo", "nuovo", false));

    await user.type(screen.getByLabelText("Name of the new branch"), "altro");
    await user.click(screen.getByRole("button", { name: /Create and switch/ }));
    await waitFor(() => expect(createBranch).toHaveBeenCalledWith("/w/demo", "altro", true));
  });

  it("tiene spenti i pulsanti finché non c'è un nome", async () => {
    renderDialog({ current: "main", detached: false, branches: [] });

    await screen.findByText("No branches.");
    expect(screen.getByRole("button", { name: "Create and stay" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Create and switch/ })).toBeDisabled();
    expect(createBranch).not.toHaveBeenCalled();
  });
});
