import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, GitCommitHorizontal, Info, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "../i18n/context";
import type { MessageId } from "../i18n/dictionary";
import { isDirty } from "../repositoryUtils";
import type { CommitRequest, RepositoryInfo } from "../types";

interface CommitDialogProps {
  repositories: RepositoryInfo[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (requests: CommitRequest[]) => void;
}

/// Why a repository cannot take part, or `null` if it can.
///
/// Returns an identifier so the reason reads in the chosen language; the
/// caller translates it.
function exclusionReason(repository: RepositoryInfo): MessageId | null {
  if (repository.conflicted > 0) return "commit.excluded.conflicts";
  if (repository.detached) return "branch.detached";
  if (!isDirty(repository)) return "commit.excluded.nothing";
  return null;
}

export function CommitDialog({ repositories, busy, onClose, onConfirm }: CommitDialogProps) {
  const { t } = useTranslation();

  function translateReason(repository: RepositoryInfo) {
    const reason = exclusionReason(repository);
    return reason ? t(reason) : null;
  }

  const eligible = useMemo(
    () => repositories.filter((repository) => !exclusionReason(repository)),
    [repositories],
  );
  const excluded = useMemo(
    () => repositories.filter((repository) => exclusionReason(repository)),
    [repositories],
  );
  const [messages, setMessages] = useState<Record<string, string>>(() =>
    Object.fromEntries(eligible.map((repository) => [repository.path, ""])),
  );
  const [stageAll, setStageAll] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(eligible.map((repository) => [repository.path, false])),
  );
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(eligible.map((repository) => [repository.path, true])),
  );
  const [sharedMessage, setSharedMessage] = useState(false);
  const [sharedValue, setSharedValue] = useState("");
  const [stageAllAcknowledged, setStageAllAcknowledged] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const includedRepositories = eligible.filter((repository) => included[repository.path]);
  const usesStageAll = includedRepositories.some((repository) => stageAll[repository.path]);
  const valid =
    includedRepositories.length > 0 &&
    includedRepositories.every((repository) => {
      const message = sharedMessage ? sharedValue : messages[repository.path];
      return message?.trim() && (repository.staged > 0 || stageAll[repository.path]);
    }) &&
    (!usesStageAll || stageAllAcknowledged);

  function updateStageAll(path: string, value: boolean) {
    setStageAll((current) => ({ ...current, [path]: value }));
    setStageAllAcknowledged(false);
  }

  function submit() {
    if (!valid || busy) return;
    onConfirm(
      includedRepositories.map((repository) => ({
        repoPath: repository.path,
        message: (sharedMessage ? sharedValue : messages[repository.path]).trim(),
        stageAll: Boolean(stageAll[repository.path]),
      })),
    );
  }

  return (
    <div className="modal-backdrop">
      <section
        className="modal commit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-dialog-title"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{t("commit.eyebrow")}</span>
            <h2 id="commit-dialog-title">{t("commit.title")}</h2>
            <p>{t("commit.subtitle")}</p>
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

        <div className="modal-body">
          <div className="commit-staged-note" role="note">
            <Info aria-hidden="true" />
            <div>
              <strong>{t("commit.stagedOnly")}</strong>
              <span>{t("commit.stagedOnlyBody")}</span>
            </div>
          </div>

          {eligible.length > 1 && (
            <label className="toggle-row shared-message-toggle">
              <input
                type="checkbox"
                checked={sharedMessage}
                onChange={(event) => setSharedMessage(event.currentTarget.checked)}
              />
              <span>
                <strong>{t("commit.sharedToggle")}</strong>
                <small>{t("commit.sharedToggleHint")}</small>
              </span>
            </label>
          )}

          {sharedMessage && (
            <label className="field shared-message-field">
              <span>{t("commit.sharedMessage")}</span>
              <input
                autoFocus
                value={sharedValue}
                onChange={(event) => setSharedValue(event.currentTarget.value)}
                placeholder={t("commit.sharedPlaceholder")}
                maxLength={240}
              />
            </label>
          )}

          <div className="commit-repository-list">
            {eligible.map((repository) => {
              const isIncluded = included[repository.path];
              const lacksStagedContent = repository.staged === 0 && !stageAll[repository.path];
              return (
                <article
                  className={`commit-repository-card ${isIncluded ? "" : "is-excluded"}`}
                  key={repository.path}
                >
                  <div className="commit-card-heading">
                    <label className="repo-include-control">
                      <input
                        type="checkbox"
                        checked={Boolean(isIncluded)}
                        onChange={(event) => {
                          // Read while the event is still alive: React may run
                          // the updater after the handler returns, and then
                          // `currentTarget` is null.
                          const checked = event.currentTarget.checked;
                          setIncluded((current) => ({ ...current, [repository.path]: checked }));
                        }}
                      />
                      <span>
                        <strong>{repository.name}</strong>
                        <small>{repository.branch || repository.headShort || "HEAD"}</small>
                      </span>
                    </label>
                    <span className="change-summary">
                      {t("commit.fileSummary", {
                        staged: repository.staged,
                        modified: repository.unstaged,
                        untracked: repository.untracked,
                      })}
                    </span>
                  </div>

                  {isIncluded && !sharedMessage && (
                    <label className="field">
                      <span>{t("commit.message")}</span>
                      <input
                        value={messages[repository.path] ?? ""}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setMessages((current) => ({ ...current, [repository.path]: value }));
                        }}
                        placeholder={t("commit.messagePlaceholder", { repository: repository.name })}
                        maxLength={240}
                      />
                    </label>
                  )}

                  {isIncluded && (
                    <label className="toggle-row stage-all-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(stageAll[repository.path])}
                        onChange={(event) => updateStageAll(repository.path, event.currentTarget.checked)}
                      />
                      <span>
                        <strong>{t("commit.stageAll")}</strong>
                        <small>{t("commit.stageAllHint")}</small>
                      </span>
                    </label>
                  )}

                  {isIncluded && lacksStagedContent && (
                    <p className="field-hint field-hint--warning">
                      <AlertTriangle aria-hidden="true" />
                      {t("commit.noStagedWarning")}
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          {excluded.length > 0 && (
            <details className="excluded-repositories">
              <summary>{t("commit.excluded", { count: excluded.length })}</summary>
              <ul>
                {excluded.map((repository) => (
                  <li key={repository.path}>
                    <span>{repository.name}</span>
                    <small>{translateReason(repository)}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {usesStageAll && (
            <label className="stage-confirmation">
              <input
                type="checkbox"
                checked={stageAllAcknowledged}
                onChange={(event) => setStageAllAcknowledged(event.currentTarget.checked)}
              />
              <span>
                <strong>{t("commit.acknowledge")}</strong>
                <small>{t("commit.acknowledgeHint")}</small>
              </span>
            </label>
          )}
        </div>

        <footer className="modal-footer">
          <span className="modal-summary">
            {t("commit.summary", { count: includedRepositories.length })}
          </span>
          <div className="modal-actions">
            <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button type="button" className="button button--primary" onClick={submit} disabled={!valid || busy}>
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <GitCommitHorizontal aria-hidden="true" />}
              {busy ? t("commit.running") : t("commit.title")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
