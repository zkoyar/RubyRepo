import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  GitBranch,
  GitFork,
  Globe2,
  Link2,
  LoaderCircle,
  Lock,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { chooseGitHubLinkFolder, githubLinkRepository } from "../api";
import { errorCode, errorMessage, ORIGIN_CONFLICT_CODE } from "../repositoryUtils";
import type {
  GitHubLinkRepositoryRequest,
  GitHubLinkRepositoryResult,
  GitHubRepository,
  RepositoryInfo,
} from "../types";
import { useTranslation } from "../i18n/context";

interface GitHubLinkRepositoryDialogProps {
  repositories: GitHubRepository[];
  localRepositories: RepositoryInfo[];
  initialRepositoryId?: number | null;
  initialFolderPath?: string;
  nativeEnabled: boolean;
  onClose: () => void;
  onFinish: () => void;
  onLinked: (result: GitHubLinkRepositoryResult) => void;
}

function remoteFullName(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const match = remoteUrl.trim().match(/github\.com[/:]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`.toLocaleLowerCase();
}


export function GitHubLinkRepositoryDialog({
  repositories,
  localRepositories,
  initialRepositoryId,
  initialFolderPath,
  nativeEnabled,
  onClose,
  onFinish,
  onLinked,
}: GitHubLinkRepositoryDialogProps) {
  const { t } = useTranslation();
  const writableRepositories = useMemo(
    () => repositories.filter((repository) => repository.canPush),
    [repositories],
  );
  const [folderPath, setFolderPath] = useState(initialFolderPath ?? "");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const initial = repositories.find(
      (repository) => repository.id === initialRepositoryId && repository.canPush,
    );
    return initial?.id ?? null;
  });
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkErrorCode, setLinkErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<GitHubLinkRepositoryResult | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const chooseFolderRef = useRef<HTMLButtonElement>(null);
  const successButtonRef = useRef<HTMLButtonElement>(null);
  const linkingRef = useRef(false);

  const selectedRepository = writableRepositories.find(
    (repository) => repository.id === selectedId,
  ) ?? null;

  const localPathsByRemote = useMemo(() => {
    const paths = new Map<string, string[]>();
    localRepositories.forEach((repository) => {
      const fullName = remoteFullName(repository.remoteUrl);
      if (!fullName) return;
      paths.set(fullName, [...(paths.get(fullName) ?? []), repository.path]);
    });
    return paths;
  }, [localRepositories]);

  const filteredRepositories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return writableRepositories;
    return writableRepositories.filter((repository) =>
      [repository.fullName, repository.owner, repository.defaultBranch]
        .some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
  }, [query, writableRepositories]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFrame = window.requestAnimationFrame(() => chooseFolderRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  useEffect(() => {
    if (!result) return;
    const focusFrame = window.requestAnimationFrame(() => successButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [result]);

  async function pickFolder() {
    if (!nativeEnabled || busy) return;
    setFolderError(null);
    try {
      const selected = await chooseGitHubLinkFolder(t("dialog.chooseLinkFolder"));
      if (selected) setFolderPath(selected);
    } catch (error) {
      setFolderError(errorMessage(error, t));
    }
  }

  async function linkRepository() {
    setAttempted(true);
    setLinkError(null);
    setLinkErrorCode(null);
    if (!nativeEnabled || !folderPath || !selectedRepository || linkingRef.current) return;

    const request: GitHubLinkRepositoryRequest = {
      folderPath,
      repositoryFullName: selectedRepository.fullName,
      cloneUrl: selectedRepository.cloneUrl,
    };

    linkingRef.current = true;
    setBusy(true);
    try {
      const nextResult = await githubLinkRepository(request);
      setResult(nextResult);
      onLinked(nextResult);
    } catch (error) {
      setLinkError(errorMessage(error, t));
      setLinkErrorCode(errorCode(error));
    } finally {
      linkingRef.current = false;
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="modal-backdrop github-link-backdrop">
        <section
          ref={dialogRef}
          className="modal github-link-dialog github-link-success"
          role="dialog"
          aria-modal="true"
          aria-labelledby="github-link-success-title"
        >
          <header className="modal-header">
            <div>
              <span className="eyebrow">{t("link.doneEyebrow")}</span>
              <h2 id="github-link-success-title">{t("link.doneTitle")}</h2>
            </div>
            <button type="button" className="icon-button icon-button--ghost" onClick={onClose} aria-label={t("link.closeSummary")}>
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="modal-body github-link-success-body">
            <span className="github-link-success-icon"><CheckCircle2 aria-hidden="true" /></span>
            <h3>{result.repository.name}</h3>
            <code>{result.repository.path}</code>
            <div className="github-link-result-badges">
              <span><GitFork aria-hidden="true" />{t(result.alreadyLinked ? "link.alreadyLinked" : "link.remoteLinked")}</span>
              {result.initialized && <span><FolderOpen aria-hidden="true" />{t("link.gitInitialised")}</span>}
            </div>
            <p>
              {t("link.remoteNowPointsTo", {
                remote: result.remoteName,
                repository: selectedRepository?.fullName ?? "",
              })}
            </p>
            <div className="github-link-no-push" role="status">
              <ShieldCheck aria-hidden="true" />
              <div>
                <strong>{t("link.noCommitOrPush")}</strong>
                <span>{t("link.doneBody")}</span>
              </div>
            </div>
          </div>
          <footer className="modal-footer">
            <span className="modal-summary">
              {t("link.remoteConfiguredAs", { name: result.remoteName })}
            </span>
            <div className="modal-actions">
              <button type="button" className="button button--secondary" onClick={onClose}>{t("link.stayOnGitHub")}</button>
              <button ref={successButtonRef} type="button" className="button button--primary" onClick={onFinish}>
                {t("link.showInDashboard")}
              </button>
            </div>
          </footer>
        </section>
      </div>
    );
  }

  const originConflict = linkErrorCode === ORIGIN_CONFLICT_CODE;
  const selectedLocalPaths = selectedRepository
    ? localPathsByRemote.get(selectedRepository.fullName.toLocaleLowerCase()) ?? []
    : [];

  return (
    <div className="modal-backdrop github-link-backdrop">
      <section
        ref={dialogRef}
        className="modal github-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-link-title"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{t("link.eyebrow")}</span>
            <h2 id="github-link-title">{t("link.title")}</h2>
            <p>{t("link.subtitle")}</p>
          </div>
          <button
            type="button"
            className="icon-button icon-button--ghost"
            onClick={onClose}
            disabled={busy}
            aria-label={t("link.close")}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="modal-body github-link-body">
          <section className="github-link-step" aria-labelledby="github-link-folder-heading">
            <div className="github-link-step-heading">
              <span>1</span>
              <div>
                <h3 id="github-link-folder-heading">{t("link.step1")}</h3>
                <p>{t("link.step1Hint")}</p>
              </div>
            </div>
            <button
              ref={chooseFolderRef}
              type="button"
              className={`github-link-folder-picker ${attempted && !folderPath ? "has-error" : ""}`}
              onClick={() => void pickFolder()}
              disabled={!nativeEnabled || busy}
            >
              <span><FolderOpen aria-hidden="true" /></span>
              <div>
                <small>{t("link.folder")}</small>
                <strong>{folderPath || t("clone.pickFolder")}</strong>
              </div>
              <span className="github-link-folder-action">{t("clone.browse")}</span>
            </button>
            {attempted && !folderPath && <small className="field-error">{t("link.pickFolderError")}</small>}
            {folderError && <small className="field-error" role="alert">{folderError}</small>}
          </section>

          <section className="github-link-step" aria-labelledby="github-link-remote-heading">
            <div className="github-link-step-heading">
              <span>2</span>
              <div>
                <h3 id="github-link-remote-heading">{t("clone.step2")}</h3>
                <p>{t("link.step2Hint")}</p>
              </div>
            </div>

            <label className="search-box github-link-search">
              <Search aria-hidden="true" />
              <span className="sr-only">{t("link.searchAria")}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={t("link.searchPlaceholder")}
                disabled={busy}
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label={t("common.clearSearch")}>
                  <X aria-hidden="true" />
                </button>
              )}
            </label>

            {filteredRepositories.length === 0 ? (
              <div className="github-link-repositories-empty">
                <AlertCircle aria-hidden="true" />
                <span>{writableRepositories.length === 0 ? t("link.noWritable") : t("clone.noMatch")}</span>
              </div>
            ) : (
              <div className="github-link-repository-list" role="radiogroup" aria-label={t("link.repositoryChoiceAria")}>
                {filteredRepositories.map((repository) => {
                  const localPaths = localPathsByRemote.get(repository.fullName.toLocaleLowerCase()) ?? [];
                  return (
                    <label className={selectedId === repository.id ? "is-selected" : ""} key={repository.id}>
                      <input
                        type="radio"
                        name="github-link-repository"
                        checked={selectedId === repository.id}
                        onChange={() => setSelectedId(repository.id)}
                        disabled={busy}
                      />
                      <span className="github-link-repo-icon"><GitFork aria-hidden="true" /></span>
                      <span className="github-link-repo-copy">
                        <strong>{repository.fullName}</strong>
                        <small><GitBranch aria-hidden="true" />{repository.defaultBranch}</small>
                      </span>
                      <span className="github-link-repo-badges">
                        <span>{repository.private ? <Lock aria-hidden="true" /> : <Globe2 aria-hidden="true" />}{t(repository.private ? "clone.private" : "clone.public")}</span>
                        {localPaths.length > 0 && <span className="is-local" title={localPaths.join("\n")}><CheckCircle2 aria-hidden="true" />{t("clone.alreadyLocal")}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {attempted && !selectedRepository && <small className="field-error">{t("link.pickRepositoryError")}</small>}
          </section>

          <aside className="github-link-summary" aria-label={t("link.summaryAria")}>
            <div>
              <Link2 aria-hidden="true" />
              <span>
                <small>{t("link.expected")}</small>
                <strong>{selectedRepository?.fullName ?? t("clone.pickRepository")}</strong>
              </span>
            </div>
            <dl>
              <div><dt>{t("clone.folder")}</dt><dd title={folderPath}>{folderPath || t("common.toChoose")}</dd></div>
              <div><dt>{t("clone.remote")}</dt><dd>origin</dd></div>
              <div><dt>{t("link.gitActions")}</dt><dd>{t("link.gitActionsValue")}</dd></div>
            </dl>
            {selectedLocalPaths.length > 0 && (
              <p className="github-link-local-warning">
                {t("link.alreadyInWorkspace")}
              </p>
            )}
            <div className="github-link-safety-note">
              <ShieldCheck aria-hidden="true" />
              <p><strong>{t("clone.noAutomation")}</strong> {t("link.noAutomationBody")}</p>
            </div>
          </aside>

          {linkError && (
            <div className="github-link-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <div>
                <strong>{originConflict ? t("link.originConflict") : t("link.failed")}</strong>
                <p>{linkError}</p>
                {originConflict && <span>{t("link.originConflictBody")}</span>}
              </div>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <span className="modal-summary">{t("link.footer")}</span>
          <div className="modal-actions">
            <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void linkRepository()}
              disabled={!nativeEnabled || !folderPath || !selectedRepository || busy}
            >
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
              {busy ? t("link.running") : t("link.confirm")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
