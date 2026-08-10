import { useEffect, useRef, useState, type RefObject } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FolderGit2,
  LoaderCircle,
  Trash2,
  X,
} from "lucide-react";
import { errorMessage } from "../repositoryUtils";
import type {
  GitHubDeleteRepositoryRequest,
  GitHubDeleteRepositoryResult,
  GitHubRepository,
} from "../types";
import { useTranslation } from "../i18n/context";

interface GitHubDeleteRepositoryDialogProps {
  repository: GitHubRepository;
  localPaths: string[];
  fallbackFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onDelete: (
    request: GitHubDeleteRepositoryRequest,
  ) => Promise<GitHubDeleteRepositoryResult>;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function GitHubDeleteRepositoryDialog({
  repository,
  localPaths,
  fallbackFocusRef,
  onClose,
  onDelete,
}: GitHubDeleteRepositoryDialogProps) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<GitHubDeleteRepositoryResult | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const confirmed = confirmation === repository.fullName;
  const hasLocalCopy = localPaths.length > 0;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => confirmationInputRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      // Reading the ref at cleanup time is the intent: the button that opened
      // the dialog may already have been unmounted, and that is exactly when the
      // fallback is needed.
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      else fallbackFocusRef.current?.focus();
    };
  }, [fallbackFocusRef]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!busy) onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      ).filter((element) => !element.hasAttribute("aria-hidden"));

      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
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
    if (!deleted) return;
    const focusFrame = window.requestAnimationFrame(() => successCloseRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [deleted]);

  async function deleteRepository() {
    if (!confirmed || busy || deleted) return;

    setBusy(true);
    setDeleteError(null);
    try {
      const result = await onDelete({
        repositoryId: repository.id,
        repositoryFullName: repository.fullName,
        confirmation,
      });
      if (!result.deleted) {
        throw new Error(t("delete.notConfirmed"));
      }
      setDeleted(result);
    } catch (error) {
      setDeleteError(errorMessage(error, t));
    } finally {
      setBusy(false);
    }
  }

  if (deleted) {
    return (
      <div className="modal-backdrop github-delete-backdrop">
        <section
          ref={dialogRef}
          className="modal github-delete-dialog github-delete-success"
          role="dialog"
          aria-modal="true"
          aria-labelledby="github-delete-success-title"
          tabIndex={-1}
        >
          <header className="modal-header">
            <div>
              <span className="eyebrow">{t("delete.doneEyebrow")}</span>
              <h2 id="github-delete-success-title">{t("delete.doneTitle")}</h2>
            </div>
            <button
              type="button"
              className="icon-button icon-button--ghost"
              onClick={onClose}
              aria-label={t("delete.closeResult")}
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div className="modal-body github-delete-success-body">
            <span className="github-delete-success-icon"><CheckCircle2 aria-hidden="true" /></span>
            <h3>{deleted.repositoryFullName}</h3>
            <p>{t("delete.doneBody")}</p>

            <div className={`github-delete-local-note ${hasLocalCopy ? "is-present" : ""}`} role="status">
              <FolderGit2 aria-hidden="true" />
              <div>
                <strong>
                  {hasLocalCopy
                    ? t("delete.localStillIntact")
                    : t("delete.noLocalChanged")}
                </strong>
                <span>
                  {hasLocalCopy
                    ? localPaths.length === 1
                      ? t("delete.localKeptOne", { path: localPaths[0] })
                      : t("delete.localKeptMany", { count: localPaths.length })
                    : t("delete.nothingTouched")}
                </span>
              </div>
            </div>
          </div>

          <footer className="modal-footer">
            <span className="modal-summary">{t("delete.accountStays")}</span>
            <div className="modal-actions">
              <button ref={successCloseRef} type="button" className="button button--primary" onClick={onClose}>
                {t("delete.backToRepositories")}
              </button>
            </div>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-backdrop github-delete-backdrop">
      <section
        ref={dialogRef}
        className="modal github-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="github-delete-title"
        aria-describedby="github-delete-description"
        tabIndex={-1}
      >
        <header className="modal-header github-delete-header">
          <div className="github-delete-heading">
            <span className="github-delete-warning-icon"><AlertTriangle aria-hidden="true" /></span>
            <div>
              <span className="eyebrow">{t("discard.irreversible")}</span>
              <h2 id="github-delete-title">{t("delete.title")}</h2>
            </div>
          </div>
          <button
            type="button"
            className="icon-button icon-button--ghost"
            onClick={onClose}
            disabled={busy}
            aria-label={t("delete.closeConfirm")}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <form
          id="github-delete-form"
          className="modal-body github-delete-body"
          onSubmit={(event) => {
            event.preventDefault();
            void deleteRepository();
          }}
        >
          <div className="github-delete-danger-copy" id="github-delete-description">
            <Trash2 aria-hidden="true" />
            <div>
              <strong>{repository.fullName}</strong>
              <p>{t("delete.dangerBody")}</p>
            </div>
          </div>

          <div className={`github-delete-local-note ${hasLocalCopy ? "is-present" : ""}`}>
            <FolderGit2 aria-hidden="true" />
            <div>
              <strong>
                {hasLocalCopy
                  ? t("delete.localIntact")
                  : t("delete.localFoldersIntact")}
              </strong>
              <span>
                {hasLocalCopy
                  ? localPaths.length === 1
                    ? localPaths[0]
                    : t("delete.localFoundMany", { count: localPaths.length })
                  : t("delete.noLocalWillChange")}
              </span>
            </div>
          </div>

          <label className="field github-delete-confirmation-field" htmlFor="github-delete-confirmation">
            <span>
              {t("delete.confirmPrompt")} <code>{repository.fullName}</code>
            </span>
            <input
              ref={confirmationInputRef}
              id="github-delete-confirmation"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.currentTarget.value);
                if (deleteError) setDeleteError(null);
              }}
              placeholder={repository.fullName}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              aria-describedby="github-delete-confirmation-help"
            />
            <small id="github-delete-confirmation-help">
              {t("delete.confirmationHelp")}
            </small>
          </label>

          {deleteError && (
            <div className="github-delete-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <div>
                <strong>{t("delete.failed")}</strong>
                <p>{deleteError}</p>
              </div>
            </div>
          )}
        </form>

        <footer className="modal-footer">
          <span className="modal-summary">{t("delete.noFolderDeleted")}</span>
          <div className="modal-actions">
            <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form="github-delete-form"
              className="button button--danger"
              disabled={!confirmed || busy}
            >
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              {busy ? t("delete.running") : t("delete.confirm")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
