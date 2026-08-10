import { GitFork, LoaderCircle } from "lucide-react";
import { useTranslation } from "../i18n/context";
import type { GitHubSession } from "../types";

interface GitHubAccountButtonProps {
  session: GitHubSession | null;
  loading: boolean;
  onClick: () => void;
}

export function GitHubAccountButton({ session, loading, onClick }: GitHubAccountButtonProps) {
  const { t } = useTranslation();
  const label = session ? session.user.name || session.user.login : t("account.connect");

  return (
    <button
      type="button"
      className={`github-account-button ${session ? "is-connected" : ""}`}
      onClick={onClick}
      disabled={loading}
      aria-label={
        session ? t("account.connectedAria", { name: label }) : t("account.connectAria")
      }
    >
      {loading ? (
        <span className="github-account-icon">
          <LoaderCircle className="spin" aria-hidden="true" />
        </span>
      ) : session ? (
        <img src={session.user.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="github-account-icon">
          <GitFork aria-hidden="true" />
        </span>
      )}
      <span className="github-account-label">
        <small>{session ? t("account.connected") : t("account.label")}</small>
        <strong>{loading ? t("account.checking") : label}</strong>
      </span>
      {session && <span className="connected-dot" aria-hidden="true" />}
    </button>
  );
}
