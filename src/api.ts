import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  CommandError,
  CommitRequest,
  FileChange,
  BranchList,
  ConflictAction,
  ConflictState,
  HistoryResult,
  HistoryScope,
  PullStrategy,
  RemoteInfo,
  StashAction,
  StashEntry,
  GitHubCloneRepositoryRequest,
  GitHubCloneRepositoryResult,
  GitHubCreatedRepository,
  GitHubCreateRepositoryRequest,
  GitHubDeleteRepositoryRequest,
  GitHubDeleteRepositoryResult,
  BatchProgress,
  GitHubLoginPollResult,
  GitHubLoginRequest,
  GitHubLinkRepositoryRequest,
  GitHubLinkRepositoryResult,
  GitHubRepository,
  GitHubSession,
  OperationResult,
  RepositoryDiff,
  RepositoryInfo,
  ScanResult,
} from "./types";

export const runningInTauri = isTauri();

/// The folder pickers go through backend commands rather than the dialog
/// plugin: it is the backend that opens the native window and records the
/// chosen path. That is how `scan_repositories`, `github_link_repository` and
/// `github_clone_repository` can tell a folder the user really picked from a
/// string the webview made up — which downstream would end in a `git init` or
/// in a folder created on disk.
/// The title of the native window is the only text the backend cannot
/// translate on its own: the dictionary and the active language live here. It
/// therefore travels already translated, and the backend cleans it before
/// showing it.
export async function chooseRootFolder(title: string): Promise<string | null> {
  if (!runningInTauri) return null;
  return (await invoke<string | null>("choose_workspace_folder", { title })) ?? null;
}

export async function chooseGitHubLinkFolder(title: string): Promise<string | null> {
  if (!runningInTauri) return null;
  return (await invoke<string | null>("choose_link_folder", { title })) ?? null;
}

export async function chooseGitHubCloneFolder(title: string): Promise<string | null> {
  if (!runningInTauri) return null;
  return (await invoke<string | null>("choose_clone_folder", { title })) ?? null;
}

export function scanRepositories(rootPath: string, maxDepth: number) {
  return invoke<ScanResult>("scan_repositories", { rootPath, maxDepth });
}

export function refreshRepositories(repoPaths: string[]) {
  return invoke<RepositoryInfo[]>("refresh_repositories", { repoPaths });
}

export function getRepositoryChanges(repoPath: string) {
  return invoke<FileChange[]>("get_repository_changes", { repoPath });
}

export function getRepositoryDiff(repoPath: string) {
  return invoke<RepositoryDiff>("get_repository_diff", { repoPath });
}

export function commitRepositories(requests: CommitRequest[]) {
  return invoke<OperationResult[]>("commit_repositories", { requests });
}

export function fetchRepositories(repoPaths: string[]) {
  return invoke<OperationResult[]>("fetch_repositories", { repoPaths });
}

export function pullRepositories(repoPaths: string[], strategy?: PullStrategy) {
  return invoke<OperationResult[]>("pull_repositories", { repoPaths, strategy });
}

export function pushRepositories(repoPaths: string[]) {
  return invoke<OperationResult[]>("push_repositories", { repoPaths });
}

export function stageFiles(repoPath: string, paths: string[]) {
  return invoke<OperationResult>("stage_files", { repoPath, paths });
}

export function unstageFiles(repoPath: string, paths: string[]) {
  return invoke<OperationResult>("unstage_files", { repoPath, paths });
}

/// Listens for batch progress. Returns the unsubscribe function; outside Tauri it does nothing, so callers do not have to
/// branch.
export async function onBatchProgress(
  handler: (progress: BatchProgress) => void,
): Promise<() => void> {
  if (!runningInTauri) return () => {};
  return listen<BatchProgress>("batch-progress", (event) => handler(event.payload));
}

/// Asks for the running Git operation to stop. Returns at once: the
/// backend kills the running process and skips the repositories not reached
/// yet, which appear in the results as cancelled.
export function cancelOperations() {
  return invoke<void>("cancel_operations");
}

export function discardFiles(repoPath: string, paths: string[]) {
  return invoke<OperationResult>("discard_files", { repoPath, paths });
}

/// Goes through a backend command rather than the plugin, so the folder shown
/// has to be one of those authorised by the scan.
export function revealRepository(repoPath: string) {
  return invoke<void>("reveal_repository", { repoPath });
}

export function repositoryHistory(repoPath: string, scope: HistoryScope) {
  return invoke<HistoryResult>("repository_history", { request: { repoPath, scope } });
}

export function listRemotes(repoPath: string) {
  return invoke<RemoteInfo[]>("list_remotes", { repoPath });
}

export function setRemote(repoPath: string, name: string, url: string) {
  return invoke<RepositoryInfo>("set_remote", { request: { repoPath, name, url } });
}

export function removeRemote(repoPath: string, name: string) {
  return invoke<RepositoryInfo>("remove_remote", { request: { repoPath, name, url: null } });
}

export function listStashes(repoPath: string) {
  return invoke<StashEntry[]>("list_stashes", { repoPath });
}

export function createStash(repoPath: string, message: string, includeUntracked: boolean) {
  return invoke<RepositoryInfo>("create_stash", {
    request: { repoPath, message, includeUntracked },
  });
}

export function applyStash(
  repoPath: string,
  index: number,
  objectId: string,
  action: StashAction,
) {
  return invoke<RepositoryInfo>("apply_stash", {
    request: { repoPath, index, objectId, action },
  });
}

export function conflictState(repoPath: string) {
  return invoke<ConflictState>("conflict_state", { repoPath });
}

export function resolveConflict(repoPath: string, action: ConflictAction) {
  return invoke<RepositoryInfo>("resolve_conflict", { request: { repoPath, action } });
}

export function listBranches(repoPath: string) {
  return invoke<BranchList>("list_branches", { repoPath });
}

export function switchBranch(repoPath: string, branch: string) {
  return invoke<RepositoryInfo>("switch_branch", { request: { repoPath, branch } });
}

export function createBranch(repoPath: string, name: string, checkout: boolean) {
  return invoke<RepositoryInfo>("create_branch", { request: { repoPath, name, checkout } });
}

export function githubBeginLogin() {
  return invoke<GitHubLoginRequest>("github_begin_login");
}

export function githubPollLogin() {
  return invoke<GitHubLoginPollResult>("github_poll_login");
}

export function githubGetSession() {
  return invoke<GitHubSession | null>("github_get_session");
}

export function githubListRepositories() {
  return invoke<GitHubRepository[]>("github_list_repositories");
}

export function githubCreateRepository(request: GitHubCreateRepositoryRequest) {
  return invoke<GitHubCreatedRepository>("github_create_repository", { request });
}

export function githubDeleteRepository(request: GitHubDeleteRepositoryRequest) {
  return invoke<GitHubDeleteRepositoryResult>("github_delete_repository", { request });
}

export function githubLinkRepository(request: GitHubLinkRepositoryRequest) {
  return invoke<GitHubLinkRepositoryResult>("github_link_repository", { request });
}

export function githubCloneRepository(request: GitHubCloneRepositoryRequest) {
  return invoke<GitHubCloneRepositoryResult>("github_clone_repository", { request });
}

export function githubLogout() {
  return invoke<void>("github_logout");
}

export async function openExternalUrl(value: string): Promise<void> {
  if (!runningInTauri) return;

  const url = new URL(value);
  if (url.protocol !== "https:" || url.host.toLocaleLowerCase() !== "github.com") {
    // Lanciato nella stessa forma degli errori del backend — codice, frase
    // inglese e identificatore — cosi' `errorMessage` lo traduce come tutti gli
    // altri invece di mostrare la frase originale a chi legge in tedesco.
    throw {
      code: "invalidRequest",
      message: "Only HTTPS addresses on the github.com domain may be opened.",
      messageId: "error.externalUrlRefused",
      retryable: false,
      retryAfterSeconds: null,
    } satisfies CommandError;
  }
  await openUrl(url);
}
