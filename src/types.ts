export interface RepositoryInfo {
  path: string;
  name: string;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  changedFiles: number;
  headShort: string | null;
  lastCommit: string | null;
  checkedAt: number | string;
}

export interface FileChange {
  path: string;
  originalPath?: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface RepositoryDiff {
  staged: string;
  unstaged: string;
  truncated: boolean;
}

export interface ScanResult {
  rootPath: string;
  repositories: RepositoryInfo[];
  warnings: string[];
}

export interface CommitRequest {
  repoPath: string;
  message: string;
  stageAll: boolean;
}

/// Outcomes the backend can tell apart. `failed` is a real failure; `cancelled`
/// and `unavailable` are repositories that were never processed, and have to be
/// told to the user differently.
export type OperationCode = "ok" | "failed" | "cancelled" | "unavailable";

export interface OperationResult {
  repoPath: string;
  repoName: string;
  operation: string;
  success: boolean;
  code: OperationCode;
  /// The English sentence. It stays even when `messageId` is present, and comes
  /// back on its own if the dictionary does not know the identifier: the outcome
  /// degrades, it does not disappear.
  message: string;
  messageId?: string | null;
  params?: Record<string, string> | null;
  output: string;
  /// True when `output` was cut. The marker is written here by the frontend: in
  /// the backend it would have ended up among Git's own words, where it cannot
  /// be translated without touching those too.
  outputTruncated?: boolean;
}

export type RepositoryFilter =
  | "all"
  | "dirty"
  | "ahead"
  | "behind"
  | "conflict"
  | "github"
  | "otherRemote"
  | "noRemote";

export type RepositoryGroup = "github" | "otherRemote" | "local";

/// The structured error every backend command returns. It used to be a plain
/// string, and the interface was forced to tell the cases apart with a regex
/// over the text.
export interface CommandError {
  code: string;
  /// English text, and what is shown when there is no identifier yet. Git's own
  /// output arrives here too and is deliberately not translated.
  message: string;
  /// Identifier of the translated message, when the backend has one.
  messageId?: string | null;
  /// Values for the `{name}` placeholders of that message.
  params?: Record<string, string>;
  retryable: boolean;
  retryAfterSeconds: number | null;
}

/// Progress emitted by the backend after each repository of a batch.
export interface BatchProgress {
  operation: string;
  completed: number;
  total: number;
  repoName: string;
  success: boolean;
}

export type FileOperation = "stage" | "unstage" | "discard";

export type BatchOperation = "fetch" | "pull" | "push" | "commit" | FileOperation;

export interface OperationLogEntry extends OperationResult {
  id: string;
  timestamp: string;
}

export interface GitHubLoginRequest {
  userCode: string;
  verificationUri: string;
  expiresAt: number | string;
  intervalSeconds: number;
}

export interface GitHubUser {
  login: string;
  name?: string | null;
  avatarUrl: string;
  htmlUrl: string;
  bio?: string | null;
  followers: number;
  following: number;
  publicRepos: number;
  totalPrivateRepos?: number | null;
}

export interface GitHubSession {
  user: GitHubUser;
  repositoryCount: number;
  installationCount: number;
  expiresAt?: number | string | null;
  persisted: boolean;
}

/// There is no `message` field: the status alone is enough to choose the
/// sentence, which lives in the frontend dictionary with all the others. A
/// message from the backend would be the same text written in two places.
export interface GitHubLoginPollResult {
  status: "pending" | "slowDown" | "complete" | "expired";
  retryAfterSeconds: number;
  session?: GitHubSession | null;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  canPush: boolean;
  canAdmin: boolean;
  installationId: number;
}

export interface GitHubDeleteRepositoryRequest {
  repositoryId: number;
  repositoryFullName: string;
  confirmation: string;
}

export interface GitHubDeleteRepositoryResult {
  repositoryId: number;
  repositoryFullName: string;
  deleted: boolean;
}

export interface GitHubCreateRepositoryRequest {
  name: string;
  description: string | null;
  private: boolean;
  autoInit: boolean;
}

export interface GitHubCreatedRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string | null;
}

export interface GitHubLinkRepositoryRequest {
  folderPath: string;
  repositoryFullName: string;
  cloneUrl: string;
}

export interface GitHubLinkRepositoryResult {
  repository: RepositoryInfo;
  initialized: boolean;
  alreadyLinked: boolean;
  remoteName: string;
  remoteUrl: string;
}

export interface CommitEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export type HistoryScope = "recent" | "outgoing";

export interface HistoryResult {
  commits: CommitEntry[];
  /// Absent when the branch has no upstream: "to send" does not apply, which is
  /// different from "there is nothing to send".
  upstream: string | null;
  truncated: boolean;
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface StashEntry {
  index: number;
  /// Stable object identity captured with the displayed stack position. The
  /// backend verifies both before acting, so a reordered stash cannot make a
  /// click target another entry.
  objectId: string;
  message: string;
  branch: string | null;
  date: string;
}

export type StashAction = "apply" | "pop" | "drop";

export type PendingOperation = "none" | "merge" | "rebase" | "cherryPick" | "revert";

export interface ConflictState {
  pending: PendingOperation;
  conflicted: string[];
}

export type ConflictAction = "abort" | "continue";

/// Fast-forward stays the default: it is the only one that cannot produce a
/// surprise conflict.
export type PullStrategy = "fastForward" | "merge" | "rebase";

export interface BranchInfo {
  name: string;
  current: boolean;
  upstream: string | null;
  /// `ahead`, `behind`, `diverged`, `same`, `gone`, or absent when the branch
  /// has no upstream.
  track: string | null;
  subject: string;
  /// Exists only on a remote: choosing it creates the local copy.
  remoteOnly: boolean;
}

export interface BranchList {
  branches: BranchInfo[];
  current: string | null;
  detached: boolean;
}

export interface GitHubCloneRepositoryRequest {
  /// The folder that will contain the copy, not the copy's own folder.
  parentPath: string;
  repositoryFullName: string;
  cloneUrl: string;
  /// Absent or empty means "same as the repository".
  folderName?: string;
}

export interface GitHubCloneRepositoryResult {
  repository: RepositoryInfo;
  folderPath: string;
  remoteName: string;
  remoteUrl: string;
}
