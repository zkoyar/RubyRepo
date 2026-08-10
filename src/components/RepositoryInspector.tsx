import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  File,
  FileDiff,
  Files,
  FolderOpen,
  GitBranch,
  Wrench,
  GitCommitHorizontal,
  Info,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useTranslation } from "../i18n/context";
import type { MessageId } from "../i18n/dictionary";
import { displayBranch } from "../repositoryUtils";
import type {
  FileChange,
  FileOperation,
  RepositoryDiff,
  RepositoryInfo,
} from "../types";
import { DiscardFilesDialog } from "./DiscardFilesDialog";
import { StatusBadges } from "./StatusBadges";

type InspectorTab = "changes" | "diff" | "details";
type FileGroupId = "staged" | "unstaged" | "untracked" | "conflict";

interface RepositoryInspectorProps {
  repository: RepositoryInfo | null;
  changes: FileChange[];
  diff: RepositoryDiff | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  actionsEnabled: boolean;
  onClose: () => void;
  onReveal: (repoPath: string) => void;
  onOpenBranches: (repository: RepositoryInfo) => void;
  onOpenTools: (repository: RepositoryInfo) => void;
  onFileOperation: (operation: FileOperation, paths: string[]) => Promise<boolean>;
}

interface FileGroup {
  id: FileGroupId;
  label: MessageId;
  className: string;
  selectable: boolean;
  files: FileChange[];
}

interface PendingAction {
  groupId: FileGroupId;
  operation: FileOperation;
}

interface DiscardRequest {
  groupId: "unstaged" | "untracked";
  paths: string[];
}

function emptySelections(): Record<FileGroupId, Set<string>> {
  return {
    staged: new Set(),
    unstaged: new Set(),
    untracked: new Set(),
    conflict: new Set(),
  };
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
    />
  );
}

function fileStatus(file: FileChange): MessageId {
  if (file.conflicted) return "file.conflict";
  if (file.untracked) return "file.new";
  if (file.indexStatus === "D" || file.worktreeStatus === "D") return "file.deleted";
  if (file.indexStatus === "A") return "file.added";
  if (file.indexStatus === "R" || file.worktreeStatus === "R") return "file.renamed";
  return "file.modified";
}

/// `t` arrives as a prop because this lives outside the component that holds
/// the hook: a second `useTranslation` here would work, but passing it keeps
/// the helper a plain function of its inputs.
function DiffCode({ content, t }: { content: string; t: (id: MessageId) => string }) {
  if (!content.trim()) {
    return (
      <div className="inspector-empty inspector-empty--compact">
        <FileDiff aria-hidden="true" />
        <p>{t("inspector.noDiff")}</p>
      </div>
    );
  }

  return (
    <pre className="diff-code" tabIndex={0} aria-label={t("inspector.diffPreview")}>
      <code>
        {content.split("\n").map((line, index) => {
          let className = "diff-line";
          if (line.startsWith("@@")) className += " diff-line--hunk";
          else if (line.startsWith("+") && !line.startsWith("+++")) className += " diff-line--add";
          else if (line.startsWith("-") && !line.startsWith("---")) className += " diff-line--remove";
          else if (
            line.startsWith("diff ") ||
            line.startsWith("index ") ||
            line.startsWith("+++") ||
            line.startsWith("---")
          ) {
            className += " diff-line--meta";
          }

          return (
            <span className={className} key={`${index}-${line}`}>
              {line || " "}
              {"\n"}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export function RepositoryInspector({
  repository,
  changes,
  diff,
  loading,
  error,
  busy,
  actionsEnabled,
  onClose,
  onReveal,
  onOpenBranches,
  onOpenTools,
  onFileOperation,
}: RepositoryInspectorProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<InspectorTab>("changes");
  const [diffSection, setDiffSection] = useState<"staged" | "unstaged">("unstaged");
  const [selections, setSelections] = useState<Record<FileGroupId, Set<string>>>(emptySelections);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [discardRequest, setDiscardRequest] = useState<DiscardRequest | null>(null);

  const groups = useMemo<FileGroup[]>(() => {
    const allGroups: FileGroup[] = [
      {
        id: "staged",
        label: "inspector.group.staged",
        className: "file-status--staged",
        selectable: true,
        files: changes.filter((file) => file.staged && !file.conflicted),
      },
      {
        id: "unstaged",
        label: "inspector.group.unstaged",
        className: "file-status--unstaged",
        selectable: true,
        files: changes.filter((file) => file.unstaged && !file.conflicted && !file.untracked),
      },
      {
        id: "untracked",
        label: "inspector.group.untracked",
        className: "file-status--untracked",
        selectable: true,
        files: changes.filter((file) => file.untracked && !file.conflicted),
      },
      {
        id: "conflict",
        label: "inspector.group.conflict",
        className: "file-status--conflict",
        selectable: false,
        files: changes.filter((file) => file.conflicted),
      },
    ];
    return allGroups.filter((group) => group.files.length > 0);
  }, [changes]);

  // Resetting the local state when the selected repository changes.
  // React would suggest remounting the component with a `key`, but that would
  // require changing the parent: to be revisited together, not hidden.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab("changes");
    setDiffSection("unstaged");
    setSelections(emptySelections());
    setPendingAction(null);
    setActionError(null);
    setDiscardRequest(null);
  }, [repository?.path]);

  // Pruning the selection when files disappear from the Git state: it depends
  // on the groups just computed, so it is not derivable during the render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelections((current) => {
      const next = emptySelections();
      groups.forEach((group) => {
        const available = new Set(group.files.map((file) => file.path));
        next[group.id] = new Set([...current[group.id]].filter((path) => available.has(path)));
      });
      return next;
    });
  }, [groups]);

  function toggleFile(groupId: FileGroupId, path: string) {
    setActionError(null);
    setSelections((current) => {
      const groupSelection = new Set(current[groupId]);
      if (groupSelection.has(path)) groupSelection.delete(path);
      else groupSelection.add(path);
      return { ...current, [groupId]: groupSelection };
    });
  }

  function toggleGroup(group: FileGroup) {
    setActionError(null);
    setSelections((current) => {
      const allSelected = group.files.every((file) => current[group.id].has(file.path));
      return {
        ...current,
        [group.id]: allSelected ? new Set<string>() : new Set(group.files.map((file) => file.path)),
      };
    });
  }

  async function executeFileOperation(
    groupId: FileGroupId,
    operation: FileOperation,
    explicitPaths?: string[],
  ): Promise<boolean> {
    const paths = explicitPaths ?? [...selections[groupId]];
    if (paths.length === 0 || busy || !actionsEnabled) return false;

    setPendingAction({ groupId, operation });
    setActionError(null);
    try {
      const success = await onFileOperation(operation, paths);
      if (success) {
        setSelections((current) => ({ ...current, [groupId]: new Set<string>() }));
      } else {
        setActionError(t("inspector.operationFailed"));
      }
      return success;
    } finally {
      setPendingAction(null);
    }
  }

  function requestDiscard(groupId: "unstaged" | "untracked") {
    const paths = [...selections[groupId]];
    if (paths.length === 0 || busy || !actionsEnabled) return;
    setActionError(null);
    setDiscardRequest({ groupId, paths });
  }

  async function confirmDiscard() {
    if (!discardRequest) return;
    const success = await executeFileOperation(
      discardRequest.groupId,
      "discard",
      discardRequest.paths,
    );
    if (success) setDiscardRequest(null);
  }

  if (!repository) {
    return (
      <aside className="repository-inspector repository-inspector--empty">
        <div className="inspector-empty">
          <Files aria-hidden="true" />
          <h2>{t("inspector.emptyTitle")}</h2>
          <p>{t("inspector.emptyBody")}</p>
        </div>
      </aside>
    );
  }

  return (
    <>
      <aside className="repository-inspector" aria-label={t("inspector.detailsAria", { name: repository.name })}>
        <header className="inspector-header">
          <div className="inspector-title-wrap">
            <div className="inspector-title-line">
              <h2>{repository.name}</h2>
              <button
                type="button"
                className="icon-button icon-button--ghost inspector-close"
                onClick={onClose}
                aria-label={t("inspector.close")}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <p title={repository.path}>{repository.path}</p>
            <StatusBadges repository={repository} />
          </div>
          <div className="inspector-header-actions">
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => onOpenBranches(repository)}
            >
              <GitBranch aria-hidden="true" />
              {t("inspector.branch")}
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => onOpenTools(repository)}
            >
              <Wrench aria-hidden="true" />
              {t("inspector.tools")}
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => onReveal(repository.path)}
            >
              <FolderOpen aria-hidden="true" />
              {t("inspector.reveal")}
            </button>
          </div>
        </header>

        <div className="inspector-tabs" role="tablist" aria-label={t("inspector.aria")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "changes"}
            className={tab === "changes" ? "is-active" : ""}
            onClick={() => setTab("changes")}
          >
            <Files aria-hidden="true" />
            {t("inspector.tab.changes")}
            {repository.changedFiles > 0 && <span className="tab-count">{repository.changedFiles}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "diff"}
            className={tab === "diff" ? "is-active" : ""}
            onClick={() => setTab("diff")}
          >
            <FileDiff aria-hidden="true" />
            {t("inspector.tab.diff")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "details"}
            className={tab === "details" ? "is-active" : ""}
            onClick={() => setTab("details")}
          >
            <Info aria-hidden="true" />
            {t("inspector.tab.details")}
          </button>
        </div>

        <div className="inspector-content">
          {loading && (
            <div className="loading-state" role="status">
              <LoaderCircle className="spin" aria-hidden="true" />
              {t("inspector.loadingRepository")}
            </div>
          )}

          {!loading && error && (
            <div className="inline-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <div>
                <strong>{t("inspector.readFailed")}</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && tab === "changes" && (
            <div className="changes-panel">
              {actionError && !discardRequest && (
                <div className="file-action-error" role="alert">
                  <AlertCircle aria-hidden="true" />
                  <span>{actionError}</span>
                  <button type="button" onClick={() => setActionError(null)} aria-label={t("inspector.closeError")}>
                    <X aria-hidden="true" />
                  </button>
                </div>
              )}

              {groups.length === 0 ? (
                <div className="inspector-empty inspector-empty--compact">
                  <span className="clean-check" aria-hidden="true">✓</span>
                  <h3>{t("inspector.cleanTree")}</h3>
                  <p>{t("inspector.noChangedFiles")}</p>
                </div>
              ) : (
                groups.map((group) => {
                  const selectedCount = selections[group.id].size;
                  const allSelected = group.files.length > 0 && selectedCount === group.files.length;
                  const primaryOperation: FileOperation = group.id === "staged" ? "unstage" : "stage";
                  const primaryLabel = t(group.id === "staged" ? "inspector.unstageSelected" : "inspector.stageSelected");
                  const primaryPending =
                    pendingAction?.groupId === group.id && pendingAction.operation === primaryOperation;
                  const discardGroup =
                    group.id === "unstaged" || group.id === "untracked" ? group.id : null;

                  return (
                    <section className={`file-group file-group--${group.id}`} key={group.id}>
                      <header className="file-group-header">
                        <div className="file-group-title">
                          {group.selectable ? (
                            <SelectionCheckbox
                              checked={allSelected}
                              indeterminate={selectedCount > 0 && !allSelected}
                              disabled={busy}
                              label={t("inspector.selectAllIn", { group: t(group.label) })}
                              onChange={() => toggleGroup(group)}
                            />
                          ) : (
                            <span
                              className="conflict-lock"
                              title={t("inspector.conflictsNotActionable")}
                            >
                              <LockKeyhole aria-hidden="true" />
                            </span>
                          )}
                          <h3>{t(group.label)}<span>{group.files.length}</span></h3>
                          {group.selectable && selectedCount > 0 && (
                            <span className="file-selection-count">
                              {t("inspector.selectedCount", { count: selectedCount })}
                            </span>
                          )}
                        </div>

                        {group.selectable ? (
                          <div className="file-group-actions">
                            <button
                              type="button"
                              className="file-action-button"
                              onClick={() => void executeFileOperation(group.id, primaryOperation)}
                              disabled={selectedCount === 0 || busy || !actionsEnabled}
                              title={!actionsEnabled ? t("app.desktopOnlyShort") : primaryLabel}
                            >
                              {primaryPending ? (
                                <LoaderCircle className="spin" aria-hidden="true" />
                              ) : group.id === "staged" ? (
                                <Minus aria-hidden="true" />
                              ) : (
                                <Plus aria-hidden="true" />
                              )}
                              <span>{primaryLabel}</span>
                            </button>
                            {discardGroup && (
                              <button
                                type="button"
                                className="file-action-button file-action-button--danger"
                                onClick={() => requestDiscard(discardGroup)}
                                disabled={selectedCount === 0 || busy || !actionsEnabled}
                                title={!actionsEnabled ? t("app.desktopOnlyShort") : t("inspector.discardSelected")}
                              >
                                <RotateCcw aria-hidden="true" />
                                <span>{t("common.cancel")}</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="conflict-help">{t("inspector.resolveManually")}</span>
                        )}
                      </header>
                      <ul>
                        {group.files.map((file) => {
                          const selected = selections[group.id].has(file.path);
                          return (
                            <li className={selected ? "is-selected" : ""} key={`${group.id}-${file.path}`}>
                              {group.selectable ? (
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={busy}
                                  onChange={() => toggleFile(group.id, file.path)}
                                  aria-label={t("inspector.selectFileAria", { file: file.path, group: group.label })}
                                />
                              ) : (
                                <span className="file-checkbox-placeholder" aria-hidden="true" />
                              )}
                              <File aria-hidden="true" />
                              <span className="file-path" title={file.path}>{file.path}</span>
                              <span className={`file-status ${group.className}`}>{t(fileStatus(file))}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })
              )}
            </div>
          )}

          {!loading && !error && tab === "diff" && (
            <div className="diff-panel">
              <div className="segmented-control" aria-label={t("inspector.diffType")}>
                <button
                  type="button"
                  className={diffSection === "unstaged" ? "is-active" : ""}
                  onClick={() => setDiffSection("unstaged")}
                >
                  {t("inspector.diffUnstaged")}
                </button>
                <button
                  type="button"
                  className={diffSection === "staged" ? "is-active" : ""}
                  onClick={() => setDiffSection("staged")}
                >
                  {t("inspector.diffStaged")}
                </button>
              </div>
              {diff?.truncated && (
                <div className="diff-warning" role="status">
                  <AlertCircle aria-hidden="true" />
                  {t("inspector.diffTruncated")}
                </div>
              )}
              <DiffCode t={t} content={diff?.[diffSection] ?? ""} />
            </div>
          )}

          {!loading && !error && tab === "details" && (
            <div className="details-panel">
              <dl>
                <div>
                  <dt>{t("inspector.branch")}</dt>
                  <dd>{displayBranch(repository)}</dd>
                </div>
                <div>
                  <dt>HEAD</dt>
                  <dd className="monospace">{repository.headShort || "—"}</dd>
                </div>
                <div>
                  <dt>{t("inspector.upstream")}</dt>
                  <dd>{repository.upstream || t("inspector.notConfigured")}</dd>
                </div>
                <div>
                  <dt>{t("inspector.remote")}</dt>
                  <dd>{repository.remoteName || t("inspector.noRemote")}</dd>
                </div>
                <div className="details-wide">
                  <dt>{t("inspector.remoteUrl")}</dt>
                  <dd className="details-url">{repository.remoteUrl || "—"}</dd>
                </div>
                <div className="details-wide">
                  <dt>{t("inspector.lastCommit")}</dt>
                  <dd>
                    <GitCommitHorizontal aria-hidden="true" />
                    {repository.lastCommit || t("inspector.unavailable")}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="button button--secondary details-open-button"
                onClick={() => onReveal(repository.path)}
              >
                <ExternalLink aria-hidden="true" />
                {t("inspector.revealInFileManager")}
              </button>
            </div>
          )}
        </div>
      </aside>

      {discardRequest && (
        <DiscardFilesDialog
          repositoryName={repository.name}
          paths={discardRequest.paths}
          containsUntracked={discardRequest.groupId === "untracked"}
          busy={pendingAction?.operation === "discard"}
          error={actionError}
          onClose={() => {
            if (!pendingAction) {
              setDiscardRequest(null);
              setActionError(null);
            }
          }}
          onConfirm={() => void confirmDiscard()}
        />
      )}
    </>
  );
}
