import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubAccountDialog } from "./GitHubAccountDialog";
import { TranslationProvider } from "../i18n/TranslationProvider";
import type { GitHubRepository, GitHubSession } from "../types";

const listRepositories = vi.fn();
const logout = vi.fn();

vi.mock("../api", () => ({
  githubBeginLogin: vi.fn(),
  githubCreateRepository: vi.fn(),
  githubDeleteRepository: vi.fn(),
  githubGetSession: vi.fn(),
  githubListRepositories: () => listRepositories(),
  githubLogout: () => logout(),
  githubPollLogin: vi.fn(),
  openExternalUrl: vi.fn(),
}));

function session(overrides: Partial<GitHubSession> = {}): GitHubSession {
  return {
    user: {
      login: "zkoyar",
      name: "Zkoyar",
      avatarUrl: "https://example.invalid/avatar.png",
      htmlUrl: "https://github.com/zkoyar",
      followers: 3,
      following: 4,
      publicRepos: 5,
      totalPrivateRepos: 6,
    },
    repositoryCount: 2,
    installationCount: 1,
    persisted: true,
    ...overrides,
  };
}

function repository(overrides: Partial<GitHubRepository> = {}): GitHubRepository {
  return {
    id: 1,
    name: "alpha",
    fullName: "zkoyar/alpha",
    owner: "zkoyar",
    private: false,
    htmlUrl: "https://github.com/zkoyar/alpha",
    cloneUrl: "https://github.com/zkoyar/alpha.git",
    sshUrl: "git@github.com:zkoyar/alpha.git",
    defaultBranch: "main",
    canPush: true,
    canAdmin: true,
    installationId: 1,
    ...overrides,
  };
}

function renderDialog(current: GitHubSession | null, nativeEnabled = true) {
  const onSessionChange = vi.fn();
  render(
    <TranslationProvider>
      <GitHubAccountDialog
        session={current}
        localRepositories={[]}
        nativeEnabled={nativeEnabled}
        onSessionChange={onSessionChange}
        onRepositoryLinked={vi.fn()}
        onClose={vi.fn()}
      />
    </TranslationProvider>,
  );
  return { onSessionChange };
}

beforeEach(() => {
  listRepositories.mockReset();
  logout.mockReset();
  window.localStorage.clear();
});

describe("account GitHub", () => {
  // Fuori da Tauri il Device Flow non ha un backend a cui parlare. Il pulsante
  // deve dirlo invece di fallire dopo il click, e la spiegazione deve arrivare
  // nella lingua attiva come tutto il resto.
  it("nell'anteprima browser spiega perche' l'accesso e' disattivato", () => {
    renderDialog(null, false);

    expect(screen.getByRole("button", { name: /sign in with github/i })).toBeDisabled();
    expect(screen.getByText(/sign-in disabled in the browser preview/i)).toBeInTheDocument();
  });

  // La disconnessione butta via il token: un click solo non deve bastare.
  it("chiede conferma prima di disconnettere l'account", async () => {
    const user = userEvent.setup();
    renderDialog(session());

    await user.click(screen.getByRole("button", { name: /sign out of the account/i }));
    expect(logout).not.toHaveBeenCalled();

    // Il nome dell'account compare nella domanda: e' l'unico modo per accorgersi
    // di stare disconnettendo quello sbagliato.
    expect(screen.getByText(/sign out @zkoyar\?/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^sign out$/i }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  // Il filtro per accesso e' quello che distingue le repository su cui si puo'
  // davvero lavorare da quelle in sola lettura.
  it("filtra le repository per accesso in scrittura", async () => {
    const user = userEvent.setup();
    listRepositories.mockResolvedValue([
      repository(),
      repository({ id: 2, name: "beta", fullName: "zkoyar/beta", canPush: false }),
    ]);
    renderDialog(session());

    await user.click(screen.getByRole("tab", { name: /repositories/i }));
    await screen.findByText("zkoyar/alpha");
    expect(screen.getByText("zkoyar/beta")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 repositories")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^write$/i }));
    expect(screen.queryByText("zkoyar/beta")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 repositories")).toBeInTheDocument();
  });

  // Senza installazioni non c'e' nulla da chiedere al backend: la lista vuota e'
  // un esito, non un caricamento fallito, e non deve generare una richiesta.
  it("non interroga GitHub quando non ci sono installazioni", async () => {
    const user = userEvent.setup();
    renderDialog(session({ installationCount: 0 }));

    await user.click(screen.getByRole("tab", { name: /repositories/i }));
    expect(await screen.findByText(/no installation available/i)).toBeInTheDocument();
    expect(listRepositories).not.toHaveBeenCalled();
  });
});
