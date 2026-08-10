import { AlertCircle, CheckCircle2, ClipboardList, Trash2, X } from "lucide-react";
import { useTranslation } from "../i18n/context";
import { operationLabel, outcomeMessage } from "../repositoryUtils";
import type { OperationLogEntry } from "../types";

interface OperationLogProps {
  open: boolean;
  entries: OperationLogEntry[];
  onClose: () => void;
  onClear: () => void;
}

/// The locale is a parameter: the interface must not speak German and
/// format the time the Italian way.
function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function OperationLog({ open, entries, onClose, onClear }: OperationLogProps) {
  const { t, locale } = useTranslation();

  return (
    <>
      {open && <button type="button" className="drawer-scrim" onClick={onClose} aria-label={t("activity.close")} />}
      <aside className={`operation-drawer ${open ? "is-open" : ""}`} aria-hidden={!open}>
        <header className="drawer-header">
          <div>
            <span className="eyebrow">{t("activity.session")}</span>
            <h2>{t("activity.title")}</h2>
          </div>
          <div className="drawer-header-actions">
            {entries.length > 0 && (
              <button type="button" className="icon-button icon-button--ghost" onClick={onClear} aria-label={t("activity.clear")}>
                <Trash2 aria-hidden="true" />
              </button>
            )}
            <button type="button" className="icon-button icon-button--ghost" onClick={onClose} aria-label={t("activity.close")}>
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="drawer-content">
          {entries.length === 0 ? (
            <div className="inspector-empty">
              <ClipboardList aria-hidden="true" />
              <h3>{t("activity.emptyTitle")}</h3>
              <p>{t("activity.emptyBody")}</p>
            </div>
          ) : (
            <ol className="operation-list">
              {entries.map((entry) => (
                <li className={entry.success ? "is-success" : "is-error"} key={entry.id}>
                  <div className="operation-icon" aria-hidden="true">
                    {entry.success ? <CheckCircle2 /> : <AlertCircle />}
                  </div>
                  <div className="operation-content">
                    <div className="operation-heading">
                      <strong>{t(operationLabel(entry.operation))}</strong>
                      <time dateTime={entry.timestamp}>
                        {formatTimestamp(entry.timestamp, locale)}
                      </time>
                    </div>
                    <span className="operation-repo">{entry.repoName || entry.repoPath}</span>
                    <p>
                      {outcomeMessage(entry, t) ||
                        t(entry.success ? "activity.succeeded" : "activity.failed")}
                    </p>
                    {entry.output && (
                      <details>
                        <summary>{t("activity.gitDetails")}</summary>
                        <pre>{entry.output}</pre>
                        {entry.outputTruncated && (
                          <p className="operation-output-note">{t("activity.outputTruncated")}</p>
                        )}
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </>
  );
}
