import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GitHubDeleteRepositoryDialog } from "./GitHubDeleteRepositoryDialog";
import { TranslationProvider } from "../i18n/TranslationProvider";
import type { GitHubRepository } from "../types";

function repository(overrides: Partial<GitHubRepository> = {}): GitHubRepository {
  return {
    id: 42,
    name: "demo",
    fullName: "zkoyar/demo",
    owner: "zkoyar",
    private: false,
    htmlUrl: "https://github.com/zkoyar/demo",
    cloneUrl: "https://github.com/zkoyar/demo.git",
    sshUrl: "git@github.com:zkoyar/demo.git",
    defaultBranch: "main",
    canPush: true,
    canAdmin: true,
    installationId: 1,
    ...overrides,
  };
}

function renderDialog(onDelete = vi.fn()) {
  const onClose = vi.fn();
  render(
    <TranslationProvider>
      <GitHubDeleteRepositoryDialog
        repository={repository()}
        localPaths={[]}
        fallbackFocusRef={createRef<HTMLButtonElement>()}
        onClose={onClose}
        onDelete={onDelete}
      />
    </TranslationProvider>,
  );
  return { onDelete, onClose };
}

describe("conferma dell'eliminazione", () => {
  // È l'unica barriera fra un click e la distruzione di una repository remota
  // senza possibilità di annullamento. Se cedesse, cederebbe in silenzio.
  it("tiene disabilitata l'eliminazione finché il nome non è esatto", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderDialog();

    const submit = screen.getByRole("button", { name: /delete permanently/i });
    expect(submit).toBeDisabled();

    const input = screen.getByRole("textbox");
    await user.type(input, "zkoyar/dem");
    expect(submit).toBeDisabled();

    await user.type(input, "o");
    expect(submit).toBeEnabled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("rifiuta un nome che differisce solo per maiuscole o spazi", async () => {
    const user = userEvent.setup();
    renderDialog();

    const submit = screen.getByRole("button", { name: /delete permanently/i });
    const input = screen.getByRole("textbox");

    await user.type(input, "ZKOYAR/DEMO");
    expect(submit).toBeDisabled();

    await user.clear(input);
    await user.type(input, " zkoyar/demo ");
    expect(submit).toBeDisabled();
  });

  it("invia id e nome completo esattamente come li ha ricevuti", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue({
      repositoryId: 42,
      repositoryFullName: "zkoyar/demo",
      deleted: true,
    });
    renderDialog(onDelete);

    await user.type(screen.getByRole("textbox"), "zkoyar/demo");
    await user.click(screen.getByRole("button", { name: /delete permanently/i }));

    expect(onDelete).toHaveBeenCalledWith({
      repositoryId: 42,
      repositoryFullName: "zkoyar/demo",
      confirmation: "zkoyar/demo",
    });
  });

  it("mostra l'errore del backend senza chiudere il dialog", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue({
      code: "forbidden",
      message: "La policy dell'organizzazione vieta l'eliminazione.",
    });
    const { onClose } = renderDialog(onDelete);

    await user.type(screen.getByRole("textbox"), "zkoyar/demo");
    await user.click(screen.getByRole("button", { name: /delete permanently/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /policy dell'organizzazione/i,
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("passa alla schermata di esito e dichiara intatta la copia locale", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue({
      repositoryId: 42,
      repositoryFullName: "zkoyar/demo",
      deleted: true,
    });
    renderDialog(onDelete);

    await user.type(screen.getByRole("textbox"), "zkoyar/demo");
    await user.click(screen.getByRole("button", { name: /delete permanently/i }));

    // Dopo l'esito il dialog non deve piu' offrire il campo di conferma, ed e'
    // tenuto a dire che in locale non e' stato toccato niente: e' l'unica
    // rassicurazione che l'utente riceve dopo un'operazione irreversibile.
    expect(await screen.findByText(/deleted from github/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/no local file was changed/i)).toBeInTheDocument();
  });

  // Nota: la verifica che l'esito si riferisca davvero alla repository richiesta
  // non sta qui ma in GitHubAccountDialog, che possiede l'elenco e lo aggiorna.
  // Testarla richiede di montare quel dialog con una sessione completa.
});
