import { useEffect, useState } from "react";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";
import { useTranslation } from "../i18n/context";

interface DiscardFilesDialogProps {
  repositoryName: string;
  paths: string[];
  containsUntracked: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function DiscardFilesDialog({
  repositoryName,
  paths,
  containsUntracked,
  busy,
  error,
  onClose,
  onConfirm,
}: DiscardFilesDialogProps) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState("");
  // The word to type is translated too: asking someone to type an English
  // word to protect their own files would be a barrier, not a safeguard.
  const confirmationWord = t("discard.confirmWord");
  const confirmed = confirmation.trim().toLocaleUpperCase() === confirmationWord;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop discard-backdrop">
      <section
        className="modal discard-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-dialog-title"
        aria-describedby="discard-dialog-description"
      >
        <header className="modal-header discard-dialog-header">
          <div className="discard-dialog-title-wrap">
            <span className="discard-warning-icon"><AlertTriangle aria-hidden="true" /></span>
            <div>
              <span className="eyebrow">{t("discard.irreversible")}</span>
              <h2 id="discard-dialog-title">
                {paths.length === 1
                  ? t("discard.titleOne")
                  : t("discard.titleMany", { count: paths.length })}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="icon-button icon-button--ghost"
            onClick={onClose}
            disabled={busy}
            aria-label={t("discard.closeAria")}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="modal-body discard-dialog-body">
          <div className="discard-danger-copy" id="discard-dialog-description">
            <strong>{t("discard.lead", { repository: repositoryName })}</strong>
            <p>{t(containsUntracked ? "discard.untracked" : "discard.tracked")}</p>
          </div>

          <div className="discard-file-list" aria-label={t("discard.fileListAria")}>
            {paths.slice(0, 8).map((path) => <code key={path}>{path}</code>)}
            {paths.length > 8 && <span>{t("discard.more", { count: paths.length - 8 })}</span>}
          </div>

          <label className="field discard-confirmation-field">
            <span>{t("discard.typeToConfirm", { word: confirmationWord })}</span>
            <input
              autoFocus
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              placeholder={confirmationWord}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>

          {error && (
            <div className="inline-error discard-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <div><strong>{t("common.operationFailed")}</strong><p>{error}</p></div>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <span className="modal-summary">{t("discard.noRecovery")}</span>
          <div className="modal-actions">
            <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
              {t("discard.keep")}
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={onConfirm}
              disabled={!confirmed || busy}
            >
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              {t(busy ? "discard.running" : "discard.confirm")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
