import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  GitBranch,
  GitFork,
  Globe2,
  LoaderCircle,
  Lock,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { chooseGitHubCloneFolder, githubCloneRepository } from "../api";
import { useTranslation } from "../i18n/context";
import {
  cloneFolderNameProblem,
  defaultCloneFolderName,
  errorMessage,
} from "../repositoryUtils";
import type {
  GitHubCloneRepositoryRequest,
  GitHubCloneRepositoryResult,
  GitHubRepository,
  RepositoryInfo,
} from "../types";

interface GitHubCloneRepositoryDialogProps {
  repositories: GitHubRepository[];
  localRepositories: RepositoryInfo[];
  /// The workspace root: it is already a folder picked in the native dialog, so
  /// the common case does not require choosing another.
  defaultParentPath: string;
  nativeEnabled: boolean;
  onClose: () => void;
  onCloned: (result: GitHubCloneRepositoryResult) => void;
}

function remoteFullName(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const match = remoteUrl.trim().match(/github\.com[/:]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`.toLocaleLowerCase();
}

export function GitHubCloneRepositoryDialog({
  repositories,
  localRepositories,
  defaultParentPath,
  nativeEnabled,
  onClose,
  onCloned,
}: GitHubCloneRepositoryDialogProps) {
  const { t } = useTranslation();
  const [parentPath, setParentPath] = useState(defaultParentPath);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [folderName, setFolderName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [result, setResult] = useState<GitHubCloneRepositoryResult | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const chooseFolderRef = useRef<HTMLButtonElement>(null);
  const successButtonRef = useRef<HTMLButtonElement>(null);
  const cloningRef = useRef(false);

  // Cloning requires read access: unlike linking there is no filtering by push
  // permission, otherwise everything you contribute to without owning would
  // disappear.
  const selectedRepository =
    repositories.find((repository) => repository.id === selectedId) ?? null;

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
    if (!normalized) return repositories;
    return repositories.filter((repository) =>
      [repository.fullName, repository.owner, repository.defaultBranch].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [query, repositories]);

  const suggestedName = selectedRepository
    ? defaultCloneFolderName(selectedRepository.fullName)
    : "";
  const nameProblem = cloneFolderNameProblem(folderName);
  const alreadyLocal =
    selectedRepository !== null &&
    (localPathsByRemote.get(selectedRepository.fullName.toLocaleLowerCase()) ?? []).length > 0;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      const selected = await chooseGitHubCloneFolder(t("dialog.chooseCloneParent"));
      if (selected) setParentPath(selected);
    } catch (error) {
      setFolderError(errorMessage(error, t));
    }
  }

  async function cloneRepository() {
    setAttempted(true);
    setCloneError(null);
    if (!nativeEnabled || !parentPath || !selectedRepository || nameProblem) return;
    if (cloningRef.current) return;

    const request: GitHubCloneRepositoryRequest = {
      parentPath,
      repositoryFullName: selectedRepository.fullName,
      cloneUrl: selectedRepository.cloneUrl,
      folderName: folderName.trim() || undefined,
    };

    cloningRef.current = true;
    setBusy(true);
    try {
      const nextResult = await githubCloneRepository(request);
      setResult(nextResult);
      onCloned(nextResult);
    } catch (error) {
      setCloneError(errorMessage(error, t));
    } finally {
      cloningRef.current = false;
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="modal-backdrop" role="presentation">
        <section
          className="modal github-link-dialog github-link-success"
          role="dialog"
          aria-modal="true"
          aria-label={t("clone.doneAria")}
          ref={dialogRef}
        >
          <header className="modal-header">
            <div>
              <small>{t("clone.doneEyebrow")}</small>
              <h2>{t("clone.doneTitle")}</h2>
            </div>
          </header>
          <div className="modal-body github-link-success-body">
            <span className="github-link-success-icon">
              <CheckCircle2 aria-hidden="true" />
            </span>
            <strong>{result.repository.name}</strong>
            <code>{result.folderPath}</code>
            <p>
              {t("clone.doneBody", {
                remote: result.remoteName,
                url: result.repository.remoteUrl ?? result.remoteUrl,
              })}
            </p>
          </div>
          <footer className="modal-footer">
            <span>{t("clone.doneFooter")}</span>
            <button
              type="button"
              className="button button--primary"
              onClick={onClose}
              ref={successButtonRef}
            >
              {t("common.close")}
            </button>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal github-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("clone.title")}
        ref={dialogRef}
      >
        <header className="modal-header">
          <div>
            <small>{t("clone.eyebrow")}</small>
            <h2>{t("clone.title")}</h2>
            <p>{t("clone.subtitle")}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")} disabled={busy}>
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="modal-body github-link-body">
          <section className="github-link-step">
            <div className="github-link-step-heading">
              <span>1</span>
              <div>
                <h3>{t("clone.step1")}</h3>
                <p>{t("clone.step1Hint")}</p>
              </div>
            </div>
            <button
              ref={chooseFolderRef}
              type="button"
              className={`github-link-folder-picker ${attempted && !parentPath ? "has-error" : ""}`}
              onClick={() => void pickFolder()}
              disabled={!nativeEnabled || busy}
            >
              <span><FolderOpen aria-hidden="true" /></span>
              <div>
                <small>{t("clone.parentFolder")}</small>
                <strong>{parentPath || t("clone.pickFolder")}</strong>
              </div>
              <span className="github-link-folder-action">{t("clone.browse")}</span>
            </button>
            {attempted && !parentPath && (
              <small className="field-error">{t("clone.pickFolderError")}</small>
            )}
            {folderError && <small className="field-error">{folderError}</small>}

            <label className="github-link-name-field">
              <span>{t("clone.folderName")}</span>
              <input
                type="text"
                value={folderName}
                placeholder={suggestedName || t("clone.folderNameDefault")}
                onChange={(event) => setFolderName(event.currentTarget.value)}
                disabled={busy}
                aria-label={t("clone.folderNameAria")}
              />
            </label>
            {nameProblem && <small className="field-error">{nameProblem}</small>}
          </section>

          <section className="github-link-step">
            <div className="github-link-step-heading">
              <span>2</span>
              <div>
                <h3>{t("clone.step2")}</h3>
                <p>{t("clone.step2Hint")}</p>
              </div>
            </div>
            <label className="search-box github-link-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder={t("clone.searchPlaceholder")}
                onChange={(event) => setQuery(event.currentTarget.value)}
                disabled={busy}
                aria-label={t("clone.searchAria")}
              />
            </label>

            {filteredRepositories.length === 0 ? (
              <div className="github-link-repositories-empty">
                <AlertCircle aria-hidden="true" />
                <span>
                  {repositories.length === 0
                    ? t("clone.noneAvailable")
                    : t("clone.noMatch")}
                </span>
              </div>
            ) : (
              <div
                className="github-link-repository-list"
                role="radiogroup"
                aria-label={t("clone.listAria")}
              >
                {filteredRepositories.map((repository) => {
                  const localPaths =
                    localPathsByRemote.get(repository.fullName.toLocaleLowerCase()) ?? [];
                  return (
                    <label
                      className={selectedId === repository.id ? "is-selected" : ""}
                      key={repository.id}
                    >
                      <input
                        type="radio"
                        name="github-clone-repository"
                        checked={selectedId === repository.id}
                        onChange={() => setSelectedId(repository.id)}
                        disabled={busy}
                      />
                      <span className="github-link-repo-icon">
                        <GitFork aria-hidden="true" />
                      </span>
                      <span className="github-link-repo-copy">
                        <strong>{repository.fullName}</strong>
                        <small>
                          <GitBranch aria-hidden="true" />
                          {repository.defaultBranch}
                        </small>
                      </span>
                      <span className="github-link-repo-badges">
                        <span>
                          {repository.private ? (
                            <Lock aria-hidden="true" />
                          ) : (
                            <Globe2 aria-hidden="true" />
                          )}
                          {t(repository.private ? "clone.private" : "clone.public")}
                        </span>
                        {localPaths.length > 0 && (
                          <span className="is-local" title={localPaths.join("\n")}>
                            <CheckCircle2 aria-hidden="true" />
                            {t("clone.alreadyLocal")}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {attempted && !selectedRepository && (
              <small className="field-error">{t("clone.pickRepositoryError")}</small>
            )}
          </section>

          <aside className="github-link-summary" aria-label={t("clone.summaryAria")}>
            <div>
              <Download aria-hidden="true" />
              <span>
                <small>{t("clone.expected")}</small>
                <strong>{selectedRepository?.fullName ?? t("clone.pickRepository")}</strong>
              </span>
            </div>
            <dl>
              <div>
                <dt>{t("clone.destination")}</dt>
                <dd title={parentPath}>{parentPath || t("common.toChoose")}</dd>
              </div>
              <div>
                <dt>{t("clone.folder")}</dt>
                <dd>{folderName.trim() || suggestedName || "—"}</dd>
              </div>
              <div>
                <dt>{t("clone.remote")}</dt>
                <dd>origin</dd>
              </div>
            </dl>
            <div className="github-link-safety-note">
              <ShieldCheck aria-hidden="true" />
              <p>
                <strong>{t("clone.noAutomation")}</strong> {t("clone.noAutomationBody")}
              </p>
            </div>
            {alreadyLocal && (
              <p className="github-link-local-warning">
                {t("clone.secondCopy")}
              </p>
            )}
            {cloneError && <p className="field-error">{cloneError}</p>}
          </aside>
        </div>

        <footer className="modal-footer">
          <span>{t("clone.footer")}</span>
          <div className="modal-actions">
            <button type="button" className="button" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void cloneRepository()}
              disabled={!nativeEnabled || !parentPath || !selectedRepository || busy || Boolean(nameProblem)}
            >
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              {busy ? t("clone.running") : t("clone.confirm")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
