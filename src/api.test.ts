import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const openUrl = vi.fn();
const open = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  // I test coprono il ramo desktop: il ramo browser è già verificato dal fatto
  // che le funzioni guardate ritornano senza chiamare nulla.
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrl(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => open(...args),
}));

const api = await import("./api");

beforeEach(() => {
  invoke.mockReset();
  openUrl.mockReset();
  open.mockReset();
});

describe("apertura di indirizzi esterni", () => {
  // È l'unico punto in cui l'app chiede al sistema di aprire qualcosa nel
  // browser. Senza il controllo, un URL costruito da dati remoti potrebbe
  // portare l'utente ovunque, incluso uno schema non http.
  it("apre soltanto indirizzi HTTPS su github.com", async () => {
    await api.openExternalUrl("https://github.com/zkoyar/demo");
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it("rifiuta host diversi, sottodomini travestiti e schemi non HTTPS", async () => {
    for (const url of [
      "http://github.com/zkoyar/demo",
      "https://github.com.evil.com/zkoyar/demo",
      "https://evil.com/github.com",
      "file:///C:/Windows/System32",
      "javascript:alert(1)",
    ]) {
      await expect(api.openExternalUrl(url)).rejects.toThrow();
    }
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("contratto dei comandi", () => {
  // I nomi dei comandi e delle chiavi degli argomenti sono un contratto con
  // Rust: sbagliarne uno non rompe la compilazione, fallisce a runtime.
  it("invia i nomi dei comandi e degli argomenti attesi dal backend", async () => {
    invoke.mockResolvedValue(undefined);

    await api.scanRepositories("/workspace", 4);
    expect(invoke).toHaveBeenCalledWith("scan_repositories", {
      rootPath: "/workspace",
      maxDepth: 4,
    });

    await api.refreshRepositories(["/a", "/b"]);
    expect(invoke).toHaveBeenCalledWith("refresh_repositories", { repoPaths: ["/a", "/b"] });

    await api.stageFiles("/a", ["uno.txt"]);
    expect(invoke).toHaveBeenCalledWith("stage_files", { repoPath: "/a", paths: ["uno.txt"] });

    await api.revealRepository("/a");
    expect(invoke).toHaveBeenCalledWith("reveal_repository", { repoPath: "/a" });

    await api.cancelOperations();
    expect(invoke).toHaveBeenCalledWith("cancel_operations");

    await api.applyStash(
      "/a",
      3,
      "0123456789abcdef0123456789abcdef01234567",
      "drop",
    );
    expect(invoke).toHaveBeenCalledWith("apply_stash", {
      request: {
        repoPath: "/a",
        index: 3,
        objectId: "0123456789abcdef0123456789abcdef01234567",
        action: "drop",
      },
    });
  });

  it("incapsula le richieste GitHub nella chiave `request`", async () => {
    invoke.mockResolvedValue(undefined);

    const request = {
      repositoryId: 1,
      repositoryFullName: "zkoyar/demo",
      confirmation: "zkoyar/demo",
    };
    await api.githubDeleteRepository(request);
    expect(invoke).toHaveBeenCalledWith("github_delete_repository", { request });
  });
});
