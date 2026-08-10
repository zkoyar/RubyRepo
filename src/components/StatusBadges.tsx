import {
  AlertOctagon,
  ArrowDown,
  ArrowUp,
  CircleDotDashed,
  GitBranch,
  HardDrive,
} from "lucide-react";
import { useTranslation } from "../i18n/context";
import { hasRemote, isDirty } from "../repositoryUtils";
import type { RepositoryInfo } from "../types";

interface StatusBadgesProps {
  repository: RepositoryInfo;
  compact?: boolean;
}

export function StatusBadges({ repository, compact = false }: StatusBadgesProps) {
  const { t } = useTranslation();
  const badges = [];

  if (repository.conflicted > 0) {
    badges.push(
      <span className="status-badge status-badge--danger" key="conflict">
        <AlertOctagon aria-hidden="true" />
        {compact ? repository.conflicted : t("badge.conflicts", { count: repository.conflicted })}
      </span>,
    );
  }

  if (isDirty(repository)) {
    badges.push(
      <span className="status-badge status-badge--dirty" key="dirty">
        <CircleDotDashed aria-hidden="true" />
        {compact ? repository.changedFiles : t("badge.changes", { count: repository.changedFiles })}
      </span>,
    );
  }

  if (repository.ahead > 0) {
    badges.push(
      <span className="status-badge status-badge--ahead" key="ahead">
        <ArrowUp aria-hidden="true" />
        {repository.ahead} {compact ? "" : t("badge.ahead")}
      </span>,
    );
  }

  if (repository.behind > 0) {
    badges.push(
      <span className="status-badge status-badge--behind" key="behind">
        <ArrowDown aria-hidden="true" />
        {repository.behind} {compact ? "" : t("badge.behind")}
      </span>,
    );
  }

  if (!hasRemote(repository)) {
    badges.push(
      <span className="status-badge status-badge--muted" key="no-remote">
        <HardDrive aria-hidden="true" />
        {compact ? t("badge.localOnly") : t("badge.noRemote")}
      </span>,
    );
  } else if (!repository.upstream) {
    badges.push(
      <span className="status-badge status-badge--warning" key="no-upstream">
        <GitBranch aria-hidden="true" />
        {compact ? t("badge.noUpstreamShort") : t("badge.noUpstream")}
      </span>,
    );
  }

  if (badges.length === 0) {
    badges.push(
      <span className="status-badge status-badge--clean" key="clean">
        <span className="status-dot" aria-hidden="true" />
        {t("badge.clean")}
      </span>,
    );
  }

  return <div className="status-badges">{badges}</div>;
}
