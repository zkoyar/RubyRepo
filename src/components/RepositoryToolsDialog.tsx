import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Cloud,
  History,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  applyStash,
  conflictState,
  createStash,
  listRemotes,
  listStashes,
  removeRemote,
  repositoryHistory,
  resolveConflict,
  setRemote,
} from "../api";
import { useTranslation } from "../i18n/context";
import type { MessageId } from "../i18n/dictionary";
import { errorMessage } from "../repositoryUtils";
import type {
  CommitEntry,
  ConflictState,
  HistoryResult,
  HistoryScope,
  RemoteInfo,
  RepositoryInfo,
  StashEntry,
} from "../types";

type Tab = "history" | "remotes" | "stashes" | "conflicts";

interface RepositoryToolsDialogProps {
  repository: RepositoryInfo;
  initialTab?: Tab;
  nativeEnabled: boolean;
  onClose: () => void;
  onRepositoryChanged: (repository: RepositoryInfo, message: string) => void;
}

const TABS: { id: Tab; label: MessageId }[] = [
  { id: "history", label: "tools.tab.history" },
  { id: "remotes", label: "tools.tab.remotes" },
  { id: "stashes", label: "tools.tab.stashes" },
  { id: "conflicts", label: "tools.tab.conflicts" },
];

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const PENDING_LABEL: Record<string, string> = {
  merge: "Merge",
  rebase: "Rebase",
  cherryPick: "Cherry-pick",
  revert: "Revert",
};

/// The locale is a parameter so dates follow the chosen language.
function shortDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function RepositoryToolsDialog({
  repository,
  initialTab = "history",
  nativeEnabled,
  onClose,
  onRepositoryChanged,
}: RepositoryToolsDialogProps) {
  const { t, locale } = useTranslation();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [scope, setScope] = useState<HistoryScope>("recent");
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [remotes, setRemotes] = useState<RemoteInfo[] | null>(null);
  const [stashes, setStashes] = useState<StashEntry[] | null>(null);
  const [conflicts, setConflicts] = useState<ConflictState | null>(null);
  // Instead of a flag raised inside the effect: it loads while the tab shown
  // does not coincide with the one already read. That way every state write
  // happens in an asynchronous callback, not in the body of the effect.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [editingRemote, setEditingRemote] = useState<string | null>(null);
  const [stashMessage, setStashMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  const path = repository.path;

  const wantedKey = `${tab}:${scope}`;
  const loading = loadedKey !== wantedKey;

  const load = useCallback(async () => {
    if (!nativeEnabled) return;
    try {
      if (tab === "history") setHistory(await repositoryHistory(path, scope));
      else if (tab === "remotes") setRemotes(await listRemotes(path));
      else if (tab === "stashes") setStashes(await listStashes(path));
      else setConflicts(await conflictState(path));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason, t));
    } finally {
      // Even after an error the tab stops calling itself loading: the message
      // is already in front of the user.
      setLoadedKey(`${tab}:${scope}`);
    }
  }, [nativeEnabled, path, scope, t, tab]);

  useEffect(() => {
    // The rule forbids setting state inside an effect because it usually
    // signals a loop. There is none here: `load` writes only after an await, and
    // the exit condition is `loadedKey`, which the effect does not read back.
    // Reading data when the tab changes is exactly what an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => activeTabRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

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
      } else if (event.shiftKey && document.activeElement === first) {
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

  /// Every action changes the state of the repository: the row has to be
  /// replaced with the one the backend returns, and the list re-read instead of
  /// edited by hand.
  async function act(
    run: () => Promise<RepositoryInfo>,
    message: string,
    onSuccess?: () => void,
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await run();
      onSuccess?.();
      onRepositoryChanged(updated, message);
      await load();
    } catch (reason) {
      setError(errorMessage(reason, t));
    } finally {
      setBusy(false);
    }
  }

  function resetRemoteEditor() {
    setEditingRemote(null);
    setRemoteName("origin");
    setRemoteUrl("");
  }

  function editRemote(remote: RemoteInfo) {
    setEditingRemote(remote.name);
    setRemoteName(remote.name);
    // Values returned by list_remotes are display-only: credentials, query
    // parameters and additional URLs may have been intentionally omitted by
    // the backend. Reusing that value would silently overwrite the real one.
    setRemoteUrl("");
    setError(null);
  }

  function renderHistory() {
    const commits: CommitEntry[] = history?.commits ?? [];
    const noUpstream = scope === "outgoing" && history?.upstream === null;

    return (
      <>
        <div className="tools-scope" role="group" aria-label={t("tools.scopeAria")}>
          <button
            type="button"
            className={scope === "recent" ? "is-active" : ""}
            onClick={() => setScope("recent")}
            disabled={loading}
          >
            {t("tools.recent")}
          </button>
          <button
            type="button"
            className={scope === "outgoing" ? "is-active" : ""}
            onClick={() => setScope("outgoing")}
            disabled={loading}
          >
            {t("tools.outgoing")}
          </button>
        </div>

        {noUpstream ? (
          <p className="tools-empty">
            <AlertCircle aria-hidden="true" />
            {t("tools.noUpstream")}
          </p>
        ) : commits.length === 0 ? (
          <p className="tools-empty">
            <CheckCircle2 aria-hidden="true" />
            {t(scope === "outgoing" ? "tools.nothingToSend" : "tools.noCommits")}
          </p>
        ) : (
          <ul className="tools-list">
            {commits.map((commit) => (
              <li key={commit.hash}>
                <div className="tools-list-copy">
                  <strong>{commit.subject}</strong>
                  <small>
                    <code>{commit.shortHash}</code> · {commit.author} · {shortDate(commit.date, locale)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
        {history?.truncated && <p className="tools-note">{t("tools.truncated")}</p>}
      </>
    );
  }

  function renderRemotes() {
    return (
      <>
        {remotes?.length === 0 ? (
          <p className="tools-empty">
            <Cloud aria-hidden="true" />
            {t("tools.noRemotes")}
          </p>
        ) : (
          <ul className="tools-list">
            {(remotes ?? []).map((remote) => (
              <li key={remote.name}>
                <div className="tools-list-copy">
                  <strong>{remote.name}</strong>
                  <small title={remote.fetchUrl}>{remote.fetchUrl}</small>
                  {remote.pushUrl !== remote.fetchUrl && (
                    <small title={remote.pushUrl}>push: {remote.pushUrl}</small>
                  )}
                </div>
                <div className="tools-list-actions">
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() => editRemote(remote)}
                    disabled={busy}
                  >
                    {t("tools.edit")}
                  </button>
                  <button
                    type="button"
                    className="button button--small button--danger"
                    onClick={() =>
                      void act(
                        () => removeRemote(path, remote.name),
                        t("tools.remoteRemoved", { name: remote.name }),
                      )
                    }
                    disabled={busy}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="tools-form">
          <label>
            <span>{t("tools.remoteName")}</span>
            <input
              type="text"
              value={remoteName}
              onChange={(event) => setRemoteName(event.currentTarget.value)}
              disabled={busy || editingRemote !== null}
              aria-label={t("tools.remoteNameAria")}
            />
          </label>
          <label>
            <span>{t("tools.remoteUrl")}</span>
            <input
              type="text"
              value={remoteUrl}
              placeholder="https://github.com/owner/repository.git"
              onChange={(event) => setRemoteUrl(event.currentTarget.value)}
              disabled={busy}
              aria-label={t("tools.remoteUrlAria")}
            />
          </label>
          {editingRemote && (
            <p className="tools-note">{t("tools.remoteReplacementHint")}</p>
          )}
          <div className="tools-list-actions tools-list-actions--end">
            {editingRemote && (
              <button
                type="button"
                className="button"
                onClick={resetRemoteEditor}
                disabled={busy}
              >
                {t("tools.cancelRemoteEdit")}
              </button>
            )}
            <button
              type="button"
              className="button button--primary"
              onClick={() =>
                void act(
                  () => setRemote(path, remoteName.trim(), remoteUrl.trim()),
                  t("tools.remoteSaved", { name: remoteName.trim() }),
                  resetRemoteEditor,
                )
              }
              disabled={busy || !remoteName.trim() || !remoteUrl.trim()}
            >
              <Plus aria-hidden="true" />
              {t("tools.saveRemote")}
            </button>
          </div>
        </div>
      </>
    );
  }

  function renderStashes() {
    return (
      <>
        {stashes?.length === 0 ? (
          <p className="tools-empty">
            <Archive aria-hidden="true" />
            {t("tools.noStashes")}
          </p>
        ) : (
          <ul className="tools-list">
            {(stashes ?? []).map((stash) => (
              <li key={`${stash.objectId}:${stash.index}`}>
                <div className="tools-list-copy">
                  <strong>{stash.message}</strong>
                  <small>
                    {stash.branch ? `${stash.branch} · ` : ""}
                    {shortDate(stash.date, locale)}
                  </small>
                </div>
                <div className="tools-list-actions">
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() =>
                      void act(
                        () => applyStash(path, stash.index, stash.objectId, "apply"),
                        t("tools.stashApplied"),
                      )
                    }
                    disabled={busy}
                    title={t("tools.stashApplyTitle")}
                  >
                    {t("tools.stashApply")}
                  </button>
                  <button
                    type="button"
                    className="button button--small button--primary"
                    onClick={() =>
                      void act(
                        () => applyStash(path, stash.index, stash.objectId, "pop"),
                        t("tools.stashPopped"),
                      )
                    }
                    disabled={busy}
                    title={t("tools.stashPopTitle")}
                  >
                    {t("tools.stashPop")}
                  </button>
                  <button
                    type="button"
                    className="button button--small button--danger"
                    onClick={() =>
                      void act(
                        () => applyStash(path, stash.index, stash.objectId, "drop"),
                        t("tools.stashDropped"),
                      )
                    }
                    disabled={busy}
                    title={t("tools.stashDropTitle")}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="tools-form">
          <label>
            <span>{t("tools.stashMessage")}</span>
            <input
              type="text"
              value={stashMessage}
              placeholder={t("tools.stashPlaceholder")}
              onChange={(event) => setStashMessage(event.currentTarget.value)}
              disabled={busy}
              aria-label={t("tools.stashMessageAria")}
            />
          </label>
          <label className="tools-checkbox">
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(event) => setIncludeUntracked(event.currentTarget.checked)}
              disabled={busy}
            />
            <span>{t("tools.stashUntracked")}</span>
          </label>
          <button
            type="button"
            className="button button--primary"
            onClick={() =>
              void act(
                () => createStash(path, stashMessage.trim(), includeUntracked),
                t("tools.stashCreated"),
              )
            }
            disabled={busy}
          >
            <Archive aria-hidden="true" />
            {t("tools.stashCreate")}
          </button>
        </div>
      </>
    );
  }

  function renderConflicts() {
    const pending = conflicts?.pending ?? "none";
    if (pending === "none") {
      return (
        <p className="tools-empty">
          <CheckCircle2 aria-hidden="true" />
          {t("tools.noPending")}
        </p>
      );
    }

    const stillConflicted = (conflicts?.conflicted ?? []).length > 0;
    return (
      <>
        <p className="tools-pending">
          <AlertTriangle aria-hidden="true" />
          <span>
            {t("tools.pending", { operation: PENDING_LABEL[pending] ?? pending })}
            {t(stillConflicted ? "tools.pendingResolve" : "tools.pendingReady")}
          </span>
        </p>

        {stillConflicted && (
          <ul className="tools-list">
            {(conflicts?.conflicted ?? []).map((file) => (
              <li key={file}>
                <div className="tools-list-copy">
                  <strong>{file}</strong>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="tools-list-actions tools-list-actions--end">
          <button
            type="button"
            className="button button--danger"
            onClick={() =>
              void act(
                () => resolveConflict(path, "abort"),
                t("tools.aborted"),
              )
            }
            disabled={busy}
          >
            <Undo2 aria-hidden="true" />
            {t("tools.abort")}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() =>
              void act(() => resolveConflict(path, "continue"), t("tools.continued"))
            }
            disabled={busy || stillConflicted}
            title={stillConflicted ? t("tools.stillConflicted") : undefined}
          >
            <CheckCircle2 aria-hidden="true" />
            {t("tools.continue")}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="modal tools-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("tools.aria")}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <small>{t("tools.eyebrow")}</small>
            <h2>{repository.name}</h2>
            <p title={repository.path}>{repository.path}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t("common.close")}
            disabled={busy}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="inspector-tabs" role="tablist" aria-label={t("tools.aria")}>
          {TABS.map((entry) => (
            <button
              ref={tab === entry.id ? activeTabRef : undefined}
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={tab === entry.id ? "is-active" : ""}
              onClick={() => setTab(entry.id)}
              disabled={busy}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>

        <div className="modal-body tools-body">
          {loading ? (
            <p className="tools-empty">
              <LoaderCircle className="spin" aria-hidden="true" /> {t("tools.loading")}
            </p>
          ) : tab === "history" ? (
            renderHistory()
          ) : tab === "remotes" ? (
            renderRemotes()
          ) : tab === "stashes" ? (
            renderStashes()
          ) : (
            renderConflicts()
          )}
          {error && <p className="field-error">{error}</p>}
        </div>

        <footer className="modal-footer">
          <span>
            {tab === "history" ? (
              <>
                <History aria-hidden="true" /> {t("tools.readOnly")}
              </>
            ) : (
              t("tools.scopeNote")
            )}
          </span>
          <div className="modal-actions">
            <button type="button" className="button" onClick={() => void load()} disabled={busy || loading}>
              <RotateCcw aria-hidden="true" />
              {t("common.refresh")}
            </button>
            <button type="button" className="button" onClick={onClose} disabled={busy}>
              {t("common.close")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
