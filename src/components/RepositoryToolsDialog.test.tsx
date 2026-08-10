import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryToolsDialog } from "./RepositoryToolsDialog";
import { TranslationProvider } from "../i18n/TranslationProvider";
import type {
  ConflictState,
  HistoryResult,
  RemoteInfo,
  RepositoryInfo,
  StashEntry,
} from "../types";

const repositoryHistory = vi.fn<() => Promise<HistoryResult>>();
const listRemotes = vi.fn<() => Promise<RemoteInfo[]>>();
const listStashes = vi.fn<() => Promise<StashEntry[]>>();
const conflictState = vi.fn<() => Promise<ConflictState>>();
const applyStash = vi.fn();
const createStash = vi.fn();
const removeRemote = vi.fn();
const setRemote = vi.fn();
const resolveConflict = vi.fn();

vi.mock("../api", () => ({
  repositoryHistory: () => repositoryHistory(),
  listRemotes: () => listRemotes(),
  listStashes: () => listStashes(),
  conflictState: () => conflictState(),
  applyStash: (...args: unknown[]) => applyStash(...args),
  createStash: (...args: unknown[]) => createStash(...args),
  removeRemote: (...args: unknown[]) => removeRemote(...args),
  setRemote: (...args: unknown[]) => setRemote(...args),
  resolveConflict: (...args: unknown[]) => resolveConflict(...args),
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

function renderDialog(initialTab: "history" | "remotes" | "stashes" | "conflicts") {
  const onRepositoryChanged = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <TranslationProvider>
      <RepositoryToolsDialog
        repository={repository()}
        initialTab={initialTab}
        nativeEnabled
        onClose={onClose}
        onRepositoryChanged={onRepositoryChanged}
      />
    </TranslationProvider>,
  );
  return { ...view, onClose, onRepositoryChanged };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  repositoryHistory.mockResolvedValue({ commits: [], upstream: "origin/main", truncated: false });
  listRemotes.mockResolvedValue([]);
  listStashes.mockResolvedValue([]);
  conflictState.mockResolvedValue({ pending: "none", conflicted: [] });
  applyStash.mockResolvedValue(repository());
  createStash.mockResolvedValue(repository());
  removeRemote.mockResolvedValue(repository());
  setRemote.mockResolvedValue(repository());
  resolveConflict.mockResolvedValue(repository());
});

describe("accessibilita del dialog", () => {
  it("mette a fuoco la scheda attiva, intrappola Tab e ripristina il focus", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderDialog("history");
    const activeTab = screen.getByRole("tab", { name: "History" });
    await waitFor(() => expect(activeTab).toHaveFocus());

    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    const firstClose = closeButtons[0];
    const lastClose = closeButtons[closeButtons.length - 1];
    lastClose.focus();
    await user.tab();
    expect(firstClose).toHaveFocus();

    firstClose.focus();
    await user.tab({ shift: true });
    expect(lastClose).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("traduce gli errori strutturati del caricamento", async () => {
    window.localStorage.setItem("rubyrepo.language", "it");
    repositoryHistory.mockRejectedValue({
      code: "invalidRequest",
      message: "The folder was not picked in the dialog: choose it again.",
      messageId: "error.folderNotChosen",
      retryable: false,
    });

    renderDialog("history");
    expect(await screen.findByText(/La cartella non/)).toBeInTheDocument();
    expect(screen.queryByText(/The folder was not/)).not.toBeInTheDocument();
  });
});

describe("storia", () => {
  // Un elenco vuoto perché manca l'upstream e un elenco vuoto perché non c'è
  // niente da inviare significano cose opposte. Mostrarli uguali direbbe
  // "sei a posto" a chi invece non ha un remote che lo segua.
  it("distingue l'assenza di upstream dall'assenza di commit da inviare", async () => {
    const user = userEvent.setup();
    repositoryHistory.mockResolvedValue({ commits: [], upstream: null, truncated: false });
    renderDialog("history");

    await user.click(await screen.findByRole("button", { name: "To send" }));
    expect(await screen.findByText(/no upstream/)).toBeTruthy();

    repositoryHistory.mockResolvedValue({ commits: [], upstream: "origin/main", truncated: false });
    await user.click(screen.getByRole("button", { name: "Latest commits" }));
    await user.click(screen.getByRole("button", { name: "To send" }));
    expect(await screen.findByText("Nothing to send.")).toBeTruthy();
  });

  it("mostra i commit con hash breve e autore", async () => {
    repositoryHistory.mockResolvedValue({
      commits: [
        {
          hash: "1111111111",
          shortHash: "1111111",
          subject: "prima modifica",
          author: "Salvatore",
          date: new Date().toISOString(),
        },
      ],
      upstream: "origin/main",
      truncated: false,
    });
    renderDialog("history");

    expect(await screen.findByText("prima modifica")).toBeTruthy();
    expect(screen.getByText("1111111")).toBeTruthy();
  });
});

describe("conflitti", () => {
  // Continuare con file ancora in conflitto produrrebbe un commit a metà: il
  // pulsante deve restare spento finché non sono risolti.
  it("non lascia continuare finché restano file in conflitto", async () => {
    conflictState.mockResolvedValue({ pending: "merge", conflicted: ["src/app.ts"] });
    renderDialog("conflicts");

    const continua = await screen.findByRole("button", { name: /Continue/ });
    expect(continua).toBeDisabled();
    expect(screen.getByText("src/app.ts")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Abort everything/ })).toBeEnabled();
  });

  it("permette di continuare quando non ne restano", async () => {
    const user = userEvent.setup();
    conflictState.mockResolvedValue({ pending: "rebase", conflicted: [] });
    const { onRepositoryChanged } = renderDialog("conflicts");

    const continua = await screen.findByRole("button", { name: /Continue/ });
    expect(continua).toBeEnabled();
    await user.click(continua);

    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith("/w/demo", "continue"));
    expect(onRepositoryChanged).toHaveBeenCalledTimes(1);
  });

  it("annulla riportando la repository com'era", async () => {
    const user = userEvent.setup();
    conflictState.mockResolvedValue({ pending: "merge", conflicted: ["a.txt"] });
    renderDialog("conflicts");

    await user.click(await screen.findByRole("button", { name: /Abort everything/ }));
    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith("/w/demo", "abort"));
  });
});

describe("stash", () => {
  // Applica, riprendi ed elimina fanno cose diverse sulla stessa voce: se
  // l'indice o l'azione scivolassero, si perderebbe lavoro messo da parte.
  it("passa al backend la posizione e l'azione scelte", async () => {
    const user = userEvent.setup();
    listStashes.mockResolvedValue([
      {
        index: 0,
        objectId: "1111111111111111111111111111111111111111",
        message: "in cima",
        branch: "main",
        date: new Date().toISOString(),
      },
      {
        index: 1,
        objectId: "2222222222222222222222222222222222222222",
        message: "sotto",
        branch: "main",
        date: new Date().toISOString(),
      },
    ]);
    renderDialog("stashes");

    await screen.findByText("in cima");
    const riprendi = screen.getAllByRole("button", { name: "Restore" });
    await user.click(riprendi[1]);

    await waitFor(() =>
      expect(applyStash).toHaveBeenCalledWith(
        "/w/demo",
        1,
        "2222222222222222222222222222222222222222",
        "pop",
      ),
    );
  });
});

describe("remote", () => {
  it("tiene spento il salvataggio finché nome e URL non ci sono entrambi", async () => {
    const user = userEvent.setup();
    renderDialog("remotes");

    const salva = await screen.findByRole("button", { name: /Save remote/ });
    expect(salva).toBeDisabled();

    await user.type(screen.getByLabelText("Remote URL"), "https://example.invalid/a.git");
    expect(screen.getByRole("button", { name: /Save remote/ })).toBeEnabled();
  });

  it("salva il remote con nome e URL ripuliti", async () => {
    const user = userEvent.setup();
    renderDialog("remotes");

    await user.type(await screen.findByLabelText("Remote URL"), "  https://a.invalid/b.git  ");
    await user.click(screen.getByRole("button", { name: /Save remote/ }));

    await waitFor(() =>
      expect(setRemote).toHaveBeenCalledWith("/w/demo", "origin", "https://a.invalid/b.git"),
    );
    expect(screen.getByLabelText("Remote URL")).toHaveValue("");
  });

  it("non riutilizza l'URL mostrato quando modifica un remote esistente", async () => {
    const user = userEvent.setup();
    listRemotes.mockResolvedValue([
      {
        name: "origin",
        fetchUrl: "https://example.invalid/a/b.git",
        pushUrl: "https://example.invalid/a/b.git",
      },
    ]);
    renderDialog("remotes");

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const name = screen.getByLabelText("Remote name");
    const url = screen.getByLabelText("Remote URL");
    const save = screen.getByRole("button", { name: /Save remote/ });

    expect(name).toBeDisabled();
    expect(name).toHaveValue("origin");
    expect(url).toHaveValue("");
    expect(save).toBeDisabled();
    expect(screen.getByText(/complete replacement URL/)).toBeInTheDocument();

    await user.type(url, "https://new.invalid/a/b.git");
    expect(save).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(name).toBeEnabled();
    expect(name).toHaveValue("origin");
    expect(url).toHaveValue("");
    expect(screen.queryByText(/complete replacement URL/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(url, "https://new.invalid/a/b.git");
    await user.click(screen.getByRole("button", { name: /Save remote/ }));

    await waitFor(() =>
      expect(setRemote).toHaveBeenCalledWith(
        "/w/demo",
        "origin",
        "https://new.invalid/a/b.git",
      ),
    );
    await waitFor(() => expect(name).toBeEnabled());
    expect(url).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Cancel edit" })).not.toBeInTheDocument();
  });
});
