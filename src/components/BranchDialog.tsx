import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Cloud,
  GitBranch,
  LoaderCircle,
  Plus,
  Search,
  X,
} from "lucide-react";
import { createBranch, listBranches, switchBranch } from "../api";
import { useTranslation } from "../i18n/context";
import type { MessageId } from "../i18n/dictionary";
import { errorMessage } from "../repositoryUtils";
import type { BranchInfo, BranchList, RepositoryInfo } from "../types";

interface BranchDialogProps {
  repository: RepositoryInfo;
  nativeEnabled: boolean;
  onClose: () => void;
  onBranchChanged: (repository: RepositoryInfo, message: string) => void;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/// Icon and text for the relation to the upstream. `gone` deserves a warning:
/// the branch tracks a remote that no longer exists, and a push would go
/// nowhere.
function trackBadge(branch: BranchInfo): { icon: React.ReactElement; label: MessageId } | null {
  switch (branch.track) {
    case "ahead":
      return { icon: <ArrowUp aria-hidden="true" />, label: "branchDialog.track.ahead" };
    case "behind":
      return { icon: <ArrowDown aria-hidden="true" />, label: "branchDialog.track.behind" };
    case "diverged":
      return { icon: <ArrowUpDown aria-hidden="true" />, label: "branchDialog.track.diverged" };
    case "gone":
      return { icon: <AlertCircle aria-hidden="true" />, label: "branchDialog.track.gone" };
    default:
      return null;
  }
}

export function BranchDialog({
  repository,
  nativeEnabled,
  onClose,
  onBranchChanged,
}: BranchDialogProps) {
  const { t } = useTranslation();
  const [list, setList] = useState<BranchList | null>(null);
  // Outside Tauri there is nothing to load: starting at `false` avoids having
  // to switch it off from inside the effect.
  const [loading, setLoading] = useState(nativeEnabled);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const busy = busyBranch !== null || creating;

  useEffect(() => {
    if (!nativeEnabled) return;
    let cancelled = false;

    listBranches(repository.path)
      .then((next) => {
        if (!cancelled) setList(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason, t));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nativeEnabled, repository.path, t]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      if (searchRef.current && !searchRef.current.disabled) searchRef.current.focus();
      else closeButtonRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
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

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const branches = list?.branches ?? [];
    if (!normalized) return branches;
    return branches.filter((branch) =>
      [branch.name, branch.subject].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [list, query]);

  async function reload() {
    try {
      setList(await listBranches(repository.path));
    } catch (reason) {
      setError(errorMessage(reason, t));
    }
  }

  async function goTo(branch: BranchInfo) {
    if (busy || branch.current) return;
    setError(null);
    setBusyBranch(branch.name);
    try {
      const updated = await switchBranch(repository.path, branch.name);
      onBranchChanged(
        updated,
        branch.remoteOnly
          ? t("branchDialog.trackingCreated", {
              name: branch.name,
              upstream: branch.upstream ?? t("branchDialog.trackUnknown"),
            })
          : t("branchDialog.switched", { name: branch.name }),
      );
      await reload();
    } catch (reason) {
      setError(errorMessage(reason, t));
    } finally {
      setBusyBranch(null);
    }
  }

  async function create(checkout: boolean) {
    const name = newName.trim();
    if (busy || !name) return;
    setError(null);
    setCreating(true);
    try {
      const updated = await createBranch(repository.path, name, checkout);
      onBranchChanged(
        updated,
        checkout
          ? t("branchDialog.createdAndSwitched", { name })
          : t("branchDialog.created", { name }),
      );
      setNewName("");
      await reload();
    } catch (reason) {
      setError(errorMessage(reason, t));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal branch-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("branch.listAria", { name: repository.name })}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <small>{t("branchDialog.eyebrow")}</small>
            <h2>{repository.name}</h2>
            <p>
              {list?.detached
                ? t("branchDialog.detached")
                : t("branchDialog.current", {
                    name: list?.current ?? repository.branch ?? "—",
                  })}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t("common.close")}
            disabled={busy}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="modal-body branch-dialog-body">
          <label className="search-box github-link-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={t("branchDialog.searchPlaceholder")}
              onChange={(event) => setQuery(event.currentTarget.value)}
              disabled={loading}
              ref={searchRef}
              aria-label={t("branchDialog.searchAria")}
            />
          </label>

          {loading ? (
            <p className="branch-dialog-empty">
              <LoaderCircle className="spin" aria-hidden="true" /> {t("branchDialog.loading")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="branch-dialog-empty">
              <AlertCircle aria-hidden="true" />
              {t(list?.branches.length === 0 ? "branchDialog.none" : "branchDialog.noMatch")}
            </p>
          ) : (
            <ul className="branch-list">
              {filtered.map((branch) => {
                const badge = trackBadge(branch);
                return (
                  <li key={`${branch.remoteOnly ? "r" : "l"}:${branch.name}`}>
                    <button
                      type="button"
                      className={branch.current ? "is-current" : ""}
                      onClick={() => void goTo(branch)}
                      disabled={busy || branch.current}
                      title={
                        branch.current
                          ? t("branchDialog.alreadyHere")
                          : t("branchDialog.switchTo", { name: branch.name })
                      }
                    >
                      <span className="branch-list-icon">
                        {busyBranch === branch.name ? (
                          <LoaderCircle className="spin" aria-hidden="true" />
                        ) : branch.current ? (
                          <Check aria-hidden="true" />
                        ) : branch.remoteOnly ? (
                          <Cloud aria-hidden="true" />
                        ) : (
                          <GitBranch aria-hidden="true" />
                        )}
                      </span>
                      <span className="branch-list-copy">
                        <strong>{branch.name}</strong>
                        <small>{branch.subject || t("branchDialog.noCommit")}</small>
                      </span>
                      <span className="branch-list-badges">
                        {branch.remoteOnly && <span>{t("branchDialog.remoteOnly")}</span>}
                        {badge && (
                          <span>
                            {badge.icon}
                            {t(badge.label)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="branch-create">
            <label>
              <span>{t("branchDialog.newBranch")}</span>
              <input
                type="text"
                value={newName}
                placeholder={t("branchDialog.newPlaceholder")}
                onChange={(event) => setNewName(event.currentTarget.value)}
                disabled={busy || loading}
                aria-label={t("branchDialog.newAria")}
              />
            </label>
            <div className="branch-create-actions">
              <button
                type="button"
                className="button"
                onClick={() => void create(false)}
                disabled={busy || loading || !newName.trim()}
                title={t("branchDialog.createStayTitle")}
              >
                {t("branchDialog.createStay")}
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void create(true)}
                disabled={busy || loading || !newName.trim()}
              >
                {creating ? (
                  <LoaderCircle className="spin" aria-hidden="true" />
                ) : (
                  <Plus aria-hidden="true" />
                )}
                {t("branchDialog.createGo")}
              </button>
            </div>
          </div>

          {error && <p className="field-error">{error}</p>}
        </div>

        <footer className="modal-footer">
          <span>{t("branchDialog.footer")}</span>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            {t("common.close")}
          </button>
        </footer>
      </section>
    </div>
  );
}
