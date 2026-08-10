import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitFork,
  Globe2,
  KeyRound,
  Link2,
  LoaderCircle,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  githubBeginLogin,
  githubCreateRepository,
  githubDeleteRepository,
  githubGetSession,
  githubListRepositories,
  githubLogout,
  githubPollLogin,
  openExternalUrl,
} from "../api";
import { errorMessage } from "../repositoryUtils";
import { useTranslation } from "../i18n/context";
import {
  GitHubCreateRepositoryDialog,
  type RepositoryCreationOutcome,
} from "./GitHubCreateRepositoryDialog";
import { GitHubDeleteRepositoryDialog } from "./GitHubDeleteRepositoryDialog";
import { GitHubLinkRepositoryDialog } from "./GitHubLinkRepositoryDialog";
import type {
  GitHubCreateRepositoryRequest,
  GitHubDeleteRepositoryRequest,
  GitHubDeleteRepositoryResult,
  GitHubLinkRepositoryResult,
  GitHubLoginRequest,
  GitHubRepository,
  GitHubSession,
  RepositoryInfo,
} from "../types";

type LoginPhase = "idle" | "starting" | "waiting" | "slowDown" | "expired" | "error";
type AccountTab = "profile" | "repositories";
type AccessFilter = "all" | "write" | "read";

interface GitHubAccountDialogProps {
  session: GitHubSession | null;
  localRepositories: RepositoryInfo[];
  nativeEnabled: boolean;
  initialTab?: AccountTab;
  onSessionChange: (session: GitHubSession | null) => void;
  onRepositoryLinked: (result: GitHubLinkRepositoryResult) => void;
  onClose: () => void;
}

function timestamp(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/// Returns `null` instead of a sentence when the expiry is unknown: the text is
/// chosen by the caller, which has access to the dictionary. The real countdown
/// is made of digits, and is the same in every language.
function remainingTime(expiresAt: number | string, now: number): string | null {
  const expiration = timestamp(expiresAt);
  if (!expiration) return null;
  const seconds = Math.max(0, Math.ceil((expiration - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function formatExpiry(
  value: number | string | null | undefined,
  locale: string,
): string | null {
  const expiration = timestamp(value);
  if (!expiration) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(expiration));
}

function remoteFullName(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const match = remoteUrl.trim().match(/github\.com[/:]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`.toLocaleLowerCase();
}

function deduplicateRepositories(repositories: GitHubRepository[]): GitHubRepository[] {
  const ids = new Set<number>();
  const fullNames = new Set<string>();

  return repositories.filter((repository) => {
    const fullName = repository.fullName.toLocaleLowerCase();
    if (ids.has(repository.id) || fullNames.has(fullName)) return false;
    ids.add(repository.id);
    fullNames.add(fullName);
    return true;
  });
}

export function GitHubAccountDialog({
  session,
  localRepositories,
  nativeEnabled,
  initialTab = "profile",
  onSessionChange,
  onRepositoryLinked,
  onClose,
}: GitHubAccountDialogProps) {
  const { t, locale } = useTranslation();
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [loginPhase, setLoginPhase] = useState<LoginPhase>("idle");
  const [loginRequest, setLoginRequest] = useState<GitHubLoginRequest | null>(null);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [repositories, setRepositories] = useState<GitHubRepository[] | null>(null);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [repositoriesError, setRepositoriesError] = useState<string | null>(null);
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");
  const [logoutConfirmation, setLogoutConfirmation] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [profileActionError, setProfileActionError] = useState<string | null>(null);
  const [createRepositoryOpen, setCreateRepositoryOpen] = useState(false);
  const [linkRepositoryOpen, setLinkRepositoryOpen] = useState(false);
  const [linkInitialRepositoryId, setLinkInitialRepositoryId] = useState<number | null>(null);
  const [repositoryPendingDeletion, setRepositoryPendingDeletion] =
    useState<GitHubRepository | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const loginAttemptRef = useRef(0);
  const pollTimerRef = useRef<number | null>(null);
  const nestedDialogOpenRef = useRef(false);
  const repositoriesLoadingRef = useRef(false);
  const repositoriesLoadGenerationRef = useRef(0);

  const filteredRepositories = useMemo(() => {
    const query = repositoryQuery.trim().toLocaleLowerCase();
    return (repositories ?? []).filter((repository) => {
      const matchesAccess =
        accessFilter === "all" ||
        (accessFilter === "write" && repository.canPush) ||
        (accessFilter === "read" && !repository.canPush);
      const matchesQuery =
        !query ||
        repository.fullName.toLocaleLowerCase().includes(query) ||
        repository.owner.toLocaleLowerCase().includes(query) ||
        repository.defaultBranch.toLocaleLowerCase().includes(query);
      return matchesAccess && matchesQuery;
    });
  }, [accessFilter, repositories, repositoryQuery]);

  const localRemoteNames = useMemo(
    () =>
      new Set(
        localRepositories
          .map((repository) => remoteFullName(repository.remoteUrl))
          .filter((name): name is string => Boolean(name)),
      ),
    [localRepositories],
  );

  const writableRepositoryCount = useMemo(
    () => (repositories ?? []).filter((repository) => repository.canPush).length,
    [repositories],
  );

  function clearPollTimer() {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function invalidateLoginAttempt() {
    loginAttemptRef.current += 1;
    clearPollTimer();
  }

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !nestedDialogOpenRef.current) closeDialog();
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      loginAttemptRef.current += 1;
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
      previousFocus?.focus();
    };
    // Mount effect: it registers the keyboard listener and handles focus for
    // the whole life of the dialog. Adding `closeDialog` to the dependencies
    // would rerun it at every render, refocusing the close button and clearing
    // the timers of the sign-in in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Device Flow countdown starts from the moment the code appears: aligning
  // `now` straight away stops the first second from showing a remainder computed
  // on the previous sign-in.
  useEffect(() => {
    if (!loginRequest) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(ticker);
  }, [loginRequest]);

  // Lazy loading of the list on the first opening of the tab. With no
  // installations there is nothing to ask the backend, and the empty list is an
  // outcome, not a failed load.
  useEffect(() => {
    if (tab !== "repositories" || !session || repositories !== null) return;
    if (session.installationCount === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRepositories([]);
      return;
    }
    void loadRepositories();
    // It must fire on a change of tab, session or list, not on a change of the
    // function's identity: `loadRepositories` is recreated at every render and
    // would make it rerun constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositories, session, tab]);

  function schedulePoll(attempt: number, delaySeconds: number, request: GitHubLoginRequest) {
    clearPollTimer();
    const safeDelay = Math.max(1, delaySeconds);
    pollTimerRef.current = window.setTimeout(() => {
      void pollLogin(attempt, safeDelay, request);
    }, safeDelay * 1000);
  }

  async function pollLogin(
    attempt: number,
    previousDelay: number,
    request: GitHubLoginRequest,
  ) {
    if (attempt !== loginAttemptRef.current) return;
    const expiration = timestamp(request.expiresAt);
    if (expiration && Date.now() >= expiration) {
      clearPollTimer();
      setLoginPhase("expired");
      setLoginMessage(t("account.codeExpired"));
      return;
    }

    try {
      const result = await githubPollLogin();
      if (attempt !== loginAttemptRef.current) return;

      if (result.status === "complete") {
        const authenticatedSession = result.session ?? (await githubGetSession());
        if (attempt !== loginAttemptRef.current) return;
        if (!authenticatedSession) {
          setLoginPhase("error");
          setLoginMessage(t("account.sessionUnavailable"));
          return;
        }

        invalidateLoginAttempt();
        setLoginRequest(null);
        setLoginPhase("idle");
        setLoginMessage(null);
        onSessionChange(authenticatedSession);
        return;
      }

      if (result.status === "expired") {
        clearPollTimer();
        setLoginPhase("expired");
        setLoginMessage(t("account.codeExpired"));
        return;
      }

      const fallbackDelay = result.status === "slowDown" ? previousDelay + 5 : previousDelay;
      const nextDelay = Math.max(1, result.retryAfterSeconds || fallbackDelay);
      setLoginPhase(result.status === "slowDown" ? "slowDown" : "waiting");
      // The status alone is enough to choose the sentence. The backend no
      // longer sends a message of its own: it would have been the same text
      // written in two places, and the one in the backend does not know what
      // language the user is reading in.
      setLoginMessage(
        result.status === "slowDown"
          ? t("account.slowDown", { seconds: nextDelay })
          : t("account.waitingBrowser"),
      );
      schedulePoll(attempt, nextDelay, request);
    } catch (error) {
      if (attempt !== loginAttemptRef.current) return;
      clearPollTimer();
      setLoginPhase("error");
      setLoginMessage(t("account.pollFailed", { reason: errorMessage(error, t) }));
    }
  }

  async function beginLogin() {
    if (!nativeEnabled || loginPhase === "starting") return;
    invalidateLoginAttempt();
    const attempt = loginAttemptRef.current;
    setLoginRequest(null);
    setLoginMessage(null);
    setCopied(false);
    setLoginPhase("starting");

    try {
      const request = await githubBeginLogin();
      if (attempt !== loginAttemptRef.current) return;
      setLoginRequest(request);
      setLoginPhase("waiting");
      setLoginMessage(t("account.enterCode"));
      schedulePoll(attempt, request.intervalSeconds, request);
    } catch (error) {
      if (attempt !== loginAttemptRef.current) return;
      setLoginPhase("error");
      setLoginMessage(t("account.beginFailed", { reason: errorMessage(error, t) }));
    }
  }

  function cancelLogin() {
    invalidateLoginAttempt();
    setLoginRequest(null);
    setLoginPhase("idle");
    setLoginMessage(null);
    setCopied(false);
  }

  async function copyUserCode(): Promise<boolean> {
    if (!loginRequest) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(loginRequest.userCode);
      } else {
        codeInputRef.current?.select();
        if (!document.execCommand("copy")) throw new Error(t("account.copyUnsupported"));
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      return true;
    } catch (error) {
      setLoginMessage(t("account.copyFailed", { reason: errorMessage(error, t) }));
      codeInputRef.current?.select();
      return false;
    }
  }

  async function openVerificationPage() {
    if (!loginRequest || !nativeEnabled) return;
    await copyUserCode();
    try {
      await openExternalUrl(loginRequest.verificationUri);
    } catch (error) {
      setLoginMessage(t("account.openBrowserFailed", { reason: errorMessage(error, t) }));
    }
  }

  async function loadRepositories() {
    if (
      !nativeEnabled ||
      !session ||
      session.installationCount === 0 ||
      repositoriesLoadingRef.current
    ) return;
    const generation = ++repositoriesLoadGenerationRef.current;
    repositoriesLoadingRef.current = true;
    setRepositoriesLoading(true);
    setRepositoriesError(null);
    try {
      const loaded = deduplicateRepositories(await githubListRepositories());
      if (generation === repositoriesLoadGenerationRef.current) {
        setRepositories(loaded);
      }
    } catch (error) {
      if (generation === repositoriesLoadGenerationRef.current) {
        setRepositoriesError(errorMessage(error, t));
      }
    } finally {
      repositoriesLoadingRef.current = false;
      setRepositoriesLoading(false);
    }
  }

  function openCreateRepository() {
    if (!nativeEnabled || !session) return;
    nestedDialogOpenRef.current = true;
    setCreateRepositoryOpen(true);
  }

  function closeCreateRepository() {
    nestedDialogOpenRef.current = false;
    setCreateRepositoryOpen(false);
  }

  function openLinkRepository(repositoryId: number | null = null) {
    if (
      !nativeEnabled ||
      !session ||
      session.installationCount === 0 ||
      repositories === null ||
      writableRepositoryCount === 0
    ) return;
    setLinkInitialRepositoryId(repositoryId);
    nestedDialogOpenRef.current = true;
    setLinkRepositoryOpen(true);
  }

  function closeLinkRepository() {
    nestedDialogOpenRef.current = false;
    setLinkRepositoryOpen(false);
    setLinkInitialRepositoryId(null);
  }

  function openDeleteRepository(repository: GitHubRepository) {
    if (!nativeEnabled || !session || !repository.canAdmin) return;
    nestedDialogOpenRef.current = true;
    setRepositoryPendingDeletion(repository);
  }

  function closeDeleteRepository() {
    nestedDialogOpenRef.current = false;
    setRepositoryPendingDeletion(null);
  }

  async function deleteGitHubRepository(
    request: GitHubDeleteRepositoryRequest,
  ): Promise<GitHubDeleteRepositoryResult> {
    if (!nativeEnabled || !session) {
      throw new Error(t("account.deleteDesktopOnly"));
    }

    const result = await githubDeleteRepository(request);
    if (!result.deleted) return result;
    if (
      result.repositoryId !== request.repositoryId ||
      result.repositoryFullName !== request.repositoryFullName
    ) {
      throw new Error(t("account.deleteMismatch"));
    }

    repositoriesLoadGenerationRef.current += 1;
    const refreshed = (repositories ?? []).filter(
      (repository) =>
        repository.id !== result.repositoryId &&
        repository.fullName !== result.repositoryFullName,
    );
    setRepositories(refreshed);
    setRepositoriesError(null);
    onSessionChange({ ...session, repositoryCount: refreshed.length });
    return result;
  }

  function finishLinkRepository() {
    closeLinkRepository();
    closeDialog();
  }

  async function createGitHubRepository(
    request: GitHubCreateRepositoryRequest,
  ): Promise<RepositoryCreationOutcome> {
    if (!nativeEnabled || !session) {
      throw new Error(t("account.createDesktopOnly"));
    }

    const repository = await githubCreateRepository(request);
    let refreshWarning: string | undefined;

    try {
      const refreshed = deduplicateRepositories(await githubListRepositories());
      setRepositories(refreshed);
      setRepositoriesError(null);
      onSessionChange({ ...session, repositoryCount: refreshed.length });

      const createdIsVisible = refreshed.some(
        (item) => item.id === repository.id || item.fullName.toLocaleLowerCase() === repository.fullName.toLocaleLowerCase(),
      );
      if (!createdIsVisible) {
        refreshWarning = t("account.createdNotVisible");
      }
    } catch (error) {
      refreshWarning = t("account.createdListStale", { reason: errorMessage(error, t) });
    }

    return { repository, refreshWarning };
  }

  function showRepositories() {
    setTab("repositories");
    if (session?.installationCount === 0) {
      setRepositories([]);
      return;
    }
    if (repositories === null) void loadRepositories();
  }

  async function openWebPage(url: string) {
    if (!nativeEnabled) return;
    setProfileActionError(null);
    try {
      await openExternalUrl(url);
    } catch (error) {
      setProfileActionError(errorMessage(error, t));
    }
  }

  async function logout() {
    if (!nativeEnabled || logoutLoading) return;
    setLogoutLoading(true);
    setProfileActionError(null);
    try {
      await githubLogout();
      invalidateLoginAttempt();
      setRepositories(null);
      repositoriesLoadingRef.current = false;
      setRepositoryQuery("");
      setAccessFilter("all");
      setLogoutConfirmation(false);
      setTab("profile");
      onSessionChange(null);
    } catch (error) {
      setProfileActionError(t("account.signOutFailed", { reason: errorMessage(error, t) }));
    } finally {
      setLogoutLoading(false);
    }
  }

  function closeDialog() {
    invalidateLoginAttempt();
    onClose();
  }

  function renderSignedOut() {
    if (loginRequest) {
      const expired = loginPhase === "expired" || (timestamp(loginRequest.expiresAt) ?? Infinity) <= now;
      const countdown = remainingTime(loginRequest.expiresAt, now);
      return (
        <div className="device-flow">
          <div className="device-flow-heading">
            <span className="github-hero-icon github-hero-icon--small"><KeyRound aria-hidden="true" /></span>
            <div>
              <h3>{t("account.deviceTitle")}</h3>
              <p>{t("account.deviceSubtitle")}</p>
            </div>
          </div>

          <div className="device-code-card">
            <label htmlFor="github-device-code">{t("account.codeLabel")}</label>
            <div className="device-code-row">
              <input
                ref={codeInputRef}
                id="github-device-code"
                value={loginRequest.userCode}
                readOnly
                spellCheck={false}
                aria-label={t("account.codeAria")}
              />
              <button type="button" className="button button--secondary" onClick={() => void copyUserCode()}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {t(copied ? "account.copied" : "account.copy")}
              </button>
            </div>
            <div className="device-code-meta">
              <span>
                <Clock3 aria-hidden="true" />{" "}
                {countdown
                  ? t("account.expiresIn", { time: countdown })
                  : t("account.limitedTime")}
              </span>
              <span title={loginRequest.verificationUri}>{loginRequest.verificationUri}</span>
            </div>
          </div>

          <button
            type="button"
            className="button button--primary device-open-button"
            onClick={() => void openVerificationPage()}
            disabled={expired}
          >
            <ExternalLink aria-hidden="true" />
            {t("account.copyAndOpen")}
          </button>

          <div
            className={`device-poll-status ${loginPhase === "error" || expired ? "is-error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {loginPhase === "waiting" || loginPhase === "slowDown" ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <AlertCircle aria-hidden="true" />
            )}
            <span>{expired ? t("account.codeExpiredShort") : loginMessage}</span>
          </div>

          <div className="device-flow-actions">
            <button type="button" className="button button--secondary" onClick={cancelLogin}>
              {t("account.cancelLogin")}
            </button>
            {(loginPhase === "error" || expired) && (
              <button type="button" className="button button--secondary-strong" onClick={() => void beginLogin()}>
                <RefreshCw aria-hidden="true" />
                {t("account.newCode")}
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="github-signed-out">
        <span className="github-hero-icon"><GitFork aria-hidden="true" /></span>
        <h3>{t("account.connectTitle")}</h3>
        <p>{t("account.connectBody")}</p>

        {!nativeEnabled && (
          <div className="github-browser-notice" role="status">
            <AlertCircle aria-hidden="true" />
            <div>
              <strong>{t("account.browserNoticeTitle")}</strong>
              <span>{t("account.browserNoticeBody")}</span>
            </div>
          </div>
        )}

        {loginPhase === "error" && loginMessage && (
          <div className="inline-error" role="alert">
            <AlertCircle aria-hidden="true" />
            <div><strong>{t("account.loginNotStarted")}</strong><p>{loginMessage}</p></div>
          </div>
        )}

        <button
          type="button"
          className="button button--primary github-connect-button"
          onClick={() => void beginLogin()}
          disabled={!nativeEnabled || loginPhase === "starting"}
        >
          {loginPhase === "starting" ? <LoaderCircle className="spin" aria-hidden="true" /> : <GitFork aria-hidden="true" />}
          {t(loginPhase === "starting" ? "account.requestingCode" : "account.signIn")}
        </button>
        <small className="github-login-footnote">{t("account.tokenFootnote")}</small>
      </div>
    );
  }

  function renderProfile() {
    if (!session) return null;
    const expiry = formatExpiry(session.expiresAt, locale);
    return (
      <div className="github-profile-view">
        <section className="github-profile-card">
          <img src={session.user.avatarUrl} alt="" referrerPolicy="no-referrer" />
          <div className="github-profile-identity">
            <span className="github-session-badge">
              <ShieldCheck aria-hidden="true" />
              {t(session.persisted ? "account.sessionSaved" : "account.sessionTemporary")}
            </span>
            <h3>{session.user.name || session.user.login}</h3>
            <span className="github-login">@{session.user.login}</span>
            {session.user.bio && <p>{session.user.bio}</p>}
          </div>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => void openWebPage(session.user.htmlUrl)}
          >
            <ExternalLink aria-hidden="true" />
            {t("account.profileButton")}
          </button>
        </section>

        <section className="github-stats" aria-label={t("account.statsAria")}>
          <div><FolderGit2 aria-hidden="true" /><strong>{session.repositoryCount}</strong><span>{t("account.reposAccessible")}</span></div>
          <div><Building2 aria-hidden="true" /><strong>{session.installationCount}</strong><span>{t("account.appInstallations")}</span></div>
          <div><Users aria-hidden="true" /><strong>{session.user.followers}</strong><span>{t("account.followers")}</span></div>
          <div><UserRound aria-hidden="true" /><strong>{session.user.following}</strong><span>{t("account.following")}</span></div>
        </section>

        {session.installationCount === 0 && (
          <div className="github-installation-warning" role="status">
            <ShieldAlert aria-hidden="true" />
            <div>
              <strong>{t("account.noInstallationTitle")}</strong>
              <p>{t("account.noInstallationBody")}</p>
              <button type="button" className="button button--secondary button--small" onClick={() => void openWebPage("https://github.com/settings/installations")}>
                <ExternalLink aria-hidden="true" /> {t("account.manageInstallations")}
              </button>
            </div>
          </div>
        )}

        <section className="github-profile-details">
          <h4>{t("account.detailsTitle")}</h4>
          <dl>
            <div><dt>{t("account.publicRepos")}</dt><dd>{session.user.publicRepos}</dd></div>
            <div><dt>{t("account.privateRepos")}</dt><dd>{session.user.totalPrivateRepos ?? "—"}</dd></div>
            <div><dt>{t("account.persistence")}</dt><dd>{t(session.persisted ? "account.credentialsSaved" : "account.currentSessionOnly")}</dd></div>
            {expiry && <div><dt>{t("account.expiry")}</dt><dd>{expiry}</dd></div>}
          </dl>
        </section>

        {profileActionError && (
          <div className="inline-error" role="alert">
            <AlertCircle aria-hidden="true" />
            <div><strong>{t("account.actionFailed")}</strong><p>{profileActionError}</p></div>
          </div>
        )}

        <div className="github-logout-area">
          {!logoutConfirmation ? (
            <button type="button" className="button button--text-danger" onClick={() => setLogoutConfirmation(true)}>
              <LogOut aria-hidden="true" />
              {t("account.signOutAccount")}
            </button>
          ) : (
            <div className="github-logout-confirmation" role="alert">
              <div>
                <strong>{t("account.signOutQuestion", { login: session.user.login })}</strong>
                <span>{t("account.signOutBody")}</span>
              </div>
              <button type="button" className="button button--secondary" onClick={() => setLogoutConfirmation(false)} disabled={logoutLoading}>{t("common.cancel")}</button>
              <button type="button" className="button button--danger" onClick={() => void logout()} disabled={logoutLoading}>
                {logoutLoading && <LoaderCircle className="spin" aria-hidden="true" />}
                {t("account.signOut")}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderRepositories() {
    if (!session) return null;
    return (
      <div className="github-repositories-view">
        <div className="github-repository-toolbar">
          <label className="search-box github-repository-search">
            <Search aria-hidden="true" />
            <span className="sr-only">{t("account.searchAria")}</span>
            <input
              type="search"
              value={repositoryQuery}
              onChange={(event) => setRepositoryQuery(event.currentTarget.value)}
              placeholder={t("account.searchPlaceholder")}
            />
            {repositoryQuery && (
              <button type="button" onClick={() => setRepositoryQuery("")} aria-label={t("account.clearSearch")}>
                <X aria-hidden="true" />
              </button>
            )}
          </label>
          <div className="segmented-control github-access-filter" aria-label={t("account.filterAria")}>
            <button type="button" className={accessFilter === "all" ? "is-active" : ""} onClick={() => setAccessFilter("all")}>{t("account.filterAll")}</button>
            <button type="button" className={accessFilter === "write" ? "is-active" : ""} onClick={() => setAccessFilter("write")}>{t("account.filterWrite")}</button>
            <button type="button" className={accessFilter === "read" ? "is-active" : ""} onClick={() => setAccessFilter("read")}>{t("account.filterRead")}</button>
          </div>
          <button
            type="button"
            className="button button--secondary github-link-repository-button"
            onClick={() => openLinkRepository()}
            disabled={
              !nativeEnabled ||
              session.installationCount === 0 ||
              repositoriesLoading ||
              repositories === null ||
              writableRepositoryCount === 0
            }
            title={
              session.installationCount === 0
                ? t("account.installAppFirst")
                : writableRepositoryCount === 0 && repositories !== null
                  ? t("account.noWritableRepository")
                  : !nativeEnabled
                    ? t("account.desktopOnly")
                    : undefined
            }
          >
            <Link2 aria-hidden="true" /> {t("account.linkFolder")}
          </button>
          <button
            type="button"
            className="button button--primary github-new-repository-button"
            onClick={openCreateRepository}
            disabled={!nativeEnabled}
            title={!nativeEnabled ? t("account.desktopOnly") : undefined}
          >
            <FolderPlus aria-hidden="true" /> {t("account.newRepository")}
          </button>
          <button
            type="button"
            className="icon-button icon-button--bordered"
            onClick={() => void loadRepositories()}
            disabled={repositoriesLoading}
            aria-label={t("account.refreshAria")}
          >
            <RefreshCw className={repositoriesLoading ? "spin" : ""} aria-hidden="true" />
          </button>
        </div>

        {session.installationCount === 0 ? (
          <div className="github-repositories-empty">
            <ShieldAlert aria-hidden="true" />
            <h3>{t("account.noInstallationsTitle")}</h3>
            <p>{t("account.noInstallationsBody")}</p>
            <button type="button" className="button button--secondary" onClick={() => void openWebPage("https://github.com/settings/installations")}>
              <ExternalLink aria-hidden="true" /> {t("account.manageInstallations")}
            </button>
          </div>
        ) : repositoriesLoading && repositories === null ? (
          <div className="loading-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /> {t("account.loadingRepositories")}</div>
        ) : repositoriesError ? (
          <div className="github-repositories-empty">
            <AlertCircle aria-hidden="true" />
            <h3>{t("account.repositoriesUnavailable")}</h3>
            <p>{repositoriesError}</p>
            <button type="button" className="button button--secondary" onClick={() => void loadRepositories()}>
              <RefreshCw aria-hidden="true" /> {t("account.retry")}
            </button>
          </div>
        ) : filteredRepositories.length === 0 ? (
          <div className="github-repositories-empty">
            <FolderGit2 aria-hidden="true" />
            <h3>{t(repositories?.length === 0 ? "account.noAccessibleTitle" : "account.noResultsTitle")}</h3>
            <p>{t(repositories?.length === 0 ? "account.noAccessibleBody" : "account.noResultsBody")}</p>
          </div>
        ) : (
          <div className="github-remote-list" role="list">
            <div className="github-remote-summary">
              <span>
                {t("account.listSummary", {
                  shown: filteredRepositories.length,
                  total: repositories?.length ?? 0,
                })}
              </span>
              {repositoriesLoading && <span><LoaderCircle className="spin" aria-hidden="true" /> {t("account.updating")}</span>}
            </div>
            {filteredRepositories.map((repository) => (
              <article className="github-remote-row" role="listitem" key={repository.id}>
                <span className="github-repo-icon"><FolderGit2 aria-hidden="true" /></span>
                <div className="github-repo-main">
                  <div className="github-repo-title">
                    <strong>{repository.fullName}</strong>
                    <span className={`github-visibility ${repository.private ? "is-private" : ""}`}>
                      {repository.private ? <Lock aria-hidden="true" /> : <Globe2 aria-hidden="true" />}
                      {t(repository.private ? "clone.private" : "clone.public")}
                    </span>
                  </div>
                  <span className="github-repo-branch"><GitBranch aria-hidden="true" />{repository.defaultBranch}</span>
                </div>
                <div className="github-repo-access">
                  <span className={repository.canPush ? "can-push" : "read-only"}>
                    {repository.canPush ? <ShieldCheck aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    {t(repository.canPush ? "account.accessWrite" : "account.accessRead")}
                  </span>
                  <span className={`github-local-status ${localRemoteNames.has(repository.fullName.toLocaleLowerCase()) ? "is-local" : ""}`}>
                    {localRemoteNames.has(repository.fullName.toLocaleLowerCase()) ? <Check aria-hidden="true" /> : <FolderGit2 aria-hidden="true" />}
                    {t(localRemoteNames.has(repository.fullName.toLocaleLowerCase()) ? "account.isLocal" : "account.notLocal")}
                  </span>
                  <small>{t("account.installationNumber", { id: repository.installationId })}</small>
                </div>
                <div className="github-repo-row-actions">
                  {repository.canPush && (
                    <button
                      type="button"
                      className="icon-button icon-button--ghost"
                      onClick={() => openLinkRepository(repository.id)}
                      aria-label={t("account.linkFolderTo", { repository: repository.fullName })}
                      title={t("account.linkLocalFolder")}
                    >
                      <Link2 aria-hidden="true" />
                    </button>
                  )}
                  {repository.canAdmin && (
                    <button
                      type="button"
                      className="icon-button icon-button--ghost github-delete-repository-action"
                      onClick={() => openDeleteRepository(repository)}
                      disabled={!nativeEnabled}
                      aria-label={t("account.deleteFromGitHub", { repository: repository.fullName })}
                      title={t(nativeEnabled ? "account.deleteRepository" : "account.desktopOnly")}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button icon-button--ghost"
                    onClick={() => void openWebPage(repository.htmlUrl)}
                    aria-label={t("account.openOnGitHub", { repository: repository.fullName })}
                  >
                    <ExternalLink aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="modal-backdrop">
        <section
          className="modal github-dialog"
          role="dialog"
          aria-modal="true"
          aria-hidden={
            createRepositoryOpen || linkRepositoryOpen || repositoryPendingDeletion
              ? true
              : undefined
          }
          aria-labelledby="github-dialog-title"
        >
        <header className="modal-header github-dialog-header">
          <div>
            <span className="eyebrow">{t("account.eyebrow")}</span>
            <h2 id="github-dialog-title">{t("account.title")}</h2>
            <p>
              {session
                ? t("account.connectedAs", { login: session.user.login })
                : t("account.signInSubtitle")}
            </p>
          </div>
          <button ref={closeButtonRef} type="button" className="icon-button icon-button--ghost" onClick={closeDialog} aria-label={t("account.close")}>
            <X aria-hidden="true" />
          </button>
        </header>

        {session && (
          <div className="github-tabs" role="tablist" aria-label={t("account.title")}>
            <button type="button" role="tab" aria-selected={tab === "profile"} className={tab === "profile" ? "is-active" : ""} onClick={() => setTab("profile")}>
              <UserRound aria-hidden="true" /> {t("account.tabProfile")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "repositories"} className={tab === "repositories" ? "is-active" : ""} onClick={showRepositories}>
              <FolderGit2 aria-hidden="true" /> {t("account.tabRepositories")} <span>{session.repositoryCount}</span>
            </button>
          </div>
        )}

        <div className="modal-body github-dialog-body">
          {!session ? renderSignedOut() : tab === "profile" ? renderProfile() : renderRepositories()}
        </div>
        </section>
      </div>
      {createRepositoryOpen && session && (
        <GitHubCreateRepositoryDialog
          ownerLogin={session.user.login}
          onClose={closeCreateRepository}
          onCreate={createGitHubRepository}
        />
      )}
      {linkRepositoryOpen && session && repositories && (
        <GitHubLinkRepositoryDialog
          repositories={repositories}
          localRepositories={localRepositories}
          initialRepositoryId={linkInitialRepositoryId}
          nativeEnabled={nativeEnabled}
          onClose={closeLinkRepository}
          onFinish={finishLinkRepository}
          onLinked={onRepositoryLinked}
        />
      )}
      {repositoryPendingDeletion && session && (
        <GitHubDeleteRepositoryDialog
          repository={repositoryPendingDeletion}
          localPaths={localRepositories
            .filter(
              (repository) =>
                remoteFullName(repository.remoteUrl) ===
                repositoryPendingDeletion.fullName.toLocaleLowerCase(),
            )
            .map((repository) => repository.path)}
          fallbackFocusRef={closeButtonRef}
          onClose={closeDeleteRepository}
          onDelete={deleteGitHubRepository}
        />
      )}
    </>
  );
}
