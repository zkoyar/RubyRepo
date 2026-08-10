import { MESSAGES, type MessageId } from "./i18n/dictionary";
import type {
  BatchProgress,
  CommandError,
  OperationResult,
  RepositoryFilter,
  PullStrategy,
  RepositoryGroup,
  RepositoryInfo,
} from "./types";

// Recognises github.com in both HTTPS and SSH URLs, refusing hosts that only
// contain it as a subdomain or as a path segment. It only serves to classify
// the repositories in the interface: the check that authorises the use of the
// token remains the one in the Rust backend.
const GITHUB_REMOTE = /(^|@|\/\/)github\.com([/:]|$)/i;

export function isDirty(repository: RepositoryInfo): boolean {
  return (
    repository.staged > 0 ||
    repository.unstaged > 0 ||
    repository.untracked > 0 ||
    repository.conflicted > 0 ||
    repository.changedFiles > 0
  );
}

export function hasRemote(repository: RepositoryInfo): boolean {
  return Boolean(repository.remoteName || repository.remoteUrl);
}

export function isGitHubRemote(repository: RepositoryInfo): boolean {
  return hasRemote(repository) && GITHUB_REMOTE.test(repository.remoteUrl ?? "");
}

export function repositoryGroup(repository: RepositoryInfo): RepositoryGroup {
  if (!hasRemote(repository)) return "local";
  return isGitHubRemote(repository) ? "github" : "otherRemote";
}

export function matchesFilter(
  repository: RepositoryInfo,
  filter: RepositoryFilter,
): boolean {
  switch (filter) {
    case "dirty":
      return isDirty(repository);
    case "ahead":
      return repository.ahead > 0;
    case "behind":
      return repository.behind > 0;
    case "conflict":
      return repository.conflicted > 0;
    case "github":
      return repositoryGroup(repository) === "github";
    case "otherRemote":
      return repositoryGroup(repository) === "otherRemote";
    case "noRemote":
      return !hasRemote(repository);
    case "all":
      return true;
  }
}

/// The branch as shown in the table, or the message that stands in for it.
///
/// A detached HEAD with a known commit needs no translation — `HEAD @ abc1234`
/// reads the same everywhere — so the identifier is returned only when there is
/// nothing concrete to show.
export function displayBranch(repository: RepositoryInfo): string | MessageId {
  if (repository.detached) {
    return repository.headShort ? `HEAD @ ${repository.headShort}` : "branch.detached";
  }

  return repository.branch || "branch.unknown";
}

export function compactPath(path: string, rootPath: string): string {
  if (rootPath && path.toLocaleLowerCase().startsWith(rootPath.toLocaleLowerCase())) {
    const relative = path.slice(rootPath.length).replace(/^[\\/]+/, "");
    return relative || path;
  }

  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

/// Formats the moment a repository was last inspected.
///
/// Returns the identifier and its parameter rather than a sentence: the time
/// itself must follow the chosen locale, and only the caller knows it.
export function formatCheckedAt(
  value: number | string,
  locale: string,
): { id: MessageId; params?: { time: string } } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { id: "table.checkedUnknown" };

  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return { id: "table.checkedAt", params: { time } };
}

/// Maps a backend operation onto the message that names it.
///
/// Returns an identifier rather than a label: the caller translates, so the
/// same operation reads correctly in every language. An operation the frontend
/// does not know about falls back to the generic label instead of showing a raw
/// identifier from the backend.
export function operationLabel(operation: string): MessageId {
  const labels: Record<string, MessageId> = {
    fetch: "operation.fetch",
    pull: "operation.pull",
    push: "operation.push",
    commit: "operation.commit",
    stage: "operation.stage",
    unstage: "operation.unstage",
    discard: "operation.discard",
    link: "operation.link",
    clone: "operation.clone",
  };
  return labels[operation.toLocaleLowerCase()] ?? "operation.unknown";
}

/// Code of the conflict on the `origin` remote, defined by `errors.rs` in the
/// backend. It must stay aligned with `ORIGIN_CONFLICT_CODE`.
export const ORIGIN_CONFLICT_CODE = "originConflict";

/// Code returned when a repository is no longer among the authorised ones.
export const UNAUTHORIZED_REPOSITORY_CODE = "unauthorizedRepository";

function asCommandError(error: unknown): CommandError | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = error as Partial<CommandError>;
  return typeof candidate.code === "string" && typeof candidate.message === "string"
    ? (candidate as CommandError)
    : null;
}

/// The text to show for an error, translated when the backend named it.
///
/// `translate` is passed in rather than imported so this stays a pure function:
/// the caller holds the chosen language. An identifier the dictionary does not
/// know falls back to the English sentence the backend sent — the message
/// degrades, it does not disappear.
export function errorMessage(
  error: unknown,
  translate?: (id: MessageId, params?: Record<string, string>) => string,
): string {
  const structured = asCommandError(error);
  if (structured) {
    const id = structured.messageId;
    if (id && translate && id in MESSAGES) {
      return translate(id as MessageId, structured.params);
    }
    return structured.message;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const serialised = JSON.stringify(error);
    if (serialised !== undefined) return serialised;
  } catch {
    // Circular or otherwise non-serialisable values use the same fallback as
    // `undefined`, which JSON.stringify accepts but does not turn into text.
  }
  return translate ? translate("error.unknown") : "Unknown error";
}

/// The error code when the backend supplies one. It replaces the inspections of
/// the message text, which depended on the language and on the wording.
export function errorCode(error: unknown): string | null {
  return asCommandError(error)?.code ?? null;
}

/// Breakdown of the outcomes of a batch.
export interface BatchSummary {
  done: number;
  failed: number;
  skipped: number;
}

/// Separates the repositories that really failed from those never processed.
///
/// It lives here and not inside the component because it is a decision, not a
/// rendering: cancelled and unreachable are not failures, and telling them as
/// such made people believe something had gone wrong on repositories nobody
/// had touched.
export function summariseResults(results: OperationResult[]): BatchSummary {
  const skipped = results.filter(
    (result) => result.code === "cancelled" || result.code === "unavailable",
  ).length;
  const failed = results.filter(
    (result) => !result.success && result.code !== "cancelled" && result.code !== "unavailable",
  ).length;

  return { done: results.length - failed - skipped, failed, skipped };
}

/// The text to show for an operation outcome, translated when the backend
/// named it.
///
/// Same shape and same rule as `errorMessage`: `translate` arrives as an
/// argument so this stays pure, and an identifier the dictionary does not know
/// falls back to the English sentence the backend sent.
export function outcomeMessage(
  result: Pick<OperationResult, "message" | "messageId" | "params">,
  translate: (id: MessageId, params?: Record<string, string>) => string,
): string {
  const id = result.messageId;
  if (id && id in MESSAGES) return translate(id as MessageId, result.params ?? undefined);
  return result.message;
}

/// Summary sentence shown at the end of a batch, as an identifier plus numbers.
///
/// The four cases are whole, distinct sentences, not pieces to join with a
/// comma: building the list here would impose the word order of the original on
/// every language, and in German the sentence would come out wrong.
export function summaryMessage(summary: BatchSummary): {
  id: MessageId;
  params: Record<string, number>;
} {
  const { done, failed, skipped } = summary;
  if (failed === 0 && skipped === 0) return { id: "batch.allDone", params: { done } };
  if (skipped === 0) return { id: "batch.doneAndFailed", params: { done, failed } };
  if (failed === 0) return { id: "batch.doneAndSkipped", params: { done, skipped } };
  return { id: "batch.doneFailedSkipped", params: { done, failed, skipped } };
}

/// Tone of the notification: an error only if something really failed.
export function summaryTone(summary: BatchSummary): "success" | "error" | "info" {
  if (summary.failed > 0) return "error";
  return summary.skipped > 0 ? "info" : "success";
}

/// Why a repository cannot take part in a pull or a push, or `null` if it can.
///
/// It lives here and not in the dialog because it decides **which repositories
/// are operated on**, and it is the class of error that costs most: a guard too
/// wide touches something it should not have, one too narrow makes an existing
/// feature unreachable. It happened: with merge and rebase freshly added, the
/// guard discarded precisely the diverged branches, that is the only cases those
/// two strategies were written for.
export function syncBlockedReason(
  repository: RepositoryInfo,
  mode: "pull" | "push",
  strategy: PullStrategy = "fastForward",
): MessageId | null {
  if (repository.conflicted > 0) return "blocked.conflicts";
  if (repository.detached) return "branch.detached";
  if (!hasRemote(repository)) return "blocked.noRemote";

  if (mode === "push") {
    if (!repository.upstream) {
      if (!repository.branch) return "blocked.noBranch";
      if (!repository.headShort) return "blocked.noCommit";
      return null;
    }
    if (repository.behind > 0) {
      return repository.ahead > 0 ? "blocked.diverged" : "blocked.remoteAhead";
    }
    if (repository.ahead === 0) return "blocked.nothingToSend";
    return null;
  }

  if (!repository.upstream) return "blocked.noUpstream";
  // Unsaved changes block every strategy: Git would refuse anyway, and
  // insisting would mean risking the user's work.
  if (isDirty(repository)) return "blocked.dirty";
  if (repository.behind === 0) return "blocked.upToDate";
  if (strategy === "fastForward" && repository.ahead > 0) {
    return repository.behind > 0 ? "blocked.divergedChooseStrategy" : "blocked.localCommits";
  }

  return null;
}

/// Suggested folder name for cloning `owner/repository`.
export function defaultCloneFolderName(repositoryFullName: string): string {
  return repositoryFullName.split("/")[1] ?? "";
}

/// Explains why a folder name cannot be used, or `null` if it is fine.
///
/// The check that counts remains the backend's, which is the only one deciding
/// what ends up on disk: this only says it before the journey, while the user is
/// still typing. If the two diverge the backend wins and the user sees an error
/// later — annoying, not dangerous.
export function cloneFolderNameProblem(name: string): MessageId | null {
  const trimmed = name.trim();
  // Empty is not an error: it means "use the repository name".
  if (trimmed === "") return null;
  if (trimmed.length > 128) return "clone.nameTooLong";
  if (trimmed === "." || trimmed === "..") return "clone.namePath";
  if (trimmed.startsWith("-")) return "clone.nameLeadingDash";
  if (trimmed.endsWith(".")) return "clone.nameTrailingDot";
  // Must stay aligned with `validate_folder_name` in `git.rs`: dashes and
  // internal spaces are allowed, because many repository names contain them.
  if (/[/\\:*?"<>|]/.test(trimmed)) return "clone.nameSeparators";
  return null;
}

/// Decides whether a change of depth must restart the scan.
///
/// The depth decides which repositories exist, not how they are shown: letting
/// it change without a new pass would have the control state one number while
/// the table reflects another. It does need a folder already chosen, though —
/// before the first scan the value is only a preference — and the browser has no
/// backend to ask.
export function shouldRescanForDepth(
  current: number,
  next: number,
  rootPath: string,
  available: boolean,
): boolean {
  return available && rootPath !== "" && next !== current;
}

/// Decides which progress to show between the current one and the one that just
/// arrived.
///
/// The events come from several workers and are emitted outside any lock, so
/// they can overtake each other: without this guard the counter would go
/// backwards under the user's eyes. The comparison is per operation, so a scan
/// and a fetch do not get in each other's way.
export function mergeProgress(
  current: BatchProgress | null,
  next: BatchProgress,
): BatchProgress {
  if (current && current.operation === next.operation && current.completed > next.completed) {
    return current;
  }
  return next;
}
