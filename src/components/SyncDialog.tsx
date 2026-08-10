import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  GitBranch,
  LoaderCircle,
  X,
} from "lucide-react";
import { useTranslation } from "../i18n/context";
import { syncBlockedReason } from "../repositoryUtils";
import type { MessageId } from "../i18n/dictionary";
import type { PullStrategy, RepositoryInfo } from "../types";

type SyncMode = "pull" | "push";

interface SyncDialogProps {
  mode: SyncMode;
  repositories: RepositoryInfo[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (repoPaths: string[], strategy: PullStrategy) => void;
}



export function SyncDialog({ mode, repositories, busy, onClose, onConfirm }: SyncDialogProps) {
  // Fast-forward stays the default: it is the only strategy that cannot produce
  // a conflict the user was not expecting.
  const { t } = useTranslation();
  const [strategy, setStrategy] = useState<PullStrategy>("fastForward");

  function blockedReasonText(repository: RepositoryInfo) {
    const reason = syncBlockedReason(repository, mode, strategy);
    return reason ? t(reason) : null;
  }
  const eligible = useMemo(
    () => repositories.filter((repository) => !syncBlockedReason(repository, mode, strategy)),
    [mode, repositories, strategy],
  );
  const blocked = useMemo(
    () => repositories.filter((repository) => syncBlockedReason(repository, mode, strategy)),
    [mode, repositories, strategy],
  );
  const isPush = mode === "push";
  const firstPushCount = isPush
    ? eligible.filter((repository) => !repository.upstream).length
    : 0;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop">
      <section
        className="modal sync-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-dialog-title"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{t("sync.eyebrow")}</span>
            <h2 id="sync-dialog-title">{t(isPush ? "sync.pushTitle" : "sync.pullTitle")}</h2>
            <p>
              {t(isPush ? "sync.pushLead" : "sync.pullLead")}
            </p>
          </div>
          <button
            type="button"
            className="icon-button icon-button--ghost"
            onClick={onClose}
            disabled={busy}
            aria-label={t("common.close")}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="modal-body sync-body">
          {!isPush && (
            <fieldset className="sync-strategy">
              <legend>{t("sync.strategy")}</legend>
              {(
                [
                  ["fastForward", "sync.strategy.fastForward", "sync.strategy.fastForwardHint"],
                  ["merge", "sync.strategy.merge", "sync.strategy.mergeHint"],
                  ["rebase", "sync.strategy.rebase", "sync.strategy.rebaseHint"],
                ] as [PullStrategy, MessageId, MessageId][]
              ).map(([value, label, hint]) => (
                <label key={value} className={strategy === value ? "is-selected" : ""}>
                  <input
                    type="radio"
                    name="pull-strategy"
                    checked={strategy === value}
                    onChange={() => setStrategy(value)}
                    disabled={busy}
                  />
                  <span>
                    <strong>{t(label)}</strong>
                    <small>{t(hint)}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {eligible.length > 0 && (
            <section className="preflight-section">
              <h3>
                <CheckCircle2 aria-hidden="true" />
                {t("sync.ready", { count: eligible.length })}
              </h3>
              <ul className="preflight-list preflight-list--ready">
                {eligible.map((repository) => (
                  <li key={repository.path}>
                    <div className="preflight-repo">
                      <strong>{repository.name}</strong>
                      <span>
                        <GitBranch aria-hidden="true" />
                        {repository.branch} → {repository.upstream ?? `${repository.remoteName ?? "origin"}/${repository.branch}`}
                      </span>
                    </div>
                    <span className="preflight-count">
                      {isPush
                        ? repository.upstream
                          ? `↑ ${t("sync.commitCount", { count: repository.ahead })}`
                          : t("sync.firstPush")
                        : `↓ ${t("sync.commitCount", { count: repository.behind })}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {blocked.length > 0 && (
            <section className="preflight-section preflight-section--blocked">
              <h3>
                <AlertTriangle aria-hidden="true" />
                {t("sync.blocked", { count: blocked.length })}
              </h3>
              <ul className="preflight-list">
                {blocked.map((repository) => (
                  <li key={repository.path}>
                    <strong>{repository.name}</strong>
                    <span>{blockedReasonText(repository)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {isPush && eligible.length > 0 && (
            <div className="safety-note">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>{t("sync.pushWarning")}</strong>
                <p>
                  {t("sync.pushWarningBody")}
                  {firstPushCount > 0 &&
                    (firstPushCount === 1
                      ? t("sync.firstPushOne")
                      : t("sync.firstPushMany", { count: firstPushCount }))}
                </p>
              </div>
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <span className="modal-summary">
            {eligible.length === 0
              ? t("sync.noneEligible")
              : t("sync.willProcess", { count: eligible.length })}
          </span>
          <div className="modal-actions">
            <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={`button ${isPush ? "button--primary" : "button--secondary-strong"}`}
              onClick={() => onConfirm(eligible.map((repository) => repository.path), strategy)}
              disabled={eligible.length === 0 || busy}
            >
              {busy ? (
                <LoaderCircle className="spin" aria-hidden="true" />
              ) : isPush ? (
                <ArrowUpFromLine aria-hidden="true" />
              ) : (
                <ArrowDownToLine aria-hidden="true" />
              )}
              {busy ? t("sync.running") : t(isPush ? "sync.confirmPush" : "sync.confirmPull")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
