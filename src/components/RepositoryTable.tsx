import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  GitBranch,
  GitFork,
  Globe2,
  HardDrive,
  Link2,
  LoaderCircle,
  MoreHorizontal,
} from "lucide-react";
import {
  compactPath,
  displayBranch,
  formatCheckedAt,
  hasRemote,
  repositoryGroup,
} from "../repositoryUtils";
import { useTranslation } from "../i18n/context";
import { MESSAGES, type MessageId } from "../i18n/dictionary";
import type { RepositoryGroup, RepositoryInfo } from "../types";
import { StatusBadges } from "./StatusBadges";

interface RepositoryTableProps {
  repositories: RepositoryInfo[];
  rootPath: string;
  activePath: string | null;
  selectedPaths: Set<string>;
  linkingPath: string | null;
  onActivate: (path: string) => void;
  onToggle: (path: string) => void;
  onToggleAll: () => void;
  onTogglePaths: (paths: string[]) => void;
  onLinkGitHub: (repository: RepositoryInfo) => void;
}

const GROUPS: { id: RepositoryGroup; label: MessageId; icon: typeof GitBranch }[] = [
  { id: "github", label: "table.group.github", icon: GitFork },
  { id: "otherRemote", label: "table.group.otherRemote", icon: Globe2 },
  { id: "local", label: "table.group.local", icon: HardDrive },
];

export function RepositoryTable({
  repositories,
  rootPath,
  activePath,
  selectedPaths,
  linkingPath,
  onActivate,
  onToggle,
  onToggleAll,
  onTogglePaths,
  onLinkGitHub,
}: RepositoryTableProps) {
  const { t, locale } = useTranslation();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<Set<RepositoryGroup>>(new Set());
  const selectedVisible = repositories.filter((repo) => selectedPaths.has(repo.path)).length;
  const allSelected = repositories.length > 0 && selectedVisible === repositories.length;
  const partiallySelected = selectedVisible > 0 && !allSelected;

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        rows: repositories.filter((repository) => repositoryGroup(repository) === group.id),
      })).filter((group) => group.rows.length > 0),
    [repositories],
  );

  // With only one group populated the headings add no information: the table
  // stays flat, as it was before grouping.
  const showGroupHeaders = groups.length > 1;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  function toggleCollapsed(id: RepositoryGroup) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderRow(repository: RepositoryInfo) {
    // `displayBranch` gives a real branch name or the identifier of the
    // message that stands in for it; only the second needs translating.
    const branch = displayBranch(repository);
    const branchLabel = branch in MESSAGES ? t(branch as MessageId) : branch;
    const checkedAt = formatCheckedAt(repository.checkedAt, locale);
    const active = activePath === repository.path;
    return (
      <tr className={active ? "is-active" : ""} key={repository.path}>
        <td className="check-column">
          <input
            type="checkbox"
            checked={selectedPaths.has(repository.path)}
            onChange={() => onToggle(repository.path)}
            aria-label={t("table.selectAria", { name: repository.name })}
          />
        </td>
        <td>
          <button
            type="button"
            className="repository-name-button"
            onClick={() => onActivate(repository.path)}
            aria-current={active ? "true" : undefined}
          >
            <span className="repository-name">{repository.name}</span>
            <span className="repository-path" title={repository.path}>
              {compactPath(repository.path, rootPath)}
            </span>
          </button>
        </td>
        <td>
          <span className="branch-cell" title={branchLabel}>
            <GitBranch aria-hidden="true" />
            {branchLabel}
          </span>
        </td>
        <td>
          <StatusBadges repository={repository} compact />
        </td>
        <td className="checked-column">
          <span className="checked-at">{t(checkedAt.id, checkedAt.params)}</span>
        </td>
        <td className="menu-column">
          <div className="row-actions">
            {!hasRemote(repository) && (
              <button
                type="button"
                className="icon-button icon-button--ghost repository-link-action"
                aria-label={t("table.linkAria", { repository: repository.name })}
                title={t("table.linkTitle")}
                disabled={linkingPath !== null}
                onClick={() => onLinkGitHub(repository)}
              >
                {linkingPath === repository.path ? (
                  <LoaderCircle className="spin" aria-hidden="true" />
                ) : (
                  <Link2 aria-hidden="true" />
                )}
              </button>
            )}
            <button
              type="button"
              className="icon-button icon-button--ghost"
              aria-label={t("table.detailsAria", { repository: repository.name })}
              onClick={() => onActivate(repository.path)}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="repository-table-wrap">
      <table className="repository-table">
        <thead>
          <tr>
            <th className="check-column">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label={t("table.selectAll")}
              />
            </th>
            <th>{t("table.header.repository")}</th>
            <th>{t("table.header.branch")}</th>
            <th>{t("table.header.status")}</th>
            <th className="checked-column">{t("table.header.lastCheck")}</th>
            <th className="menu-column">
              <span className="sr-only">{t("table.header.actions")}</span>
            </th>
          </tr>
        </thead>
        {groups.map(({ id, label, icon: Icon, rows }) => {
          const isCollapsed = collapsed.has(id);
          const groupSelected = rows.every((repository) => selectedPaths.has(repository.path));
          return (
            <tbody key={id}>
              {showGroupHeaders && (
                <tr className="repository-group-row">
                  <td colSpan={6}>
                    <div className="repository-group-header">
                      <button
                        type="button"
                        className="repository-group-toggle"
                        onClick={() => toggleCollapsed(id)}
                        aria-expanded={!isCollapsed}
                      >
                        <ChevronDown
                          className={`repository-group-chevron ${isCollapsed ? "is-collapsed" : ""}`}
                          aria-hidden="true"
                        />
                        <Icon aria-hidden="true" />
                        <span>{t(label)}</span>
                        <strong>{rows.length}</strong>
                      </button>
                      <button
                        type="button"
                        className="repository-group-select"
                        onClick={() => onTogglePaths(rows.map((repository) => repository.path))}
                      >
                        {t(groupSelected ? "table.deselectGroup" : "table.selectGroup")}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {!isCollapsed && rows.map(renderRow)}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
