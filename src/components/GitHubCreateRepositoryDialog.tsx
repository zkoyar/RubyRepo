import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FolderPlus,
  Globe2,
  LoaderCircle,
  Lock,
  ShieldAlert,
  X,
} from "lucide-react";
import { openExternalUrl } from "../api";
import { errorMessage } from "../repositoryUtils";
import type {
  GitHubCreatedRepository,
  GitHubCreateRepositoryRequest,
} from "../types";
import { useTranslation } from "../i18n/context";
import type { MessageId } from "../i18n/dictionary";

export interface RepositoryCreationOutcome {
  repository: GitHubCreatedRepository;
  refreshWarning?: string;
}

interface GitHubCreateRepositoryDialogProps {
  ownerLogin: string;
  onClose: () => void;
  onCreate: (request: GitHubCreateRepositoryRequest) => Promise<RepositoryCreationOutcome>;
}

/// Why a repository name is not usable, or `null` if it is.
///
/// Returns identifiers: the function is pure and does not know the language.
function repositoryNameError(value: string): MessageId | null {
  const name = value.trim();
  if (!name) return "create.nameRequired";
  if (name.length > 100) return "create.nameTooLong";
  if (name === "." || name === "..") return "create.nameReserved";
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return "create.nameCharacters";
  }
  return null;
}

function isPermissionError(message: string): boolean {
  return /\b403\b|forbidden|administration|permission|permesso/i.test(message);
}

export function GitHubCreateRepositoryDialog({
  ownerLogin,
  onClose,
  onCreate,
}: GitHubCreateRepositoryDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [autoInit, setAutoInit] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<RepositoryCreationOutcome | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const nameError = repositoryNameError(name);
  const descriptionError = description.length > 350
    ? t("create.descriptionTooLong")
    : null;
  const valid = !nameError && !descriptionError;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
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
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("aria-hidden"));
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
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, onClose]);

  useEffect(() => {
    if (!created) return;
    const focusFrame = window.requestAnimationFrame(() => successCloseRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [created]);

  async function createRepository() {
    setAttempted(true);
    setCreateError(null);
    if (!valid || busy) {
      nameInputRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const outcome = await onCreate({
        name: name.trim(),
        description: description.trim() || null,
        private: isPrivate,
        autoInit,
      });
      setCreated(outcome);
    } catch (error) {
      setCreateError(errorMessage(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function openGitHub(url: string) {
    setOpenError(null);
    try {
      await openExternalUrl(url);
    } catch (error) {
      setOpenError(errorMessage(error, t));
    }
  }

  if (created) {
    const repository = created.repository;
    return (
      <div className="modal-backdrop create-repository-backdrop">
        <section
          ref={dialogRef}
          className="modal create-repository-dialog create-repository-success"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-repository-success-title"
        >
          <header className="modal-header">
            <div>
              <span className="eyebrow">{t("create.doneTitle")}</span>
              <h2 id="create-repository-success-title">{t("create.doneEyebrow")}</h2>
            </div>
            <button ref={successCloseRef} type="button" className="icon-button icon-button--ghost" onClick={onClose} aria-label={t("create.closeSummary")}>
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="modal-body create-repository-success-body">
            <span className="create-success-icon"><CheckCircle2 aria-hidden="true" /></span>
            <h3>{repository.fullName}</h3>
            <div className="create-success-badges">
              <span>{repository.private ? <Lock aria-hidden="true" /> : <Globe2 aria-hidden="true" />}{t(repository.private ? "create.private" : "create.public")}</span>
              <span><BookOpen aria-hidden="true" />{t(autoInit ? "create.withReadme" : "create.emptyRepository")}</span>
            </div>
            <p>
              {autoInit
                ? repository.defaultBranch
                  ? t("create.doneReadmeOnBranch", { branch: repository.defaultBranch })
                  : t("create.doneReadme")
                : t("create.doneEmpty")}
            </p>

            {created.refreshWarning && (
              <div className="create-refresh-warning" role="status">
                <AlertCircle aria-hidden="true" />
                <span>{created.refreshWarning}</span>
              </div>
            )}
            {openError && (
              <div className="inline-error" role="alert">
                <AlertCircle aria-hidden="true" />
                <div><strong>{t("create.openFailed")}</strong><p>{openError}</p></div>
              </div>
            )}
          </div>
          <footer className="modal-footer">
            <span className="modal-summary">{t("create.doneNoClone")}</span>
            <div className="modal-actions">
              <button type="button" className="button button--secondary" onClick={onClose}>{t("common.close")}</button>
              <button type="button" className="button button--primary" onClick={() => void openGitHub(repository.htmlUrl)}>
                <ExternalLink aria-hidden="true" /> {t("create.openOnGitHub")}
              </button>
            </div>
          </footer>
        </section>
      </div>
    );
  }

  const permissionFailure = createError ? isPermissionError(createError) : false;

  return (
    <div className="modal-backdrop create-repository-backdrop">
      <section
        ref={dialogRef}
        className="modal create-repository-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-repository-title"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">GitHub · @{ownerLogin}</span>
            <h2 id="create-repository-title">{t("create.title")}</h2>
            <p>{t("create.subtitle")}</p>
          </div>
          <button
            type="button"
            className="icon-button icon-button--ghost"
            onClick={onClose}
            disabled={busy}
            aria-label={t("create.close")}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <form className="modal-body create-repository-form" onSubmit={(event) => event.preventDefault()} noValidate>
          <div className="create-repository-fields">
            <label className="field">
              <span>{t("create.name")}<strong aria-hidden="true">*</strong></span>
              <div className={`repository-name-field ${attempted && nameError ? "has-error" : ""}`}>
                <span>{ownerLogin}/</span>
                <input
                  ref={nameInputRef}
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  onBlur={() => setAttempted(true)}
                  placeholder={t("create.namePlaceholder")}
                  maxLength={100}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  aria-invalid={Boolean(attempted && nameError)}
                  aria-describedby={attempted && nameError ? "repository-name-error" : undefined}
                />
              </div>
              {attempted && nameError && (
                <small className="field-error" id="repository-name-error">{t(nameError)}</small>
              )}
            </label>

            <label className="field">
              <span>{t("create.description")}<small>{t("common.optional")}</small></span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder={t("create.descriptionPlaceholder")}
                rows={3}
                maxLength={351}
                disabled={busy}
                aria-invalid={Boolean(descriptionError)}
                aria-describedby="repository-description-help"
              />
              <small className={descriptionError ? "field-error" : "field-help"} id="repository-description-help">
                {descriptionError || t("create.descriptionCount", { count: description.length })}
              </small>
            </label>

            <fieldset className="repository-visibility" disabled={busy}>
              <legend>{t("create.visibility")}</legend>
              <div>
                <label className={!isPrivate ? "is-selected" : ""}>
                  <input type="radio" name="visibility" checked={!isPrivate} onChange={() => setIsPrivate(false)} />
                  <Globe2 aria-hidden="true" />
                  <span><strong>{t("create.public")}</strong><small>{t("create.publicHint")}</small></span>
                </label>
                <label className={isPrivate ? "is-selected" : ""}>
                  <input type="radio" name="visibility" checked={isPrivate} onChange={() => setIsPrivate(true)} />
                  <Lock aria-hidden="true" />
                  <span><strong>{t("create.private")}</strong><small>{t("create.privateHint")}</small></span>
                </label>
              </div>
            </fieldset>

            <label className="toggle-row repository-readme-toggle">
              <input
                type="checkbox"
                checked={autoInit}
                onChange={(event) => setAutoInit(event.currentTarget.checked)}
                disabled={busy}
              />
              <BookOpen aria-hidden="true" />
              <span>
                <strong>{t("create.readme")}</strong>
                <small>{t("create.readmeHint")}</small>
              </span>
            </label>
          </div>

          <aside className="create-repository-summary" aria-label={t("create.summaryAria")}>
            <div className="create-summary-heading">
              <span><FolderPlus aria-hidden="true" /></span>
              <div><small>{t("create.willCreate")}</small><strong>{ownerLogin}/{name.trim() || t("create.namePlaceholder")}</strong></div>
            </div>
            <dl>
              <div><dt>{t("create.visibility")}</dt><dd>{t(isPrivate ? "create.private" : "create.public")}</dd></div>
              <div><dt>{t("create.content")}</dt><dd>{t(autoInit ? "create.withReadme" : "create.emptyRepository")}</dd></div>
              <div><dt>{t("create.description")}</dt><dd>{description.trim() ? t("create.included") : t("create.none")}</dd></div>
            </dl>
            <div className="create-permission-note">
              <ShieldAlert aria-hidden="true" />
              <div>
                <strong>{t("create.permissionNeeded")}</strong>
                <span>{t("create.adminRequirement")} <em>Administration: Read and write</em>.</span>
              </div>
            </div>
            <button type="button" className="github-new-fallback" onClick={() => void openGitHub("https://github.com/new")}>
              <ExternalLink aria-hidden="true" /> {t("create.openNewFallback")}
            </button>
          </aside>

          {createError && (
            <div className="create-repository-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <div>
                <strong>{t(permissionFailure ? "create.permissionDenied" : "create.failed")}</strong>
                <p>{createError}</p>
                {permissionFailure && <span>{t("create.permissionBody")}</span>}
              </div>
            </div>
          )}
          {openError && (
            <div className="create-repository-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <div><strong>{t("create.openFailed")}</strong><p>{openError}</p></div>
            </div>
          )}
        </form>

        <footer className="modal-footer">
          <span className="modal-summary">{t("create.footer")}</span>
          <div className="modal-actions">
            <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
            <button type="button" className="button button--primary" onClick={() => void createRepository()} disabled={!valid || busy}>
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <FolderPlus aria-hidden="true" />}
              {busy ? t("create.running") : t(isPrivate ? "create.confirmPrivate" : "create.confirmPublic")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
