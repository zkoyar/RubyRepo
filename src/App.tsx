import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronRight,
  CircleDotDashed,
  CloudDownload,
  FolderGit2,
  FolderOpen,
  GitCommitHorizontal,
  GitFork,
  Globe2,
  History,
  Link2,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Search,
  Square,
  X,
} from "lucide-react";
import {
  cancelOperations,
  chooseRootFolder,
  commitRepositories,
  discardFiles,
  fetchRepositories,
  getRepositoryChanges,
  getRepositoryDiff,
  githubGetSession,
  onBatchProgress,
  githubListRepositories,
  pullRepositories,
  pushRepositories,
  refreshRepositories,
  revealRepository,
  runningInTauri,
  scanRepositories,
  stageFiles,
  unstageFiles,
} from "./api";
import "./App.css";
import { CommitDialog } from "./components/CommitDialog";
import { BranchDialog } from "./components/BranchDialog";
import { GitHubAccountButton } from "./components/GitHubAccountButton";
import { LanguageSelector } from "./i18n/LanguageSelector";
import { useTranslation } from "./i18n/context";
import type { MessageId } from "./i18n/dictionary";
import { GitHubAccountDialog } from "./components/GitHubAccountDialog";
import { GitHubCloneRepositoryDialog } from "./components/GitHubCloneRepositoryDialog";
import { GitHubLinkRepositoryDialog } from "./components/GitHubLinkRepositoryDialog";
import { OperationLog } from "./components/OperationLog";
import { RepositoryInspector } from "./components/RepositoryInspector";
import { RepositoryTable } from "./components/RepositoryTable";
import { RepositoryToolsDialog } from "./components/RepositoryToolsDialog";
import { SyncDialog } from "./components/SyncDialog";
import { demoChanges, demoDiffs, demoRepositories } from "./demoData";
import {
  errorMessage,
  hasRemote,
  isDirty,
  matchesFilter,
  mergeProgress,
  operationLabel,
  outcomeMessage,
  shouldRescanForDepth,
  summariseResults,
  summaryMessage,
  summaryTone,
} from "./repositoryUtils";
import type {
  BatchOperation,
  BatchProgress,
  CommitRequest,
  FileChange,
  FileOperation,
  GitHubRepository,
  GitHubSession,
  PullStrategy,
  GitHubCloneRepositoryResult,
  GitHubLinkRepositoryResult,
  OperationLogEntry,
  OperationResult,
  RepositoryDiff,
  RepositoryFilter,
  RepositoryInfo,
} from "./types";

interface FilterDefinition {
  id: RepositoryFilter;
  label: MessageId;
  icon: typeof GitFork;
}

interface ToastMessage {
  id: number;
  tone: "success" | "error" | "info";
  text: string;
}

const FILTERS: FilterDefinition[] = [
  { id: "all", label: "filter.all", icon: FolderGit2 },
  { id: "dirty", label: "filter.dirty", icon: CircleDotDashed },
  { id: "ahead", label: "filter.ahead", icon: ArrowUpFromLine },
  { id: "behind", label: "filter.behind", icon: ArrowDownToLine },
  { id: "conflict", label: "filter.conflict", icon: AlertTriangle },
  { id: "github", label: "filter.github", icon: GitFork },
  { id: "otherRemote", label: "filter.otherRemote", icon: Globe2 },
  { id: "noRemote", label: "filter.noRemote", icon: Monitor },
];

const DEMO_ROOT = "/Users/demo/Workspace";

/// Depths the interface offers. The backend accepts up to 32, but a saved
/// preference must not be able to ask for more than the UI proposes.
const DEPTH_CHOICES = [2, 3, 4, 5, 6, 8];

/// Cap on the entries of the activity log. The panel shows only a few at a
/// time anyway, and each entry can carry up to 16 KB of Git output.
const MAX_LOG_ENTRIES = 500;

/// Keys of the preferences kept across restarts. The app used to persist
/// nothing: every start meant picking the folder again and rescanning, and
/// until then every command failed with "repository not authorised".
/// Preferences kept across restarts.
///
/// They were renamed with the app, and deliberately without a fallback onto the
/// old keys. That fallback was written, and then removed once it turned out it
/// could never fire: the WebView2 profile lives under the bundle identifier, so
/// renaming the app gives the webview a fresh profile and `localStorage` starts
/// empty. Reading the previous key would have looked like a safety net while
/// catching nothing, which is worse than having none.
///
/// What actually matters does survive, by other means: the GitHub session comes
/// from the OS keychain, and the authorised folders from the data directory —
/// both read the previous name explicitly. What resets is the remembered folder,
/// the depth and the language: one folder to pick again, once.
const ROOT_PATH_KEY = "rubyrepo.rootPath";
const MAX_DEPTH_KEY = "rubyrepo.maxDepth";

function readStoredRootPath(): string {
  if (!runningInTauri) return DEMO_ROOT;
  try {
    return window.localStorage.getItem(ROOT_PATH_KEY) ?? "";
  } catch {
    // Storage unavailable: start from nothing, it is not an error to show.
    return "";
  }
}

function readStoredMaxDepth(): number {
  try {
    const stored = Number(window.localStorage.getItem(MAX_DEPTH_KEY));
    // Only the values the interface itself offers: a tampered value must not be
    // able to ask the backend for a depth the UI does not propose.
    return DEPTH_CHOICES.includes(stored) ? stored : 4;
  } catch {
    return 4;
  }
}

function storePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignored on purpose: persistence is a convenience, not a requirement.
  }
}


function App() {
  const { locale, t } = useTranslation();
  const [rootPath, setRootPath] = useState(readStoredRootPath);
  const [maxDepth, setMaxDepth] = useState(readStoredMaxDepth);
  const [repositories, setRepositories] = useState<RepositoryInfo[]>(
    runningInTauri ? [] : demoRepositories,
  );
  const [warnings, setWarnings] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RepositoryFilter>("all");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string | null>(
    runningInTauri ? null : demoRepositories[0].path,
  );
  const [changes, setChanges] = useState<FileChange[]>(
    runningInTauri ? [] : demoChanges[demoRepositories[0].path] ?? [],
  );
  const [diff, setDiff] = useState<RepositoryDiff | null>(
    runningInTauri ? null : demoDiffs[demoRepositories[0].path] ?? null,
  );
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsRevision, setDetailsRevision] = useState(0);
  const [busyOperation, setBusyOperation] = useState<BatchOperation | "scan" | "refresh" | null>(null);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [syncDialog, setSyncDialog] = useState<"pull" | "push" | null>(null);
  const [preparingSync, setPreparingSync] = useState<"pull" | "push" | null>(null);
  const [operationLog, setOperationLog] = useState<OperationLogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [githubSession, setGitHubSession] = useState<GitHubSession | null>(null);
  const [githubSessionLoading, setGitHubSessionLoading] = useState(runningInTauri);
  const [githubDialogOpen, setGitHubDialogOpen] = useState(false);
  const [githubDialogInitialTab, setGitHubDialogInitialTab] = useState<"profile" | "repositories">("profile");
  const [githubRepositories, setGitHubRepositories] = useState<GitHubRepository[] | null>(null);
  const [linkTarget, setLinkTarget] = useState<RepositoryInfo | null>(null);
  const [cloneRepositories, setCloneRepositories] = useState<GitHubRepository[] | null>(null);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [branchTarget, setBranchTarget] = useState<RepositoryInfo | null>(null);
  const [toolsTarget, setToolsTarget] = useState<RepositoryInfo | null>(null);
  const [linkingPath, setLinkingPath] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // The closing refresh of a batch runs while `busyOperation` is still set.
  // Without this flag the stop button would stay active and a click would cut
  // the update short: the table would be left with stale data and no warning,
  // because that refresh is invoked with errors suppressed.
  const [finalising, setFinalising] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);

  const activeRepository = useMemo(
    () => repositories.find((repository) => repository.path === activePath) ?? null,
    [activePath, repositories],
  );

  const selectedRepositories = useMemo(
    () => repositories.filter((repository) => selectedPaths.has(repository.path)),
    [repositories, selectedPaths],
  );

  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return repositories
      .filter((repository) => {
        if (!matchesFilter(repository, filter)) return false;
        if (!normalizedQuery) return true;
        return [repository.name, repository.path, repository.branch, repository.upstream]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase(locale).includes(normalizedQuery));
      })
      .sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }));
  }, [filter, locale, query, repositories]);

  const filterCounts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map(({ id }) => [
          id,
          repositories.filter((repository) => matchesFilter(repository, id)).length,
        ]),
      ) as Record<RepositoryFilter, number>,
    [repositories],
  );

  const hiddenSelectionCount = selectedRepositories.filter(
    (repository) => !filteredRepositories.some((visible) => visible.path === repository.path),
  ).length;
  const isBusy = busyOperation !== null;

  // The listener is installed once: the backend emits an event for every
  // completed repository, so a batch over dozens of folders shows progress
  // instead of a single mute spinner.
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let cancelled = false;

    void onBatchProgress((progress) =>
      setBatchProgress((current) => mergeProgress(current, progress)),
    ).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    if (!runningInTauri) return;
    storePreference(ROOT_PATH_KEY, rootPath);
  }, [rootPath]);

  useEffect(() => {
    storePreference(MAX_DEPTH_KEY, String(maxDepth));
  }, [maxDepth]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!runningInTauri) return;
    let cancelled = false;

    githubGetSession()
      .then((restoredSession) => {
        if (!cancelled) setGitHubSession(restoredSession);
      })
      .catch((error: unknown) => {
        if (!cancelled) notify(t("notify.sessionUnavailable", { reason: errorMessage(error, t) }), "error");
      })
      .finally(() => {
        if (!cancelled) setGitHubSessionLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Session restore on mount, once only. `t` is used only in the error
    // branch and changes identity at every language change: putting it among
    // the dependencies would redo the GitHub request every time the user
    // touches the flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loading the detail of the active repository: the state is cleared
  // synchronously so the files of the previous one are not shown for an
  // instant. The case with no selection is the only purely synchronous branch.
  useEffect(() => {
    if (!activePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChanges([]);
      setDiff(null);
      setDetailsError(null);
      setDetailsLoading(false);
      return;
    }

    if (!runningInTauri) {
      setChanges(demoChanges[activePath] ?? []);
      setDiff(
        demoDiffs[activePath] ?? {
          staged: "",
          unstaged: "",
          truncated: false,
        },
      );
      setDetailsError(null);
      setDetailsLoading(false);
      return;
    }

    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);

    Promise.all([getRepositoryChanges(activePath), getRepositoryDiff(activePath)])
      .then(([nextChanges, nextDiff]) => {
        if (cancelled) return;
        setChanges(nextChanges);
        setDiff(nextDiff);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setChanges([]);
        setDiff(null);
        setDetailsError(errorMessage(error, t));
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activePath, detailsRevision, t]);

  function notify(text: string, tone: ToastMessage["tone"] = "info") {
    setToast({ id: Date.now(), text, tone });
  }

  function browserUnavailable() {
    notify(t("common.desktopOnly"), "info");
  }

  function mergeRepositoryUpdates(updated: RepositoryInfo[]) {
    const byPath = new Map(updated.map((repository) => [repository.path, repository]));
    setRepositories((current) =>
      current.map((repository) => byPath.get(repository.path) ?? repository),
    );
  }

  async function refreshPaths(repoPaths: string[], reportErrors = true) {
    if (repoPaths.length === 0 || !runningInTauri) return;
    try {
      const updated = await refreshRepositories(repoPaths);
      mergeRepositoryUpdates(updated);
    } catch (error) {
      if (reportErrors) notify(t("notify.refreshFailed", { reason: errorMessage(error, t) }), "error");
    } finally {
      if (activePath && repoPaths.includes(activePath)) {
        setDetailsRevision((revision) => revision + 1);
      }
    }
  }

  /// The depth arrives as a parameter and not from the state because whoever
  /// changes it starts the scan in the same handler: `maxDepth` would still be
  /// the old one, and the new pass would use the value the user has just
  /// discarded.
  async function startScan(path: string, depth = maxDepth) {
    if (!runningInTauri) {
      browserUnavailable();
      return;
    }

    setBusyOperation("scan");
    setBatchProgress(null);
    try {
      const result = await scanRepositories(path, depth);
      const sorted = [...result.repositories].sort((a, b) =>
        a.name.localeCompare(b.name, locale, { sensitivity: "base" }),
      );
      setRootPath(result.rootPath);
      setRepositories(sorted);
      setWarnings(result.warnings);
      setSelectedPaths(new Set());
      setActivePath(sorted[0]?.path ?? null);
      setDetailsRevision((revision) => revision + 1);
      notify(
        sorted.length === 1
          ? t("notify.foundOne")
          : t("notify.foundMany", { count: sorted.length }),
        "success",
      );
    } catch (error) {
      notify(t("notify.scanFailed", { reason: errorMessage(error, t) }), "error");
    } finally {
      setBusyOperation(null);
      setBatchProgress(null);
      setFinalising(false);
    }
  }

  /// The depth decides which repositories exist, not how they are shown:
  /// without a new pass the control would state one number while the table
  /// reflects another. It only scans if a working folder is already there;
  /// otherwise the choice stays a preference for the first scan.
  function changeMaxDepth(depth: number) {
    const rescan = shouldRescanForDepth(maxDepth, depth, rootPath, runningInTauri);
    setMaxDepth(depth);
    if (rescan) void startScan(rootPath, depth);
  }

  async function pickRootFolder() {
    if (!runningInTauri) {
      browserUnavailable();
      return;
    }

    try {
      const selected = await chooseRootFolder(t("dialog.chooseWorkspace"));
      if (selected) await startScan(selected);
    } catch (error) {
      notify(t("error.folderUnreadable", { reason: errorMessage(error, t) }), "error");
    }
  }

  async function refreshAll() {
    if (!runningInTauri) {
      browserUnavailable();
      return;
    }
    if (repositories.length === 0) return;

    setBusyOperation("refresh");
    // Without this, "Refresh" after a batch would still show the counter of
    // the previous operation.
    setBatchProgress(null);
    try {
      const updated = await refreshRepositories(repositories.map((repository) => repository.path));
      mergeRepositoryUpdates(updated);
      setDetailsRevision((revision) => revision + 1);
      notify(t("notify.refreshed"), "success");
    } catch (error) {
      notify(t("notify.refreshFailed", { reason: errorMessage(error, t) }), "error");
    } finally {
      setBusyOperation(null);
    }
  }

  function toggleRepository(path: string) {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function togglePaths(paths: string[]) {
    if (paths.length === 0) return;
    setSelectedPaths((current) => {
      const next = new Set(current);
      const allAlreadySelected = paths.every((path) => next.has(path));

      paths.forEach((path) => {
        if (allAlreadySelected) next.delete(path);
        else next.add(path);
      });
      return next;
    });
  }

  function toggleAllVisible() {
    togglePaths(filteredRepositories.map((repository) => repository.path));
  }

  function normalizeResults(
    results: OperationResult[],
    operation: BatchOperation,
  ): OperationLogEntry[] {
    const timestamp = new Date().toISOString();
    return results.map((result, index) => {
      const repository = repositories.find((item) => item.path === result.repoPath);
      return {
        ...result,
        repoName: result.repoName || repository?.name || result.repoPath,
        operation: result.operation || operation,
        message:
          outcomeMessage(result, t) ||
          t(result.success ? "activity.succeeded" : "activity.failed"),
        output: result.output || "",
        id: `${timestamp}-${operation}-${index}-${result.repoPath}`,
        timestamp,
      };
    });
  }

  function commandFailureEntries(
    repoPaths: string[],
    operation: BatchOperation,
    message: string,
  ): OperationLogEntry[] {
    const timestamp = new Date().toISOString();
    return repoPaths.map((repoPath, index) => ({
      id: `${timestamp}-${operation}-error-${index}`,
      timestamp,
      repoPath,
      repoName: repositories.find((repository) => repository.path === repoPath)?.name || repoPath,
      operation,
      success: false,
      code: "failed",
      message,
      output: "",
    }));
  }

  function appendLog(entries: OperationLogEntry[]) {
    // The log grew for the whole session, and every entry can carry up to
    // 16 KB of Git output: forty repositories per batch, repeated for hours,
    // become tens of megabytes held in memory for nothing. The oldest entries
    // are of no use to anyone once read.
    setOperationLog((current) =>
      [...entries].reverse().concat(current).slice(0, MAX_LOG_ENTRIES),
    );
  }

  function repositoryLinked(result: GitHubLinkRepositoryResult) {
    const linkedRepository = result.repository;
    setRepositories((current) => {
      const existingIndex = current.findIndex(
        (repository) => repository.path === linkedRepository.path,
      );
      const next = [...current];
      if (existingIndex >= 0) next[existingIndex] = linkedRepository;
      else next.push(linkedRepository);
      return next.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }));
    });
    setFilter("all");
    setQuery("");
    setSelectedPaths(new Set([linkedRepository.path]));
    setActivePath(linkedRepository.path);
    setDetailsRevision((revision) => revision + 1);

    const timestamp = new Date().toISOString();
    appendLog([{
      id: `${timestamp}-link-${linkedRepository.path}`,
      timestamp,
      repoPath: linkedRepository.path,
      repoName: linkedRepository.name,
      operation: "link",
      success: true,
      code: "ok",
      message: t(
        result.alreadyLinked
          ? "link.resultAlreadyLinked"
          : result.initialized
            ? "link.resultInitialised"
            : "link.resultConfigured",
      ),
      output: `${result.remoteName}: ${result.remoteUrl}`,
    }]);
    notify(
      t(
        result.alreadyLinked ? "notify.linkedAlready" : "notify.linkedNow",
        { name: linkedRepository.name },
      ),
      "success",
    );
  }

  async function cancelRunningOperation() {
    if (!runningInTauri || !isBusy || cancelling || finalising) return;

    setCancelling(true);
    try {
      await cancelOperations();
      notify(t("notify.cancelRequested"), "info");
    } catch (error) {
      notify(t("notify.cancelFailed", { reason: errorMessage(error, t) }), "error");
    } finally {
      setCancelling(false);
    }
  }

  function openGitHubDialog(initialTab: "profile" | "repositories" = "profile") {
    setGitHubDialogInitialTab(initialTab);
    setGitHubDialogOpen(true);
  }

  async function startLinkToGitHub(repository: RepositoryInfo) {
    if (!runningInTauri) {
      browserUnavailable();
      return;
    }
    if (!githubSession) {
      notify(t("notify.signInToLink"), "info");
      openGitHubDialog("profile");
      return;
    }
    if (githubSession.installationCount === 0) {
      notify(t("notify.installApp"), "info");
      openGitHubDialog("profile");
      return;
    }
    if (linkingPath) return;

    setLinkingPath(repository.path);
    try {
      const available = await githubListRepositories();
      if (!available.some((candidate) => candidate.canPush)) {
        notify(t("notify.noWritable"), "error");
        return;
      }
      setGitHubRepositories(available);
      setLinkTarget(repository);
    } catch (error) {
      notify(t("notify.githubUnavailable", { reason: errorMessage(error, t) }), "error");
    } finally {
      setLinkingPath(null);
    }
  }

  function closeLinkDialog() {
    setLinkTarget(null);
  }

  /// A branch switch changes state, counts and upstream: the row has to be
  /// replaced with the one the backend returns, not patched by hand.
  function branchChanged(updated: RepositoryInfo, message: string) {
    mergeRepositoryUpdates([updated]);
    setBranchTarget(updated);
    setDetailsRevision((revision) => revision + 1);
    notify(message, "success");
  }

  /// Stashes, remotes and conflicts change the state of the repository as much
  /// as a branch switch: the row has to be replaced, not touched up.
  function toolsChanged(updated: RepositoryInfo, message: string) {
    mergeRepositoryUpdates([updated]);
    setToolsTarget(updated);
    setDetailsRevision((revision) => revision + 1);
    notify(message, "success");
  }

  /// Unlike linking, push permission is not needed: cloning requires read
  /// access, and filtering by write access would hide everything you contribute
  /// to without owning.
  async function startCloneFromGitHub() {
    if (!runningInTauri) {
      browserUnavailable();
      return;
    }
    if (!githubSession) {
      notify(t("notify.signInToClone"), "info");
      openGitHubDialog("profile");
      return;
    }
    if (cloneLoading) return;

    setCloneLoading(true);
    try {
      const available = await githubListRepositories();
      if (available.length === 0) {
        notify(t("notify.noneToClone"), "error");
        return;
      }
      setCloneRepositories(available);
    } catch (error) {
      notify(t("notify.githubUnavailable", { reason: errorMessage(error, t) }), "error");
    } finally {
      setCloneLoading(false);
    }
  }

  function repositoryCloned(result: GitHubCloneRepositoryResult) {
    const cloned = result.repository;
    setRepositories((current) => {
      const existingIndex = current.findIndex((repository) => repository.path === cloned.path);
      const next = [...current];
      if (existingIndex >= 0) next[existingIndex] = cloned;
      else next.push(cloned);
      return next.sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }));
    });
    setFilter("all");
    setQuery("");
    setSelectedPaths(new Set([cloned.path]));
    setActivePath(cloned.path);
    setDetailsRevision((revision) => revision + 1);

    const timestamp = new Date().toISOString();
    appendLog([{
      id: `${timestamp}-clone-${cloned.path}`,
      timestamp,
      repoPath: cloned.path,
      repoName: cloned.name,
      operation: "clone",
      success: true,
      code: "ok",
      message: t("clone.doneAria"),
      messageId: "clone.doneAria",
      output: `${result.remoteName}: ${result.remoteUrl}`,
    }]);
    notify(t("notify.cloned", { name: cloned.name, path: result.folderPath }), "success");
  }

  async function runBatch(
    operation: BatchOperation,
    repoPaths: string[],
    executor: () => Promise<OperationResult[]>,
  ): Promise<OperationResult[] | null> {
    if (!runningInTauri) {
      browserUnavailable();
      return null;
    }
    if (repoPaths.length === 0) return null;

    setBusyOperation(operation);
    setBatchProgress(null);
    try {
      const results = await executor();
      const entries = normalizeResults(results, operation);
      appendLog(entries);
      const summary = summariseResults(results);
      const summaryText = summaryMessage(summary);
      notify(t(summaryText.id, summaryText.params), summaryTone(summary));

      setFinalising(true);
      await refreshPaths(repoPaths, false);
      if (summary.failed > 0) setLogOpen(true);
      return results;
    } catch (error) {
      const message = errorMessage(error, t);
      appendLog(commandFailureEntries(repoPaths, operation, message));
      setLogOpen(true);
      notify(`${t(operationLabel(operation))}: ${message}`, "error");
      return null;
    } finally {
      // All three: `finalising` was raised before the closing refresh and
      // cleared only by the `finally` of `startScan`, so after the first batch
      // it stayed true forever and the stop button was born already disabled
      // for every later operation.
      setBusyOperation(null);
      setBatchProgress(null);
      setFinalising(false);
    }
  }

  async function runFetch() {
    const eligible = selectedRepositories.filter(hasRemote);
    const skipped = selectedRepositories.filter((repository) => !hasRemote(repository));
    if (skipped.length > 0) {
      appendLog(
        commandFailureEntries(
          skipped.map((repository) => repository.path),
          "fetch",
          t("notify.skippedNoRemote"),
        ),
      );
    }
    if (eligible.length === 0) {
      notify(t("notify.noRemoteSelected"), "error");
      return;
    }
    await runBatch(
      "fetch",
      eligible.map((repository) => repository.path),
      () => fetchRepositories(eligible.map((repository) => repository.path)),
    );
  }

  async function runFileOperation(
    operation: FileOperation,
    repoPath: string,
    paths: string[],
  ): Promise<boolean> {
    if (!runningInTauri) {
      browserUnavailable();
      return false;
    }
    if (paths.length === 0 || busyOperation !== null) return false;

    setBusyOperation(operation);
    try {
      const result = await (
        operation === "stage"
          ? stageFiles(repoPath, paths)
          : operation === "unstage"
            ? unstageFiles(repoPath, paths)
            : discardFiles(repoPath, paths)
      );
      appendLog(normalizeResults([result], operation));

      if (result.success) {
        await refreshPaths([repoPath], false);
        notify(
          outcomeMessage(result, t) ||
            t(paths.length === 1 ? "notify.fileUpdatedOne" : "notify.fileUpdatedMany", {
              count: paths.length,
            }),
          "success",
        );
      } else {
        setLogOpen(true);
        notify(outcomeMessage(result, t) || t("notify.fileOperationFailed"), "error");
      }
      return result.success;
    } catch (error) {
      const message = errorMessage(error, t);
      appendLog(commandFailureEntries([repoPath], operation, message));
      setLogOpen(true);
      notify(`${t(operationLabel(operation))}: ${message}`, "error");
      return false;
    } finally {
      setBusyOperation(null);
    }
  }

  async function runCommit(requests: CommitRequest[]) {
    const results = await runBatch(
      "commit",
      requests.map((request) => request.repoPath),
      () => commitRepositories(requests),
    );
    if (results) setCommitDialogOpen(false);
  }

  async function runSync(
    mode: "pull" | "push",
    repoPaths: string[],
    strategy: PullStrategy = "fastForward",
  ) {
    const results = await runBatch(mode, repoPaths, () =>
      mode === "push" ? pushRepositories(repoPaths) : pullRepositories(repoPaths, strategy),
    );
    if (results) setSyncDialog(null);
  }

  async function prepareSync(mode: "pull" | "push") {
    if (!runningInTauri) {
      browserUnavailable();
      return;
    }

    const remotePaths = selectedRepositories
      .filter(hasRemote)
      .map((repository) => repository.path);

    if (remotePaths.length === 0) {
      setSyncDialog(mode);
      return;
    }

    setPreparingSync(mode);
    try {
      const results = await runBatch("fetch", remotePaths, () => fetchRepositories(remotePaths));
      if (results?.every((result) => result.success)) {
        setSyncDialog(mode);
      }
    } finally {
      setPreparingSync(null);
    }
  }

  async function reveal(path: string) {
    if (!runningInTauri) {
      browserUnavailable();
      return;
    }
    try {
      await revealRepository(path);
    } catch (error) {
      notify(t("notify.revealFailed", { reason: errorMessage(error, t) }), "error");
    }
  }

  return (
    <div className={`app-shell ${selectedRepositories.length > 0 ? "has-selection" : ""}`}>
      <header className="topbar">
        <div className="brand">
          {/* The same file the window and the taskbar use, rather than a copy
              inlined here: two drawings of one mark drift, and nothing in the
              verification would notice. */}
          <img className="brand-mark" src="/icon.svg" alt="" width={38} height={38} />
          <div>
            <strong>RubyRepo</strong>
            <span>{t("app.tagline")}</span>
          </div>
        </div>

        <div className="root-picker">
          <button
            type="button"
            className="root-picker-button"
            onClick={pickRootFolder}
            disabled={busyOperation === "scan"}
            title={t(runningInTauri ? "app.changeFolder" : "app.desktopOnlyShort")}
          >
            {busyOperation === "scan" ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <FolderOpen aria-hidden="true" />
            )}
            <span>
              <small>{t("app.workspaceFolder")}</small>
              <strong>{rootPath || t("app.chooseFolder")}</strong>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
          <label className="depth-control">
            <span>{t("app.depth")}</span>
            <select
              value={maxDepth}
              onChange={(event) => changeMaxDepth(Number(event.currentTarget.value))}
              disabled={isBusy}
              aria-label={t("app.depthAria")}
              title={
                rootPath
                  ? t("app.depthRescan")
                  : t("app.depthNext")
              }
            >
              {DEPTH_CHOICES.map((depth) => (
                <option value={depth} key={depth}>{depth}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="topbar-actions">
          <LanguageSelector />
          <GitHubAccountButton
            session={githubSession}
            loading={githubSessionLoading}
            onClick={() => openGitHubDialog("profile")}
          />
          <button
            type="button"
            className="activity-button"
            onClick={() => setLogOpen(true)}
            aria-label={t("activity.openAria", { count: operationLog.length })}
          >
            <History aria-hidden="true" />
            <span>{t("activity.title")}</span>
            {operationLog.length > 0 && <span className="activity-count">{operationLog.length}</span>}
          </button>
        </div>
      </header>

      {!runningInTauri && (
        <div className="browser-banner" role="status">
          <Monitor aria-hidden="true" />
          <p>
            <strong>{t("app.browserBannerTitle")}</strong> {t("app.browserBannerBody")}{" "}
            <code>npm run tauri dev</code> {t("app.browserBannerTail")}
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="warning-banner" role="status">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>{t("app.scanWarningsTitle", { count: warnings.length })}</strong>
            <p>
              {warnings[0]}
              {warnings.length > 1
                ? ` · ${t("app.scanWarningsMore", { count: warnings.length - 1 })}`
                : ""}
            </p>
          </div>
          <button type="button" className="icon-button icon-button--ghost" onClick={() => setWarnings([])} aria-label={t("app.hideWarnings")}>
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={`workspace ${activeRepository ? "has-inspector" : ""}`}>
        <aside className="filter-sidebar" aria-label={t("app.filtersAria")}>
          <div className="sidebar-heading">
            <span>{t("filter.view")}</span>
            <strong>{repositories.length}</strong>
          </div>
          <nav className="filter-list" aria-label={t("app.filterStateAria")}>
            {FILTERS.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                className={filter === id ? "is-active" : ""}
                onClick={() => setFilter(id)}
                aria-current={filter === id ? "page" : undefined}
                key={id}
              >
                <Icon aria-hidden="true" />
                <span>{t(label)}</span>
                <strong>{filterCounts[id]}</strong>
              </button>
            ))}
          </nav>

          <div className="workspace-summary">
            <span className="workspace-summary-icon"><FolderGit2 aria-hidden="true" /></span>
            <div>
              <strong>{t("app.summaryCount", { count: repositories.length })}</strong>
              <span>{t("app.summaryDirty", { count: filterCounts.dirty })}</span>
            </div>
          </div>
        </aside>

        <main className="dashboard">
          <header className="dashboard-header">
            <div>
              <p className="eyebrow">{t("app.workspaceEyebrow")}</p>
              <h1>{t("app.repositoriesTitle")}</h1>
              <span className="result-count">
                {t("app.resultCount", {
                  shown: filteredRepositories.length,
                  total: repositories.length,
                })}
              </span>
            </div>
            <div className="dashboard-actions">
              <label className="search-box">
                <Search aria-hidden="true" />
                <span className="sr-only">{t("app.searchRepositories")}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder={t("app.searchPlaceholder")}
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label={t("app.clearSearch")}>
                    <X aria-hidden="true" />
                  </button>
                )}
              </label>
              <button
                type="button"
                className="button button--secondary toolbar-button"
                onClick={() => rootPath ? startScan(rootPath) : pickRootFolder()}
                disabled={isBusy || !runningInTauri}
                title={!runningInTauri ? t("app.desktopOnlyShort") : undefined}
              >
                {busyOperation === "scan" ? <LoaderCircle className="spin" aria-hidden="true" /> : <FolderGit2 aria-hidden="true" />}
                {t("app.scan")}
              </button>
              {/* Il clone stava solo nello stato vuoto, quindi spariva appena
                  c'era una repository: irraggiungibile proprio da chi un
                  workspace ce l'ha gia'. */}
              <button
                type="button"
                className="button button--secondary toolbar-button"
                onClick={() => void startCloneFromGitHub()}
                disabled={isBusy || !runningInTauri || githubSessionLoading || !githubSession || cloneLoading}
                title={t(githubSession ? "app.cloneTitle" : "app.connectFirst")}
              >
                {cloneLoading ? <LoaderCircle className="spin" aria-hidden="true" /> : <CloudDownload aria-hidden="true" />}
                {t("app.clone")}
              </button>
              {isBusy && batchProgress && (
                <span
                  className="batch-progress"
                  role="status"
                  aria-live="polite"
                  title={t("app.lastCompleted", { name: batchProgress.repoName })}
                >
                  {batchProgress.total > 0 && (
                    <span
                      className="batch-progress-bar"
                      style={{
                        width: `${Math.round((batchProgress.completed / batchProgress.total) * 100)}%`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="batch-progress-label">
                    {/* La scansione non conosce il totale mentre cammina
                        l'albero: mostra quante ne ha trovate, senza barra. */}
                    {batchProgress.total > 0
                      ? t("app.batchProgress", {
                          completed: batchProgress.completed,
                          total: batchProgress.total,
                        })
                      : t("app.scanProgress", { count: batchProgress.completed })}
                  </span>
                </span>
              )}
              {isBusy && (
                <button
                  type="button"
                  className="button button--danger toolbar-button"
                  onClick={() => void cancelRunningOperation()}
                  disabled={cancelling || finalising}
                  title={t("app.cancelRunningTitle")}
                >
                  <Square aria-hidden="true" />
                  {t(cancelling ? "app.cancelling" : "app.cancelRunning")}
                </button>
              )}
              <button
                type="button"
                className="icon-button icon-button--bordered"
                onClick={refreshAll}
                disabled={isBusy || repositories.length === 0 || !runningInTauri}
                aria-label={t("app.refreshAllAria")}
                title={t("app.refreshAllTitle")}
              >
                <RefreshCw className={busyOperation === "refresh" ? "spin" : ""} aria-hidden="true" />
              </button>
            </div>
          </header>

          <section className="repository-surface" aria-label={t("app.repositoryListAria")}>
            {repositories.length === 0 ? (
              <div className="dashboard-empty">
                <span className="empty-illustration" aria-hidden="true">
                  <FolderGit2 />
                </span>
                <h2>{t("app.emptyTitle")}</h2>
                <p>{t("app.emptyBody")}</p>
                <div className="dashboard-empty-actions">
                  <button type="button" className="button button--primary" onClick={pickRootFolder} disabled={!runningInTauri}>
                    <FolderOpen aria-hidden="true" />
                    {t("app.pickFolder")}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => openGitHubDialog("repositories")}
                    disabled={
                      !runningInTauri ||
                      githubSessionLoading ||
                      !githubSession ||
                      githubSession.installationCount === 0
                    }
                    title={
                      !githubSession
                        ? t("app.connectAccountFirst")
                        : githubSession.installationCount === 0
                          ? t("app.installAppFirst")
                          : undefined
                    }
                  >
                    <Link2 aria-hidden="true" />
                    {t("app.linkFolderToGitHub")}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => void startCloneFromGitHub()}
                    disabled={!runningInTauri || githubSessionLoading || !githubSession || cloneLoading}
                    title={githubSession ? undefined : t("app.connectAccountFirst")}
                  >
                    {cloneLoading ? <LoaderCircle className="spin" aria-hidden="true" /> : <CloudDownload aria-hidden="true" />}
                    {t("app.cloneFromGitHub")}
                  </button>
                </div>
              </div>
            ) : filteredRepositories.length === 0 ? (
              <div className="dashboard-empty dashboard-empty--compact">
                <Search aria-hidden="true" />
                <h2>{t("app.noResultsTitle")}</h2>
                <p>{t("app.noResultsBody")}</p>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  {t("app.clearFilters")}
                </button>
              </div>
            ) : (
              <RepositoryTable
                repositories={filteredRepositories}
                rootPath={rootPath}
                activePath={activePath}
                selectedPaths={selectedPaths}
                linkingPath={linkingPath}
                onActivate={setActivePath}
                onToggle={toggleRepository}
                onToggleAll={toggleAllVisible}
                onTogglePaths={togglePaths}
                onLinkGitHub={startLinkToGitHub}
              />
            )}
          </section>
        </main>

        {activeRepository && (
          <RepositoryInspector
            repository={activeRepository}
            changes={changes}
            diff={diff}
            loading={detailsLoading}
            error={detailsError}
            busy={isBusy}
            actionsEnabled={runningInTauri}
            onClose={() => setActivePath(null)}
            onReveal={reveal}
            onOpenBranches={setBranchTarget}
            onOpenTools={setToolsTarget}
            onFileOperation={(operation, paths) =>
              runFileOperation(operation, activeRepository.path, paths)
            }
          />
        )}
      </div>

      {selectedRepositories.length > 0 && (
        <div className="batch-bar" role="region" aria-label={t("app.batchActionsAria")}>
          <div className="selection-summary">
            <span className="selection-check"><CheckCircle2 aria-hidden="true" /></span>
            <div>
              <strong>{t("app.selectedCount", { count: selectedRepositories.length })}</strong>
              {hiddenSelectionCount > 0 && <small>{t("app.hiddenByFilter", { count: hiddenSelectionCount })}</small>}
            </div>
            <button type="button" onClick={() => setSelectedPaths(new Set())}>{t("app.deselect")}</button>
          </div>
          <div className="batch-actions">
            <button
              type="button"
              className="button button--batch"
              onClick={runFetch}
              disabled={isBusy || !runningInTauri || !selectedRepositories.some(hasRemote)}
              title={!runningInTauri ? t("app.desktopOnlyShort") : undefined}
            >
              {busyOperation === "fetch" ? <LoaderCircle className="spin" aria-hidden="true" /> : <CloudDownload aria-hidden="true" />}
              {t("app.fetch")}
            </button>
            <button
              type="button"
              className="button button--batch"
              onClick={() => prepareSync("pull")}
              disabled={isBusy || !runningInTauri}
              title={t(!runningInTauri ? "app.desktopOnlyShort" : "app.syncTitle")}
            >
              {preparingSync === "pull" ? <LoaderCircle className="spin" aria-hidden="true" /> : <ArrowDownToLine aria-hidden="true" />}
              {preparingSync === "pull" ? t("app.checking") : t("operation.pull")}
            </button>
            <button
              type="button"
              className="button button--batch"
              onClick={() => setCommitDialogOpen(true)}
              disabled={isBusy || !runningInTauri || !selectedRepositories.some(isDirty)}
              title={!runningInTauri ? t("app.desktopOnlyShort") : undefined}
            >
              <GitCommitHorizontal aria-hidden="true" />
              {t("operation.commit")}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => prepareSync("push")}
              disabled={isBusy || !runningInTauri}
              title={t(!runningInTauri ? "app.desktopOnlyShort" : "app.syncTitle")}
            >
              {preparingSync === "push" ? <LoaderCircle className="spin" aria-hidden="true" /> : <ArrowUpFromLine aria-hidden="true" />}
              {preparingSync === "push" ? t("app.checking") : t("operation.push")}
            </button>
          </div>
        </div>
      )}

      {commitDialogOpen && (
        <CommitDialog
          repositories={selectedRepositories}
          busy={busyOperation === "commit"}
          onClose={() => setCommitDialogOpen(false)}
          onConfirm={runCommit}
        />
      )}

      {syncDialog && (
        <SyncDialog
          mode={syncDialog}
          repositories={selectedRepositories}
          busy={busyOperation === syncDialog}
          onClose={() => setSyncDialog(null)}
          onConfirm={(repoPaths, strategy) => runSync(syncDialog, repoPaths, strategy)}
        />
      )}

      {githubDialogOpen && (
        <GitHubAccountDialog
          session={githubSession}
          localRepositories={repositories}
          nativeEnabled={runningInTauri}
          initialTab={githubDialogInitialTab}
          onSessionChange={setGitHubSession}
          onRepositoryLinked={repositoryLinked}
          onClose={() => setGitHubDialogOpen(false)}
        />
      )}

      {toolsTarget && (
        <RepositoryToolsDialog
          repository={toolsTarget}
          initialTab={toolsTarget.conflicted > 0 ? "conflicts" : "history"}
          nativeEnabled={runningInTauri}
          onClose={() => setToolsTarget(null)}
          onRepositoryChanged={toolsChanged}
        />
      )}

      {branchTarget && (
        <BranchDialog
          repository={branchTarget}
          nativeEnabled={runningInTauri}
          onClose={() => setBranchTarget(null)}
          onBranchChanged={branchChanged}
        />
      )}

      {cloneRepositories && (
        <GitHubCloneRepositoryDialog
          repositories={cloneRepositories}
          localRepositories={repositories}
          defaultParentPath={rootPath}
          nativeEnabled={runningInTauri}
          onClose={() => setCloneRepositories(null)}
          onCloned={repositoryCloned}
        />
      )}

      {linkTarget && githubRepositories && (
        <GitHubLinkRepositoryDialog
          repositories={githubRepositories}
          localRepositories={repositories}
          initialFolderPath={linkTarget.path}
          nativeEnabled={runningInTauri}
          onClose={closeLinkDialog}
          onFinish={closeLinkDialog}
          onLinked={repositoryLinked}
        />
      )}

      <OperationLog
        open={logOpen}
        entries={operationLog}
        onClose={() => setLogOpen(false)}
        onClear={() => setOperationLog([])}
      />

      {toast && (
        <div className={`toast toast--${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"} key={toast.id}>
          {toast.tone === "success" ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label={t("app.closeToast")}>
            <X aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
