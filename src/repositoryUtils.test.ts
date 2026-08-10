import { describe, expect, it } from "vitest";
import {
  cloneFolderNameProblem,
  compactPath,
  defaultCloneFolderName,
  errorCode,
  errorMessage,
  hasRemote,
  isDirty,
  isGitHubRemote,
  matchesFilter,
  mergeProgress,
  ORIGIN_CONFLICT_CODE,
  outcomeMessage,
  repositoryGroup,
  shouldRescanForDepth,
  summariseResults,
  syncBlockedReason,
  summaryMessage,
  summaryTone,
} from "./repositoryUtils";
import { MESSAGES, type MessageId } from "./i18n/dictionary";
import type { BatchProgress, OperationCode, OperationResult, RepositoryInfo } from "./types";

function repository(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    path: "/workspace/demo",
    name: "demo",
    branch: "main",
    upstream: "origin/main",
    detached: false,
    headShort: "abc1234",
    remoteName: "origin",
    remoteUrl: "https://github.com/demo/demo.git",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    changedFiles: 0,
    lastCommit: "commit iniziale",
    checkedAt: Date.now(),
    ...overrides,
  } as RepositoryInfo;
}

describe("classificazione dei remote", () => {
  // La classificazione decide sia il raggruppamento della tabella sia i filtri
  // della sidebar: un falso positivo mostrerebbe come GitHub una repository che
  // non lo è.
  it("riconosce github.com in HTTPS e in SSH", () => {
    expect(isGitHubRemote(repository({ remoteUrl: "https://github.com/a/b.git" }))).toBe(true);
    expect(isGitHubRemote(repository({ remoteUrl: "git@github.com:a/b.git" }))).toBe(true);
    expect(isGitHubRemote(repository({ remoteUrl: "ssh://git@github.com/a/b.git" }))).toBe(true);
  });

  it("rifiuta gli host che imitano github.com", () => {
    expect(isGitHubRemote(repository({ remoteUrl: "https://github.com.evil.com/a/b" }))).toBe(false);
    expect(isGitHubRemote(repository({ remoteUrl: "https://evil.com/github.com/a/b" }))).toBe(false);
    expect(isGitHubRemote(repository({ remoteUrl: "git@github.com.evil.com:a/b.git" }))).toBe(false);
  });

  it("assegna ogni repository a un solo gruppo", () => {
    expect(repositoryGroup(repository())).toBe("github");
    expect(repositoryGroup(repository({ remoteUrl: "https://gitlab.com/a/b.git" }))).toBe(
      "otherRemote",
    );
    expect(repositoryGroup(repository({ remoteName: null, remoteUrl: null }))).toBe("local");
  });

  it("considera senza remote solo ciò che non ha né nome né URL", () => {
    expect(hasRemote(repository({ remoteName: null, remoteUrl: null }))).toBe(false);
    expect(hasRemote(repository({ remoteName: "origin", remoteUrl: null }))).toBe(true);
  });
});

describe("filtri", () => {
  it("fa combaciare i filtri con i gruppi corrispondenti", () => {
    const local = repository({ remoteName: null, remoteUrl: null });
    expect(matchesFilter(local, "noRemote")).toBe(true);
    expect(matchesFilter(local, "github")).toBe(false);
    expect(matchesFilter(repository(), "github")).toBe(true);
    expect(matchesFilter(repository({ remoteUrl: "https://gitlab.com/a/b" }), "otherRemote")).toBe(
      true,
    );
  });

  it("considera sporca una repository con qualunque tipo di modifica", () => {
    expect(isDirty(repository())).toBe(false);
    expect(isDirty(repository({ untracked: 1 }))).toBe(true);
    expect(isDirty(repository({ conflicted: 1 }))).toBe(true);
  });

  it("accetta tutto con il filtro 'all'", () => {
    expect(matchesFilter(repository(), "all")).toBe(true);
  });
});

describe("errori", () => {
  // Il payload strutturato del backend ha sostituito le stringhe: `errorMessage`
  // deve reggere entrambe le forme, altrimenti ogni schermata mostrerebbe JSON.
  it("estrae il messaggio dal payload strutturato", () => {
    const error = { code: ORIGIN_CONFLICT_CODE, message: "conflitto", retryable: false };
    expect(errorMessage(error)).toBe("conflitto");
    expect(errorCode(error)).toBe(ORIGIN_CONFLICT_CODE);
  });

  it("continua a funzionare su stringhe ed Error", () => {
    expect(errorMessage("guasto")).toBe("guasto");
    expect(errorMessage(new Error("guasto"))).toBe("guasto");
    expect(errorCode("guasto")).toBeNull();
    expect(errorCode(new Error("guasto"))).toBeNull();
  });

  it("traduce il fallback per valori non serializzabili o undefined", () => {
    const translate = (id: MessageId) => (id === "error.unknown" ? "Errore sconosciuto" : id);
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(errorMessage(undefined, translate)).toBe("Errore sconosciuto");
    expect(errorMessage(circular, translate)).toBe("Errore sconosciuto");
    expect(errorMessage(undefined)).toBe("Unknown error");
  });

  it("traduce un errore GitHub classificato dal suo messageId generico", () => {
    const error = {
      code: "authenticationRequired",
      message: "GitHub authentication is required.",
      messageId: "github.error.authenticationRequired",
      retryable: false,
      retryAfterSeconds: null,
    };

    expect(errorMessage(error, (id) => MESSAGES[id].it)).toBe(
      "Accedi a GitHub per continuare.",
    );
  });

  // La conversione dei messaggi del backend procede un punto alla volta: nel
  // frattempo convivono esiti con identificatore ed esiti senza. Il ripiego
  // sulla frase inglese e' cio' che rende possibile quella gradualita', quindi
  // vale la pena fissarlo invece di fidarsi.
  it("traduce un esito quando lo riconosce e ripiega sulla frase quando no", () => {
    const translate = (id: MessageId, params?: Record<string, string>) =>
      `${id}:${JSON.stringify(params ?? {})}`;

    expect(
      outcomeMessage(
        {
          message: "The repository is already up to date.",
          messageId: "outcome.alreadyUpToDate",
          params: null,
        },
        translate,
      ),
    ).toBe("outcome.alreadyUpToDate:{}");

    expect(
      outcomeMessage(
        { message: "The repository is no longer reachable: gone", messageId: "outcome.unavailable", params: { reason: "gone" } },
        translate,
      ),
    ).toBe('outcome.unavailable:{"reason":"gone"}');

    // Senza identificatore, e con un identificatore che il dizionario non
    // conosce, resta la frase inglese: l'esito degrada, non sparisce.
    expect(outcomeMessage({ message: "Done.", messageId: null, params: null }, translate)).toBe("Done.");
    expect(
      outcomeMessage({ message: "Done.", messageId: "outcome.notInTheDictionary", params: null }, translate),
    ).toBe("Done.");
  });

  it("non scambia per errore strutturato un oggetto qualsiasi", () => {
    expect(errorCode({ codice: "x" })).toBeNull();
    expect(errorCode(null)).toBeNull();
  });
});

describe("percorsi", () => {
  it("accorcia il percorso rispetto alla radice del workspace", () => {
    expect(compactPath("/workspace/demo/app", "/workspace")).toBe("demo/app");
  });

  it("ripiega sulle ultime due parti quando la radice non combacia", () => {
    expect(compactPath("/altrove/demo/app", "/workspace")).toBe("…/demo/app");
  });
});

function result(code: OperationCode, overrides: Partial<OperationResult> = {}): OperationResult {
  return {
    repoPath: "/w/demo",
    repoName: "demo",
    operation: "fetch",
    success: code === "ok",
    code,
    message: "",
    output: "",
    ...overrides,
  };
}

describe("riepilogo di un batch", () => {
  // Prima di questa distinzione, chi interrompeva un push su quaranta
  // repository vedeva trenta righe "non riuscite" senza sapere quali fossero
  // solo saltate.
  it("non conta come fallite le repository mai elaborate", () => {
    const summary = summariseResults([
      result("ok"),
      result("ok"),
      result("failed"),
      result("cancelled"),
      result("unavailable"),
    ]);

    expect(summary).toEqual({ done: 2, failed: 1, skipped: 2 });
  });

  // L'asserzione e' sull'identificatore, non sulla frase: cosi' riformulare una
  // traduzione non rompe il test, mentre scegliere la frase sbagliata si'.
  it("riepiloga senza menzionare categorie vuote", () => {
    expect(summaryMessage({ done: 3, failed: 0, skipped: 0 })).toEqual({
      id: "batch.allDone",
      params: { done: 3 },
    });
    expect(summaryMessage({ done: 3, failed: 1, skipped: 0 })).toEqual({
      id: "batch.doneAndFailed",
      params: { done: 3, failed: 1 },
    });
    expect(summaryMessage({ done: 3, failed: 0, skipped: 2 })).toEqual({
      id: "batch.doneAndSkipped",
      params: { done: 3, skipped: 2 },
    });
    expect(summaryMessage({ done: 3, failed: 1, skipped: 2 })).toEqual({
      id: "batch.doneFailedSkipped",
      params: { done: 3, failed: 1, skipped: 2 },
    });
  });

  // Un'operazione interrotta dall'utente non è un errore: segnalarla in rosso
  // farebbe credere a un guasto.
  it("usa il tono d'errore solo quando qualcosa è davvero fallito", () => {
    expect(summaryTone({ done: 3, failed: 0, skipped: 0 })).toBe("success");
    expect(summaryTone({ done: 1, failed: 0, skipped: 2 })).toBe("info");
    expect(summaryTone({ done: 1, failed: 1, skipped: 2 })).toBe("error");
  });

  it("regge un batch vuoto", () => {
    expect(summariseResults([])).toEqual({ done: 0, failed: 0, skipped: 0 });
  });
});

describe("chi puo partecipare a pull e push", () => {
  // Questa funzione decide su quali repository si opera davvero. Una guardia
  // troppo larga tocca qualcosa che non doveva; una troppo stretta rende
  // irraggiungibile una funzione che esiste — ed e' successo: i branch
  // divergenti venivano scartati anche con merge e rebase, cioe' proprio nei
  // casi per cui quelle strategie sono state scritte.
  it("con merge e rebase ammette i branch divergenti che il fast-forward scarta", () => {
    const divergente = repository({ ahead: 2, behind: 3 });

    expect(syncBlockedReason(divergente, "pull", "fastForward")).toBe(
      "blocked.divergedChooseStrategy",
    );
    expect(syncBlockedReason(divergente, "pull", "merge")).toBeNull();
    expect(syncBlockedReason(divergente, "pull", "rebase")).toBeNull();
  });

  it("con i soli commit locali il fast-forward si ferma e le altre no", () => {
    const avanti = repository({ ahead: 2, behind: 1 });

    expect(syncBlockedReason(avanti, "pull", "fastForward")).not.toBeNull();
    expect(syncBlockedReason(avanti, "pull", "merge")).toBeNull();
  });

  // Nessuna strategia deve poter passare sopra a lavoro non salvato.
  it("le modifiche locali bloccano ogni strategia", () => {
    const sporca = repository({ behind: 1, untracked: 1 });

    for (const strategy of ["fastForward", "merge", "rebase"] as const) {
      expect(syncBlockedReason(sporca, "pull", strategy)).toBe("blocked.dirty");
    }
  });

  it("blocca sempre conflitti, HEAD scollegato e assenza di remote", () => {
    expect(syncBlockedReason(repository({ conflicted: 1 }), "pull")).toBe("blocked.conflicts");
    expect(syncBlockedReason(repository({ detached: true }), "push")).toBe("branch.detached");
    expect(syncBlockedReason(repository({ remoteName: null, remoteUrl: null }), "push")).toBe(
      "blocked.noRemote",
    );
  });

  it("non propone un pull su una repository gia allineata", () => {
    expect(syncBlockedReason(repository(), "pull", "merge")).toBe("blocked.upToDate");
  });

  it("lascia passare il primo push di un branch senza upstream", () => {
    const nuovo = repository({ upstream: null, ahead: 0, headShort: "abc1234" });
    expect(syncBlockedReason(nuovo, "push")).toBeNull();

    const vuoto = repository({ upstream: null, headShort: null });
    expect(syncBlockedReason(vuoto, "push")).toBe("blocked.noCommit");
  });
});

describe("nome della cartella per il clone", () => {
  it("suggerisce il nome della repository", () => {
    expect(defaultCloneFolderName("zkoyar/demo")).toBe("demo");
    expect(defaultCloneFolderName("zkoyar/demo.js")).toBe("demo.js");
  });

  // Vuoto significa "usa il suggerimento": chi cancella il campo non sta
  // commettendo un errore.
  it("non si lamenta di un campo vuoto", () => {
    expect(cloneFolderNameProblem("")).toBeNull();
    expect(cloneFolderNameProblem("   ")).toBeNull();
  });

  it("accetta i nomi che le repository usano davvero", () => {
    for (const name of ["demo", "demo-2", "demo_2", "demo.js", ".github", "con spazio"]) {
      expect(cloneFolderNameProblem(name)).toBeNull();
    }
  });

  // Il nome diventa un percorso sul disco: un separatore lo farebbe uscire
  // dalla cartella scelta. Il backslash e' quello che conta su Windows, ed e'
  // anche quello che una classe di caratteri scritta male perde per prima.
  it("rifiuta tutto cio che e un percorso e non un nome", () => {
    for (const name of ["sotto/dentro", "sotto\\dentro", "..", ".", "../fuori", "-opzione", "coda."]) {
      expect(cloneFolderNameProblem(name)).not.toBeNull();
    }
  });

  it("rifiuta i nomi troppo lunghi", () => {
    expect(cloneFolderNameProblem("x".repeat(129))).not.toBeNull();
    expect(cloneFolderNameProblem("x".repeat(128))).toBeNull();
  });
});

describe("cambio di profondità", () => {
  it("riscansiona quando la profondità cambia su una cartella già scelta", () => {
    expect(shouldRescanForDepth(4, 6, "D:\\lavoro", true)).toBe(true);
    expect(shouldRescanForDepth(6, 4, "D:\\lavoro", true)).toBe(true);
  });

  // Riaprire la tendina e riscegliere lo stesso numero non e' una richiesta di
  // rifare il lavoro: su duemila repository sarebbero minuti buttati.
  it("non riscansiona se il valore non è cambiato", () => {
    expect(shouldRescanForDepth(4, 4, "D:\\lavoro", true)).toBe(false);
  });

  // Prima della prima scansione non c'e' niente da rifare: la profondita' resta
  // una preferenza per quando la cartella verra' scelta.
  it("non riscansiona senza una cartella di lavoro", () => {
    expect(shouldRescanForDepth(4, 8, "", true)).toBe(false);
  });

  it("non chiama il backend quando non c'è un backend", () => {
    expect(shouldRescanForDepth(4, 8, "D:\\lavoro", false)).toBe(false);
  });
});

describe("avanzamento", () => {
  function progress(operation: string, completed: number, total = 10): BatchProgress {
    return { operation, completed, total, repoName: "demo", success: true };
  }

  // Gli eventi arrivano da più worker ed escono fuori da ogni lock: possono
  // sorpassarsi. Senza guardia il contatore arretrerebbe sotto gli occhi
  // dell'utente.
  it("non lascia arretrare il contatore della stessa operazione", () => {
    expect(mergeProgress(progress("fetch", 5), progress("fetch", 3))).toEqual(progress("fetch", 5));
    expect(mergeProgress(progress("fetch", 5), progress("fetch", 7))).toEqual(progress("fetch", 7));
  });

  it("riparte da zero quando cambia operazione", () => {
    expect(mergeProgress(progress("fetch", 9), progress("push", 1))).toEqual(progress("push", 1));
  });

  it("accetta il primo evento", () => {
    expect(mergeProgress(null, progress("scan", 1))).toEqual(progress("scan", 1));
  });
});
