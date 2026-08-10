use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use url::Url;
use zeroize::Zeroizing;

use crate::errors::AppError;
use crate::github::GitAccessToken;
use crate::models::{
    BranchInfo, BranchList, CommitEntry, CommitRequest, ConflictAction, ConflictState, DiffResult,
    FileChange, GitHubCloneRepositoryRequest, GitHubCloneRepositoryResult,
    GitHubLinkRepositoryRequest, GitHubLinkRepositoryResult, HistoryResult, HistoryScope,
    OperationResult, PendingOperation, PullStrategy, RemoteInfo, RepositoryInfo, StashAction,
    StashEntry,
};

const MAX_DIFF_BYTES: usize = 350_000;
const MAX_LOG_BYTES: usize = 16_000;
const MAX_FILE_OPERATION_PATHS: usize = 512;
const MAX_FILE_OPERATION_ARGUMENT_BYTES: usize = 24_000;
const LEGACY_GITHUB_ASKPASS_MODE_ENV: &str = "MULTI_REPO_MANAGER_GITHUB_ASKPASS";
const GITHUB_ASKPASS_ENDPOINT_ENV: &str = "RUBYREPO_ASKPASS_ENDPOINT";
const GITHUB_ASKPASS_NONCE_ENV: &str = "RUBYREPO_ASKPASS_NONCE";
const ASKPASS_PROTOCOL_MAGIC: &[u8; 8] = b"MRMAP01\0";
const ASKPASS_NONCE_BYTES: usize = 32;
const ASKPASS_MAX_TOKEN_BYTES: usize = 8_192;
/// Grace period past the command deadline during which the broker keeps
/// listening.
///
/// The broker used to live a fixed 120 seconds while a network operation can
/// last 300: a slow fetch — big repository or weak connection — that got round
/// to asking for credentials after the second minute found the channel already
/// closed and failed to authenticate. Precisely in the condition where the user
/// most needs it to work. The deadline now derives from the command's, so the
/// two can no longer diverge.
const ASKPASS_SERVER_GRACE: Duration = Duration::from_secs(30);
const ASKPASS_IO_TIMEOUT: Duration = Duration::from_millis(500);
const ASKPASS_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const ASKPASS_MAX_ATTEMPTS: usize = 32;
/// Deadlines past which the Git process is killed. Without them a `fetch` on a
/// half-open connection blocks the worker thread forever: the user is left with
/// every button disabled and the only way out is closing the app, which on top
/// of that leaves the Git process orphaned.
const LOCAL_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
const NETWORK_COMMAND_TIMEOUT: Duration = Duration::from_secs(300);
const CHILD_POLL_INTERVAL: Duration = Duration::from_millis(50);
/// Thresholds that make Git itself abort stalled HTTP transfers, before the
/// outer deadline even fires: under 1 KB/s for 30 seconds the connection is
/// considered dead.
/// Message of the conflict on the `origin` remote, exposed as a constant so the
/// command layer can recognise it and give it a structured code. The frontend
/// used to intercept it with a regex over prose, which broke in silence at every
/// rewording.
pub(crate) const ORIGIN_CONFLICT_MESSAGE: &str =
    "The repository already has a different origin remote. No configuration was changed.";
pub(crate) const ORIGIN_CONFLICT_MESSAGE_ID: &str = "link.originConflictError";
const HTTP_LOW_SPEED_LIMIT: &str = "http.lowSpeedLimit=1000";
const HTTP_LOW_SPEED_TIME: &str = "http.lowSpeedTime=30";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const DISABLED_GIT_HOOKS_PATH: &str = "NUL";
#[cfg(not(target_os = "windows"))]
const DISABLED_GIT_HOOKS_PATH: &str = "/dev/null";

#[derive(Debug, Default)]
struct ParsedStatus {
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ValidatedGitHubRemote {
    full_name: String,
    clone_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct UpstreamTarget {
    remote: String,
    remote_ref: String,
    tracking_ref: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AskpassPromptKind {
    Username,
    Password,
}

struct AskpassClientConfig {
    endpoint: String,
    nonce: String,
}

struct AskpassBroker {
    config: AskpassClientConfig,
    cancel: Option<Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

/// Process-wide cooperative cancellation state for the cancellable flows.
///
/// A plain boolean used to be cleared by every command at startup. That made a
/// concurrent read (`diff`, history, branches) able to revive a batch the user
/// had just cancelled. Counting active cancellable operations gives the flag a
/// lifetime: a late cancel cannot poison the next command, and a second active
/// flow never clears the first one's request.
struct CancellationState {
    active: Mutex<usize>,
    requested: AtomicBool,
}

impl CancellationState {
    const fn new() -> Self {
        Self {
            active: Mutex::new(0),
            requested: AtomicBool::new(false),
        }
    }

    fn begin(&self) -> OperationGuard<'_> {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *active == 0 {
            self.requested.store(false, Ordering::SeqCst);
        }
        *active += 1;
        OperationGuard { state: self }
    }

    fn request_cancel(&self) {
        let active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *active != 0 {
            self.requested.store(true, Ordering::SeqCst);
        }
    }

    fn cancel_requested(&self) -> bool {
        self.requested.load(Ordering::SeqCst)
    }
}

#[must_use = "the guard must live for the whole cancellable operation"]
pub(crate) struct OperationGuard<'a> {
    state: &'a CancellationState,
}

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        let mut active = self
            .state
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *active -= 1;
        if *active == 0 {
            self.state.requested.store(false, Ordering::SeqCst);
        }
    }
}

static CANCELLATION: CancellationState = CancellationState::new();

pub(crate) fn begin_operation() -> OperationGuard<'static> {
    CANCELLATION.begin()
}

pub(crate) fn request_cancel() {
    CANCELLATION.request_cancel();
}

pub(crate) fn cancel_requested() -> bool {
    CANCELLATION.cancel_requested()
}

/// Outcome given to the repositories that cancellation prevented from being
/// processed: returning one for each keeps the correspondence between requests
/// and outcomes that the frontend expects.
/// Maximum number of repositories processed at the same time.
///
/// Not the number of cores: the bottleneck is the network and starting the
/// processes, not the CPU. A low cap keeps the load on Git and on the remote
/// server predictable, and avoids opening dozens of connections at once.
const MAX_CONCURRENT_REPOSITORIES: usize = 4;

/// Runs the operation over several repositories in parallel, preserving the
/// order of the results and reporting progress as they finish.
///
/// The repositories are independent of one another: each has its own Git
/// process, its own askpass broker on a different ephemeral port, and no shared
/// state. The order of completion is not the order of departure, which is why
/// results are placed at their original position instead of appended.
fn run_over_repositories<T, R>(
    items: Vec<T>,
    run: &(dyn Fn(T) -> R + Sync),
    on_progress: &(dyn Fn(usize, usize, &R) + Sync),
) -> Vec<R>
where
    T: Send,
    R: Send,
{
    let total = items.len();
    if total <= 1 {
        // No gain from parallelism, and one fewer path to get wrong.
        return items
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let result = run(item);
                on_progress(index + 1, total, &result);
                result
            })
            .collect();
    }

    let pending: Vec<Mutex<Option<T>>> = items
        .into_iter()
        .map(|item| Mutex::new(Some(item)))
        .collect();
    let slots: Vec<Mutex<Option<R>>> = (0..total).map(|_| Mutex::new(None)).collect();
    let next = AtomicUsize::new(0);
    let completed = AtomicUsize::new(0);
    let workers = total.min(MAX_CONCURRENT_REPOSITORIES);

    thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let index = next.fetch_add(1, Ordering::SeqCst);
                if index >= total {
                    break;
                }

                let Some(item) = pending[index].lock().ok().and_then(|mut slot| slot.take()) else {
                    continue;
                };
                let result = run(item);

                let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                on_progress(done, total, &result);
                if let Ok(mut slot) = slots[index].lock() {
                    *slot = Some(result);
                }
            });
        }
    });

    // An empty slot is reachable only if `run` panicked: tokio turns that into
    // a command error anyway, and skipping the row is better than returning
    // results misaligned with the requests.
    slots
        .into_iter()
        .filter_map(|slot| slot.into_inner().ok().flatten())
        .collect()
}

/// Outcome codes that travel in `OperationResult.code`. They are a contract
/// towards the frontend: they must stay stable even if the messages change.
pub(crate) const OPERATION_OK: &str = "ok";
pub(crate) const OPERATION_FAILED: &str = "failed";
pub(crate) const OPERATION_CANCELLED: &str = "cancelled";
pub(crate) const OPERATION_UNAVAILABLE: &str = "unavailable";

/// Outcome for a repository that is no longer reachable on disk. It lives here,
/// and not in the command layer, to reuse the same `OperationResult` shape every
/// other operation produces.
pub(crate) fn unavailable_result(
    repo_path: &str,
    operation: &str,
    reason: &str,
) -> OperationResult {
    let mut result = failure(
        repo_path,
        operation,
        format!("The repository is no longer reachable: {reason}"),
    )
    .translated("outcome.unavailable")
    .with("reason", reason);
    result.code = OPERATION_UNAVAILABLE.to_string();
    result
}

fn cancelled(repo_path: &str, operation: &str) -> OperationResult {
    let mut result = failure(
        repo_path,
        operation,
        "The operation was cancelled before it reached this repository.",
    )
    .translated("outcome.cancelled");
    result.code = OPERATION_CANCELLED.to_string();
    result
}

/// Waits for the process to end within a deadline, killing it if it goes past.
///
/// stdout and stderr are drained on two dedicated threads: `try_wait` alone does
/// not read the pipes, and a process that fills their buffer would stay blocked
/// writing while we wait for it to finish — a perfect deadlock. When the pipes
/// close the two readers end on their own, so after `kill` the `join` cannot
/// hang.
fn wait_with_deadline(child: Child, timeout: Duration) -> Result<Output, AppError> {
    wait_with_deadline_until(child, timeout, &cancel_requested)
}

/// Variant with the cancellation predicate injected. It exists because the real
/// flag is global to the process: a test that raised it would fail the parallel
/// tests that actually run Git.
fn wait_with_deadline_until(
    mut child: Child,
    timeout: Duration,
    cancelled: &dyn Fn() -> bool,
) -> Result<Output, AppError> {
    let mut stdout = child.stdout.take().ok_or_else(|| {
        AppError::translated(
            "internal",
            "git.stdoutUnavailable",
            "The output of Git could not be read.",
        )
    })?;
    let mut stderr = child.stderr.take().ok_or_else(|| {
        AppError::translated(
            "internal",
            "git.stderrUnavailable",
            "The error output of Git could not be read.",
        )
    })?;

    let stdout_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        buffer
    });
    let stderr_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr.read_to_end(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(error) => {
                return Err(AppError::translated(
                    "internal",
                    "git.waitFailed",
                    format!("Git could not be waited for: {error}"),
                )
                .with("reason", error.to_string()))
            }
        }

        if cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            drop(stdout_reader);
            drop(stderr_reader);
            return Err(AppError::translated(
                "cancelled",
                "git.cancelled",
                "Operation cancelled: Git was stopped.",
            ));
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            // The readers are deliberately abandoned rather than awaited:
            // `kill` ends the direct child, but a grandchild (a credential
            // helper, an `ssh`) may outlive it holding the pipe open, and a
            // `join` here would hang until its death — exactly the block the
            // deadline exists to remove. The two threads end on their own when
            // the pipes close and hold no lock.
            drop(stdout_reader);
            drop(stderr_reader);
            return Err(AppError::translated(
                "timeout",
                "git.timedOut",
                format!(
                    "Git did not answer within {} seconds and was stopped.",
                    timeout.as_secs()
                ),
            )
            .with("seconds", timeout.as_secs().to_string()));
        }

        thread::sleep(CHILD_POLL_INTERVAL);
    };

    let stdout = stdout_reader.join().map_err(|_| {
        AppError::translated(
            "internal",
            "git.stdoutInterrupted",
            "Reading the output of Git was interrupted.",
        )
    })?;
    let stderr = stderr_reader.join().map_err(|_| {
        AppError::translated(
            "internal",
            "git.stderrInterrupted",
            "Reading the error output of Git was interrupted.",
        )
    })?;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

#[cfg(target_os = "windows")]
fn new_git_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(target_os = "windows"))]
fn new_git_command(executable: &Path) -> Command {
    Command::new(executable)
}

impl AskpassBroker {
    fn start(token: &GitAccessToken, command_timeout: Duration) -> Result<Self, AppError> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| {
            AppError::translated(
                "internal",
                "askpass.initFailed",
                "The local GitHub channel could not be initialised.",
            )
        })?;
        listener.set_nonblocking(true).map_err(|_| {
            AppError::translated(
                "internal",
                "askpass.protectFailed",
                "The local GitHub channel could not be protected.",
            )
        })?;
        let endpoint = listener
            .local_addr()
            .map_err(|_| {
                AppError::translated(
                    "internal",
                    "askpass.addressFailed",
                    "The address of the local GitHub channel could not be determined.",
                )
            })?
            .to_string();

        let mut nonce = [0_u8; ASKPASS_NONCE_BYTES];
        getrandom::fill(&mut nonce).map_err(|_| {
            AppError::translated(
                "internal",
                "askpass.nonceFailed",
                "A secure GitHub session could not be generated.",
            )
        })?;
        let nonce_hex = encode_hex(&nonce);
        let token = token.clone();
        let deadline = command_timeout.saturating_add(ASKPASS_SERVER_GRACE);
        let (cancel_tx, cancel_rx) = mpsc::channel();
        let server_thread = thread::Builder::new()
            .name("github-askpass-broker".to_string())
            .spawn(move || serve_askpass(listener, cancel_rx, nonce, token, deadline))
            .map_err(|_| {
                AppError::translated(
                    "internal",
                    "askpass.startFailed",
                    "The local GitHub channel could not be started.",
                )
            })?;

        Ok(Self {
            config: AskpassClientConfig {
                endpoint,
                nonce: nonce_hex,
            },
            cancel: Some(cancel_tx),
            thread: Some(server_thread),
        })
    }
}

impl Drop for AskpassBroker {
    fn drop(&mut self) {
        self.cancel.take();
        if let Some(server_thread) = self.thread.take() {
            let _ = server_thread.join();
        }
    }
}

#[derive(Debug, Clone)]
pub struct GitClient {
    executable: PathBuf,
}

impl GitClient {
    pub fn discover() -> Result<Self, AppError> {
        let mut candidates: Vec<PathBuf> = Vec::new();

        // The old name is still honoured: it is documented, and someone may
        // have set it in their environment before the app was renamed.
        for variable in ["RUBYREPO_GIT_PATH", "MULTI_REPO_MANAGER_GIT_PATH"] {
            if let Some(configured) = std::env::var_os(variable) {
                candidates.push(PathBuf::from(configured));
            }
        }

        candidates.push(PathBuf::from("git"));

        #[cfg(target_os = "windows")]
        {
            candidates.push(PathBuf::from(r"C:\Program Files\Git\cmd\git.exe"));
            candidates.push(PathBuf::from(r"C:\Program Files\Git\bin\git.exe"));
        }

        #[cfg(target_os = "macos")]
        {
            candidates.push(PathBuf::from("/usr/bin/git"));
            candidates.push(PathBuf::from("/opt/homebrew/bin/git"));
            candidates.push(PathBuf::from("/usr/local/bin/git"));
        }

        #[cfg(target_os = "linux")]
        {
            candidates.push(PathBuf::from("/usr/bin/git"));
            candidates.push(PathBuf::from("/usr/local/bin/git"));
        }

        let mut seen = HashSet::new();
        for candidate in candidates {
            if !seen.insert(candidate.clone()) {
                continue;
            }

            let mut command = new_git_command(&candidate);

            if command
                .arg("--version")
                .output()
                .is_ok_and(|output| output.status.success())
            {
                return Ok(Self {
                    executable: candidate,
                });
            }
        }

        Err(AppError::translated(
            "notFound",
            "git.notFound",
            "Git was not found. Install Git or set RUBYREPO_GIT_PATH.",
        ))
    }

    fn command(
        &self,
        cwd: &Path,
        args: &[OsString],
        github_token: Option<&GitAccessToken>,
        timeout: Duration,
    ) -> Result<Output, AppError> {
        if !cwd.is_dir() {
            return Err(AppError::translated(
                "notFound",
                "git.folderMissing",
                format!("The folder does not exist: {}", cwd.display()),
            )
            .with("path", cwd.display().to_string()));
        }

        let askpass_broker = github_token
            .map(|token| AskpassBroker::start(token, timeout))
            .transpose()?;
        let mut command = new_git_command(&self.executable);
        command
            .arg("--no-pager")
            .arg("-c")
            .arg("core.fsmonitor=false")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_INDEX_FILE")
            .env_remove("GIT_COMMON_DIR")
            .env_remove("GIT_OBJECT_DIRECTORY")
            .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
            .env_remove("GIT_NAMESPACE")
            .env_remove("GIT_CONFIG")
            .env_remove("GIT_CONFIG_PARAMETERS")
            .env_remove("GIT_CONFIG_COUNT");

        if let Some(broker) = askpass_broker.as_ref() {
            let askpass = std::env::current_exe().map_err(|error| {
                AppError::translated(
                    "internal",
                    "askpass.configureFailed",
                    format!("GitHub authentication could not be set up: {error}"),
                )
                .with("reason", error.to_string())
            })?;
            command
                .env("GIT_ASKPASS", askpass)
                .env(GITHUB_ASKPASS_ENDPOINT_ENV, &broker.config.endpoint)
                .env(GITHUB_ASKPASS_NONCE_ENV, &broker.config.nonce)
                .env_remove(LEGACY_GITHUB_ASKPASS_MODE_ENV)
                .env("GCM_INTERACTIVE", "Never")
                .env("GIT_TRACE_REDACT", "1")
                .env_remove("GIT_EXEC_PATH")
                .env_remove("GIT_CURL_VERBOSE")
                .env_remove("GIT_TRACE")
                .env_remove("GIT_TRACE_PACKET")
                .env_remove("GIT_TRACE_CURL")
                .env_remove("GIT_TRACE_CURL_NO_DATA")
                .env_remove("GIT_TRACE2")
                .env_remove("GIT_TRACE2_EVENT")
                .env_remove("GIT_TRACE2_PERF")
                .env_remove("GIT_SSL_NO_VERIFY")
                .env_remove("GIT_SSL_CAINFO")
                .env_remove("GIT_SSL_CAPATH")
                .env_remove("GIT_SSL_CIPHER_LIST")
                .env_remove("GIT_SSL_VERSION")
                .env_remove("GIT_SSL_CERT")
                .env_remove("GIT_SSL_KEY")
                .env_remove("GIT_SSL_CERT_PASSWORD_PROTECTED")
                .env_remove("GIT_PROXY_COMMAND")
                .env_remove("CURL_CA_BUNDLE")
                .env_remove("SSL_CERT_FILE")
                .env_remove("SSL_CERT_DIR")
                .env_remove("GIT_CONFIG_SYSTEM")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", DISABLED_GIT_HOOKS_PATH)
                .env_remove("HTTP_PROXY")
                .env_remove("HTTPS_PROXY")
                .env_remove("ALL_PROXY")
                .env_remove("http_proxy")
                .env_remove("https_proxy")
                .env_remove("all_proxy");
        } else {
            command
                .env_remove("GIT_ASKPASS")
                .env_remove(LEGACY_GITHUB_ASKPASS_MODE_ENV)
                .env_remove(GITHUB_ASKPASS_ENDPOINT_ENV)
                .env_remove(GITHUB_ASKPASS_NONCE_ENV);
        }

        // A null stdin, as `Command::output()` used to do: Git must not be able
        // to inherit a terminal and sit waiting on a prompt.
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                AppError::translated(
                    "internal",
                    "git.startFailed",
                    format!("Git could not be started: {error}"),
                )
                .with("reason", error.to_string())
            });

        let output = child.and_then(|child| wait_with_deadline(child, timeout));
        drop(askpass_broker);
        output
    }

    fn run(&self, cwd: &Path, args: &[&str]) -> Result<String, AppError> {
        let args = args.iter().map(OsString::from).collect::<Vec<_>>();
        self.run_owned(cwd, &args)
    }

    fn run_owned(&self, cwd: &Path, args: &[OsString]) -> Result<String, AppError> {
        self.run_owned_with_auth(cwd, args, None, LOCAL_COMMAND_TIMEOUT)
    }

    fn run_owned_with_auth(
        &self,
        cwd: &Path,
        args: &[OsString],
        github_token: Option<&GitAccessToken>,
        timeout: Duration,
    ) -> Result<String, AppError> {
        let output = self.command(cwd, args, github_token, timeout)?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }

        Err(git_output_error(&output))
    }

    fn run_network(
        &self,
        cwd: &Path,
        args: &[&str],
        github_token: Option<&GitAccessToken>,
    ) -> Result<String, AppError> {
        let mut owned = Vec::with_capacity(args.len() + 12);
        // Applies to every HTTP remote, not only the authenticated ones: it is
        // the defence closest to the network, the outer one being the deadline.
        owned.extend([
            OsString::from("-c"),
            OsString::from(HTTP_LOW_SPEED_LIMIT),
            OsString::from("-c"),
            OsString::from(HTTP_LOW_SPEED_TIME),
        ]);
        owned.extend(network_hardening_args(github_token.is_some()));
        owned.extend(args.iter().map(OsString::from));

        if github_token.is_some() {
            self.ensure_safe_local_network_config(cwd)?;
        }
        self.run_owned_with_auth(cwd, &owned, github_token, NETWORK_COMMAND_TIMEOUT)
    }

    fn remote_urls_checked(
        &self,
        cwd: &Path,
        remote: &str,
        for_push: bool,
    ) -> Result<Vec<String>, AppError> {
        let mut args = vec![
            OsString::from("remote"),
            OsString::from("get-url"),
            OsString::from("--all"),
        ];
        if for_push {
            args.push(OsString::from("--push"));
        }
        args.push(OsString::from("--"));
        args.push(OsString::from(remote));

        let output = self.command(cwd, &args, None, LOCAL_COMMAND_TIMEOUT)?;
        if !output.status.success() {
            return Err(git_output_error(&output));
        }

        Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect())
    }

    fn remote_urls(&self, cwd: &Path, remote: &str, for_push: bool) -> Vec<String> {
        self.remote_urls_checked(cwd, remote, for_push)
            .unwrap_or_default()
    }

    fn ensure_safe_local_network_config(&self, cwd: &Path) -> Result<(), AppError> {
        for scope in ["--local", "--worktree"] {
            let names = self.run(
                cwd,
                &["config", scope, "--no-includes", "--name-only", "--list"],
            )?;
            let dangerous = names.lines().any(|name| {
                let name = name.trim().to_ascii_lowercase();
                name.starts_with("http.")
                    || name.starts_with("url.")
                    || name.starts_with("credential.")
                    || name.starts_with("include.")
                    || name.starts_with("includeif.")
                    || (name.starts_with("remote.")
                        && [".vcs", ".uploadpack", ".receivepack", ".proxy", ".mirror"]
                            .iter()
                            .any(|suffix| name.ends_with(suffix)))
            });
            if dangerous {
                return Err(AppError::translated(
                    "forbidden",
                    "git.unsafeNetworkConfig",
                    "GitHub authentication blocked: the repository has an unsafe local network configuration. Remove it, or use the system Git credentials.",
                ));
            }
        }
        Ok(())
    }

    fn upstream_target(
        &self,
        cwd: &Path,
        branch: &str,
    ) -> Result<Option<UpstreamTarget>, AppError> {
        let branch_ref = format!("refs/heads/{branch}");
        let args = vec![
            OsString::from("for-each-ref"),
            OsString::from("--count=1"),
            OsString::from("--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)"),
            OsString::from("--"),
            OsString::from(branch_ref),
        ];
        let output = self.run_owned(cwd, &args)?;
        if output.is_empty() || output.bytes().all(|byte| byte == 0) {
            return Ok(None);
        }

        let fields = output.split('\0').collect::<Vec<_>>();
        if fields.len() != 3 || fields.iter().any(|field| field.is_empty()) {
            return Err(AppError::translated(
                "internal",
                "git.invalidUpstreamConfig",
                "The upstream configuration of the branch is not valid.",
            ));
        }
        let remotes = self.run(cwd, &["remote"])?;
        if !remotes.lines().any(|remote| remote == fields[0]) {
            return Err(AppError::translated(
                "internal",
                "git.upstreamNotConfigured",
                "The upstream of the branch does not belong to a configured remote.",
            ));
        }
        for reference in [fields[1], fields[2]] {
            let args = vec![
                OsString::from("check-ref-format"),
                OsString::from(reference),
            ];
            self.run_owned(cwd, &args).map_err(|_| {
                AppError::translated(
                    "internal",
                    "git.invalidUpstreamRef",
                    "The upstream configuration contains an invalid reference.",
                )
            })?;
        }

        Ok(Some(UpstreamTarget {
            remote: fields[0].to_string(),
            remote_ref: fields[1].to_string(),
            tracking_ref: fields[2].to_string(),
        }))
    }

    fn github_fetch_refspec(&self, cwd: &Path, remote: &str) -> Result<String, AppError> {
        let namespace = format!("refs/remotes/{remote}/__rubyrepo_check__");
        let args = vec![
            OsString::from("check-ref-format"),
            OsString::from(namespace),
        ];
        self.run_owned(cwd, &args).map_err(|_| {
            AppError::translated(
                "invalidRequest",
                "remote.nameNotSafe",
                "The remote name cannot be used safely.",
            )
        })?;
        Ok(format!("+refs/heads/*:refs/remotes/{remote}/*"))
    }

    fn validate_repository(&self, repo_path: &str) -> Result<PathBuf, AppError> {
        let path = PathBuf::from(repo_path);
        let canonical = path.canonicalize().map_err(|error| {
            AppError::translated(
                "invalidRequest",
                "error.invalidPath",
                format!("Invalid path '{}': {error}", path.display()),
            )
            .with("path", path.display().to_string())
            .with("reason", error.to_string())
        })?;

        let inside = self.run(&canonical, &["rev-parse", "--is-inside-work-tree"])?;
        if inside != "true" {
            return Err(AppError::translated(
                "invalidRequest",
                "git.notARepository",
                format!("Not a Git repository: {}", canonical.display()),
            )
            .with("path", canonical.display().to_string()));
        }

        Ok(canonical)
    }

    pub fn link_github_repository(
        &self,
        request: GitHubLinkRepositoryRequest,
    ) -> Result<GitHubLinkRepositoryResult, AppError> {
        let target = validate_github_remote(&request.repository_full_name, &request.clone_url)?;
        let requested_folder = PathBuf::from(&request.folder_path);
        let folder = requested_folder.canonicalize().map_err(|error| {
            AppError::translated(
                "invalidRequest",
                "link.folderUnreadable",
                format!(
                    "The folder '{}' could not be opened: {error}",
                    requested_folder.display()
                ),
            )
            .with("path", requested_folder.display().to_string())
            .with("reason", error.to_string())
        })?;
        if !folder.is_dir() {
            return Err(AppError::translated(
                "invalidRequest",
                "link.notAFolder",
                format!("The chosen path is not a folder: {}", folder.display()),
            )
            .with("path", folder.display().to_string()));
        }
        if folder.parent().is_none() || folder.file_name().is_none() {
            return Err(AppError::translated(
                "invalidRequest",
                "link.rootNotAllowed",
                "The root of the filesystem or of the volume cannot be linked as a repository.",
            ));
        }

        let git_metadata = folder.join(".git");
        let existing_git_metadata = match fs::symlink_metadata(&git_metadata) {
            Ok(metadata) => Some(metadata),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(AppError::translated(
                    "internal",
                    "link.metadataUnreadable",
                    format!("The Git metadata of the folder could not be checked: {error}"),
                )
                .with("reason", error.to_string()));
            }
        };
        let git_metadata_existed = existing_git_metadata.is_some();
        let existing_root = self.worktree_root(&folder)?;
        let initialized = match existing_root {
            Some(root) if root == folder => {
                if !existing_git_metadata
                    .as_ref()
                    .is_some_and(is_safe_git_metadata_directory)
                {
                    return Err(AppError::translated(
                        "invalidRequest",
                        "link.onlyPlainGitDirectory",
                        "Linking supports only repositories with a plain local .git directory; worktrees, submodules, symlinks and junctions are excluded.",
                    ));
                }
                false
            }
            Some(root) => {
                return Err(AppError::translated(
                    "invalidRequest",
                    "link.belongsToParent",
                    format!(
                        "The chosen folder already belongs to the parent repository '{}'. Select the repository root.",
                        root.display()
                    ),
                )
                .with("repository", root.display().to_string()));
            }
            None => {
                if git_metadata_existed {
                    return Err(AppError::translated(
                        "invalidRequest",
                        "link.brokenGitMetadata",
                        format!(
                            "The folder already has .git metadata, but it is not a valid Git repository: {}",
                            folder.display()
                        ),
                    )
                    .with("path", folder.display().to_string()));
                }
                // `.message` discards the identifier, and does so visibly:
                // this function still returns `String`, so there is nowhere to
                // put it. The line disappears when linking moves to `AppError`
                // too — a general `From<AppError> for String` would make the
                // same loss everywhere, and in silence.
                if let Some(parent_root) = ancestor_with_git_metadata(&folder)? {
                    return Err(AppError::translated(
                        "invalidRequest",
                        "link.insideRepository",
                        format!(
                            "The chosen folder is inside the repository '{}'. Creating a nested repository was blocked.",
                            parent_root.display()
                        ),
                    )
                    .with("repository", parent_root.display().to_string()));
                }

                self.run(&folder, &["init", "--quiet", "--template="])
                    .map_err(|error| {
                        AppError::translated(
                            "internal",
                            "link.initFailed",
                            format!(
                                "The Git repository could not be initialised: {}",
                                error.message
                            ),
                        )
                        .with("reason", error.message)
                    })?;
                let initialized_metadata =
                    fs::symlink_metadata(&git_metadata).map_err(|error| {
                        AppError::translated(
                            "internal",
                            "link.initNoVerifiableMetadata",
                            format!("Git init did not create verifiable .git metadata: {error}"),
                        )
                        .with("reason", error.to_string())
                    })?;
                if !is_safe_git_metadata_directory(&initialized_metadata) {
                    return Err(AppError::translated(
                        "internal",
                        "link.initUnsafeMetadata",
                        "Git init created .git metadata that is not local or not safe; linking was stopped.",
                    ));
                }
                let root = self.worktree_root(&folder)?.ok_or_else(|| {
                    AppError::translated(
                        "internal",
                        "link.initNoRepository",
                        "Git init finished without creating a valid repository.",
                    )
                })?;
                if root != folder {
                    return Err(AppError::translated(
                        "internal",
                        "link.initUnexpectedLocation",
                        format!(
                            "Git initialised a repository in an unexpected location: {}",
                            root.display()
                        ),
                    )
                    .with("path", root.display().to_string()));
                }
                true
            }
        };

        let remotes = self.run(&folder, &["remote"])?;
        let origin_exists = remotes.lines().any(|remote| remote.trim() == "origin");
        let (already_linked, remote_url) = if origin_exists {
            let fetch_urls =
                self.remote_urls_checked(&folder, "origin", false)
                    .map_err(|error| {
                        AppError::translated(
                            "internal",
                            "link.fetchUrlsUnreadable",
                            format!(
                                "The fetch URLs of origin could not be checked: {}",
                                error.message
                            ),
                        )
                        .with("reason", error.message)
                    })?;
            let push_urls = self
                .remote_urls_checked(&folder, "origin", true)
                .map_err(|error| {
                    AppError::translated(
                        "internal",
                        "link.pushUrlsUnreadable",
                        format!(
                            "The push URLs of origin could not be checked: {}",
                            error.message
                        ),
                    )
                    .with("reason", error.message)
                })?;
            if fetch_urls.is_empty()
                || push_urls.is_empty()
                || fetch_urls
                    .iter()
                    .chain(push_urls.iter())
                    .any(|url| !github_remote_matches(&target, url))
            {
                return Err(AppError::translated(
                    crate::errors::ORIGIN_CONFLICT_CODE,
                    ORIGIN_CONFLICT_MESSAGE_ID,
                    ORIGIN_CONFLICT_MESSAGE,
                ));
            }
            (true, fetch_urls[0].clone())
        } else {
            let add_result = self.run(
                &folder,
                &["remote", "add", "origin", target.clone_url.as_str()],
            );
            if let Err(error) = add_result {
                if initialized && !git_metadata_existed {
                    return match self.rollback_new_git_metadata(&folder) {
                        Ok(true) => Err(AppError::translated(
                            "internal",
                            "link.remoteFailedRolledBack",
                            format!(
                                "The origin remote could not be added: {error}. The Git initialisation was undone."
                            ),
                        )
                        .with("reason", error.message)),
                        Ok(false) => Err(AppError::translated(
                            "internal",
                            "link.remoteFailedNotRolledBack",
                            format!(
                                "The origin remote could not be added: {error}. The freshly created .git folder was left in place because the rollback was not verifiably safe."
                            ),
                        )
                        .with("reason", error.message)),
                        Err(rollback_error) => Err(AppError::translated(
                            "internal",
                            "link.remoteFailedRollbackFailed",
                            format!(
                                "The origin remote could not be added: {error}. Git had already been initialised and the safe rollback failed: {rollback_error}"
                            ),
                        )
                        .with("reason", error.message)
                        .with("rollbackReason", rollback_error.message)),
                    };
                }
                return Err(AppError::translated(
                    "internal",
                    "link.remoteFailed",
                    format!("The origin remote could not be added: {error}"),
                )
                .with("reason", error.message));
            }
            (false, target.clone_url.clone())
        };

        let repository = self.repository_info(&folder)?;
        Ok(GitHubLinkRepositoryResult {
            repository,
            initialized,
            already_linked,
            remote_name: "origin".to_string(),
            remote_url,
        })
    }

    /// Clones a GitHub repository into a folder the user picked.
    ///
    /// It was missing, and it was the biggest hole: the list showed the GitHub
    /// repositories marking which were already local, but there was no way to
    /// bring the others down — you had to clone by hand and then link.
    pub fn clone_github_repository(
        &self,
        request: GitHubCloneRepositoryRequest,
        github_token: &GitAccessToken,
    ) -> Result<GitHubCloneRepositoryResult, AppError> {
        let target = validate_github_remote(&request.repository_full_name, &request.clone_url)?;
        let requested_parent = PathBuf::from(&request.parent_path);
        let parent = requested_parent.canonicalize().map_err(|error| {
            AppError::translated(
                "invalidRequest",
                "clone.parentUnreadable",
                format!(
                    "The folder '{}' could not be opened: {error}",
                    requested_parent.display()
                ),
            )
            .with("path", requested_parent.display().to_string())
            .with("reason", error.to_string())
        })?;
        let destination =
            prepare_clone_destination(&parent, &target, request.folder_name.as_deref())?;

        let folder = destination
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                AppError::translated(
                    "invalidRequest",
                    "clone.destinationNameInvalid",
                    "The destination folder name is not valid.",
                )
            })?
            .to_string();

        self.run_clone(&parent, target.clone_url.as_str(), &folder, github_token)?;

        // The clone may have succeeded while leaving something unexpected
        // behind: start again from the disk rather than from the command's
        // outcome.
        let cloned = destination.canonicalize().map_err(|error| {
            AppError::translated(
                "internal",
                "clone.noUsableFolder",
                format!("The clone did not produce a usable folder: {error}"),
            )
            .with("reason", error.to_string())
        })?;
        let repository = self.repository_info(&cloned)?;
        let remote_urls = self.remote_urls_checked(&cloned, "origin", false)?;

        Ok(GitHubCloneRepositoryResult {
            folder_path: cloned.to_string_lossy().to_string(),
            repository,
            remote_name: "origin".to_string(),
            remote_url: remote_urls
                .first()
                .cloned()
                .unwrap_or_else(|| target.clone_url.clone()),
        })
    }

    /// Like `run_network`, but without inspecting the local configuration.
    ///
    /// That check queries `git config --local` in the current folder, and here
    /// the repository does not exist yet: there is no local configuration to
    /// defend against, and asking for it would only fail. The hardening of the
    /// command line stays identical.
    fn run_clone(
        &self,
        parent: &Path,
        clone_url: &str,
        folder: &str,
        github_token: &GitAccessToken,
    ) -> Result<String, AppError> {
        let mut args = vec![
            OsString::from("-c"),
            OsString::from(HTTP_LOW_SPEED_LIMIT),
            OsString::from("-c"),
            OsString::from(HTTP_LOW_SPEED_TIME),
        ];
        // A clone only ever talks to GitHub: the hardening applies in full.
        args.extend(network_hardening_args(true));
        args.extend([
            OsString::from("-c"),
            OsString::from("protocol.ext.allow=never"),
            OsString::from("clone"),
            OsString::from("--no-recurse-submodules"),
            OsString::from("--"),
            OsString::from(clone_url),
            OsString::from(folder),
        ]);
        args.shrink_to_fit();

        self.run_owned_with_auth(parent, &args, Some(github_token), NETWORK_COMMAND_TIMEOUT)
    }

    /// Lists the local branches and those that exist only on a remote.
    ///
    /// The latter are there because without them half the reason for looking at
    /// this list would be missing: taking a branch a colleague published that
    /// you do not have locally yet.
    pub fn list_branches(&self, repo_path: &str) -> Result<BranchList, AppError> {
        let path = self.validate_repository(repo_path)?;

        // `%(upstream:track)` is translated and would change shape with the
        // language Git speaks; `trackshort` does not. The fields are separated
        // by NUL because the commit subject is free text.
        const FORMAT: &str = "%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(upstream:trackshort)%00%(contents:subject)";

        let local = self.run(
            &path,
            &["for-each-ref", "--format", FORMAT, "--", "refs/heads/"],
        )?;

        let mut branches: Vec<BranchInfo> = Vec::new();
        let mut current = None;
        for line in local.lines().filter(|line| !line.trim().is_empty()) {
            let mut fields = line.split('\0');
            let head = fields.next().unwrap_or_default().trim();
            let name = fields.next().unwrap_or_default().to_string();
            if name.is_empty() {
                continue;
            }
            let upstream = fields.next().unwrap_or_default();
            let track = fields.next().unwrap_or_default();
            let subject = fields.next().unwrap_or_default().to_string();

            let is_current = head == "*";
            if is_current {
                current = Some(name.clone());
            }
            branches.push(BranchInfo {
                name,
                current: is_current,
                upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
                track: describe_track(track, !upstream.is_empty()),
                subject,
                remote_only: false,
            });
        }

        let known: std::collections::HashSet<String> =
            branches.iter().map(|branch| branch.name.clone()).collect();

        let mut remote_names = self
            .run(&path, &["remote"])?
            .lines()
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        // A remote name may itself contain slashes. Match the longest prefix
        // first so `team/github/topic` becomes branch `topic`, not
        // `github/topic` under a fictitious `team` remote.
        remote_names.sort_by_key(|name| std::cmp::Reverse(name.len()));

        let remote = self.run(
            &path,
            &[
                "for-each-ref",
                "--format",
                "%(refname)%00%(contents:subject)",
                "--",
                "refs/remotes/",
            ],
        )?;

        for line in remote.lines().filter(|line| !line.trim().is_empty()) {
            let mut fields = line.split('\0');
            let full_ref = fields.next().unwrap_or_default();
            let subject = fields.next().unwrap_or_default().to_string();

            // `origin/HEAD` is not a branch but a pointer to the default one.
            let Some((remote_name, short)) = remote_names.iter().find_map(|remote_name| {
                full_ref
                    .strip_prefix(&format!("refs/remotes/{remote_name}/"))
                    .map(|short| (remote_name.as_str(), short))
            }) else {
                continue;
            };
            if short.is_empty() || short == "HEAD" || known.contains(short) {
                continue;
            }
            if branches.iter().any(|branch| branch.name == short) {
                continue;
            }
            branches.push(BranchInfo {
                name: short.to_string(),
                current: false,
                upstream: Some(format!("{remote_name}/{short}")),
                track: None,
                subject,
                remote_only: true,
            });
        }

        branches.sort_by(|a, b| {
            b.current
                .cmp(&a.current)
                .then(a.remote_only.cmp(&b.remote_only))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(BranchList {
            detached: current.is_none(),
            current,
            branches,
        })
    }

    /// Moves the working copy onto an existing branch, local or remote.
    ///
    /// No `--force`: if there are changes that would be lost, Git refuses and
    /// the message reaches the user exactly as it is. Losing work over a branch
    /// switch would be the worst damage this app could do.
    pub fn switch_branch(&self, repo_path: &str, branch: &str) -> Result<RepositoryInfo, AppError> {
        let path = self.validate_repository(repo_path)?;
        let branch = self.validate_branch_name(&path, branch)?;

        self.run_owned(
            &path,
            &[
                OsString::from("switch"),
                OsString::from("--"),
                OsString::from(&branch),
            ],
        )
        .map_err(|error| {
            AppError::translated(
                "internal",
                "branch.switchFailed",
                format!("The branch could not be switched: {}", error.message),
            )
            .with("reason", error.message)
        })?;

        self.repository_info(&path)
    }

    /// Creates a branch from HEAD, switching to it only when asked.
    pub fn create_branch(
        &self,
        repo_path: &str,
        name: &str,
        checkout: bool,
    ) -> Result<RepositoryInfo, AppError> {
        let path = self.validate_repository(repo_path)?;
        let name = self.validate_branch_name(&path, name)?;

        let args = if checkout {
            // No `--` after `--create`: that option takes the next value as the
            // branch name, so the separator would become the name and the real
            // name would be read as the starting point.
            vec![
                OsString::from("switch"),
                OsString::from("--create"),
                OsString::from(&name),
            ]
        } else {
            vec![
                OsString::from("branch"),
                OsString::from("--"),
                OsString::from(&name),
            ]
        };

        self.run_owned(&path, &args).map_err(|error| {
            AppError::translated(
                "internal",
                "branch.createFailed",
                format!("The branch could not be created: {}", error.message),
            )
            .with("reason", error.message)
        })?;

        self.repository_info(&path)
    }

    /// Accepts only names Git considers valid and that cannot be read as
    /// options.
    ///
    /// The rule for what counts as a valid name belongs to Git, not to us:
    /// asking `check-ref-format` avoids reimplementing a long specification
    /// badly. The check on the leading dash stays ours, because it concerns the
    /// command line and not the format of the reference.
    fn validate_branch_name(&self, cwd: &Path, name: &str) -> Result<String, AppError> {
        let trimmed = name.trim();
        if trimmed.is_empty()
            || trimmed.len() > 255
            || trimmed.starts_with('-')
            || trimmed.chars().any(char::is_control)
        {
            return Err(AppError::translated(
                "invalidRequest",
                "branch.invalidName",
                "Invalid branch name.",
            ));
        }

        // `check-ref-format` does not accept the `--` separator: it rejects it
        // with a usage error. The name can pass as it is because the leading
        // dash, the one form that would be read as an option, has already been
        // excluded above.
        self.run(cwd, &["check-ref-format", &format!("refs/heads/{trimmed}")])
            .map_err(|_| {
                AppError::translated(
                    "invalidRequest",
                    "branch.refusedByGit",
                    format!("Git does not accept '{trimmed}' as a branch name."),
                )
                .with("name", trimmed)
            })?;

        Ok(trimmed.to_string())
    }

    /// The most recent commits of the branch, or only those a push would send.
    ///
    /// The second case is why this function exists: there used to be no way to
    /// see what was about to be sent, and the only information available was a
    /// number in the "to send" column.
    pub fn repository_history(
        &self,
        repo_path: &str,
        scope: HistoryScope,
    ) -> Result<HistoryResult, AppError> {
        const MAX_COMMITS: usize = 200;

        let path = self.validate_repository(repo_path)?;
        let info = self.repository_info(&path)?;
        let upstream = info.upstream.clone();

        // `status` exposes the upstream in its short, display-oriented form.
        // That value comes from repository configuration and may start with an
        // option-looking remote name. Passing it directly to `git log` before
        // `--` would let a value such as `--output=folder/branch` be parsed as a
        // log option and write outside the history result. Re-resolve the
        // upstream through the validated atoms and use its full ref, which
        // always starts with `refs/`.
        let outgoing_ref = if scope == HistoryScope::Outgoing {
            self.upstream_target(&path, &info.branch)?
                .map(|target| target.tracking_ref)
        } else {
            None
        };

        if scope == HistoryScope::Outgoing && outgoing_ref.is_none() {
            // Without an upstream, "to send" means nothing: saying so is
            // different from showing an empty list, which would suggest
            // "nothing to do".
            return Ok(HistoryResult {
                commits: Vec::new(),
                upstream: None,
                truncated: false,
            });
        }

        let range = match scope {
            HistoryScope::Recent => "HEAD".to_string(),
            HistoryScope::Outgoing => {
                format!("{}..HEAD", outgoing_ref.as_deref().unwrap_or_default())
            }
        };
        // Read one extra row so `truncated` means there really is another
        // commit, rather than merely "the result exactly filled the page".
        let limit = format!("-{}", MAX_COMMITS + 1);

        // Fields separated by NUL because subject and author are free text; the
        // records stay separated by newlines, which `%s` cannot contain.
        let output = match self.run(
            &path,
            &[
                "log",
                limit.as_str(),
                "--no-color",
                "--format=%H%x00%h%x00%s%x00%an%x00%aI",
                range.as_str(),
                "--",
            ],
        ) {
            Ok(output) => output,
            // A repository with no commits is not an error to show.
            Err(error)
                if error
                    .message
                    .to_ascii_lowercase()
                    .contains("does not have any commits") =>
            {
                String::new()
            }
            Err(error) => return Err(error),
        };

        let commits: Vec<CommitEntry> = output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| {
                let mut fields = line.split('\0');
                let hash = fields.next()?.to_string();
                let short_hash = fields.next()?.to_string();
                let subject = fields.next()?.to_string();
                let author = fields.next()?.to_string();
                let date = fields.next().unwrap_or_default().to_string();
                (!hash.is_empty()).then_some(CommitEntry {
                    hash,
                    short_hash,
                    subject,
                    author,
                    date,
                })
            })
            .collect();
        let (commits, truncated) = cap_history(commits, MAX_COMMITS);

        Ok(HistoryResult {
            truncated,
            commits,
            upstream,
        })
    }

    /// Lists the configured remotes with their two URLs, which may differ.
    pub fn list_remotes(&self, repo_path: &str) -> Result<Vec<RemoteInfo>, AppError> {
        let path = self.validate_repository(repo_path)?;
        let names = self.run(&path, &["remote"])?;

        names
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| {
                let fetch = self.remote_urls_checked(&path, name, false)?;
                let push = self.remote_urls_checked(&path, name, true)?;
                Ok(RemoteInfo {
                    name: name.to_string(),
                    // Remote URLs are part of the repository configuration and
                    // may contain legacy inline credentials. They must not
                    // cross the Tauri IPC boundary; `repository_info` applies
                    // the same redaction to its summary URL.
                    fetch_url: fetch
                        .first()
                        .map(|url| redact_remote_url(url))
                        .unwrap_or_default(),
                    push_url: push
                        .first()
                        .map(|url| redact_remote_url(url))
                        .unwrap_or_default(),
                })
            })
            .collect()
    }

    /// Adds a remote, or changes its URL if it already exists.
    pub fn set_remote(&self, repo_path: &str, name: &str, url: &str) -> Result<(), AppError> {
        let path = self.validate_repository(repo_path)?;
        let name = validate_remote_name(name)?;
        let url = validate_remote_url(url)?;

        let existing = self.run(&path, &["remote"])?;
        let exists = existing.lines().any(|line| line.trim() == name);
        let verb = if exists { "set-url" } else { "add" };

        self.run_owned(
            &path,
            &[
                OsString::from("remote"),
                OsString::from(verb),
                OsString::from("--"),
                OsString::from(&name),
                OsString::from(&url),
            ],
        )
        .map(|_| ())
        .map_err(|error| {
            AppError::translated(
                "internal",
                "remote.configureFailed",
                format!("The remote could not be configured: {}", error.message),
            )
            .with("reason", error.message)
        })
    }

    pub fn remove_remote(&self, repo_path: &str, name: &str) -> Result<(), AppError> {
        let path = self.validate_repository(repo_path)?;
        let name = validate_remote_name(name)?;

        self.run_owned(
            &path,
            &[
                OsString::from("remote"),
                OsString::from("remove"),
                OsString::from("--"),
                OsString::from(&name),
            ],
        )
        .map(|_| ())
        .map_err(|error| {
            AppError::translated(
                "internal",
                "remote.removeFailed",
                format!("The remote could not be removed: {}", error.message),
            )
            .with("reason", error.message)
        })
    }

    /// Lists the stash stack. The index is only its current display position;
    /// `%H` is returned with it so a later action can prove the position still
    /// refers to the object the user selected.
    pub fn list_stashes(&self, repo_path: &str) -> Result<Vec<StashEntry>, AppError> {
        let path = self.validate_repository(repo_path)?;
        self.list_stashes_at(&path)
    }

    fn list_stashes_at(&self, path: &Path) -> Result<Vec<StashEntry>, AppError> {
        let output = self.run(
            path,
            &["stash", "list", "--format=%H%x00%gs%x00%aI", "--no-color"],
        )?;

        let mut stashes = Vec::new();
        for (index, line) in output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .enumerate()
        {
            let mut fields = line.split('\0');
            let object_id = fields.next().unwrap_or_default().to_string();
            let raw = fields.next().unwrap_or_default();
            let date = fields.next().unwrap_or_default().to_string();
            if !valid_stash_object_id(&object_id) {
                return Err(AppError::translated(
                    "invalidResponse",
                    "stash.actionFailed",
                    "Git returned an invalid stash object ID.",
                )
                .with("reason", "Git returned an invalid stash object ID."));
            }

            // `%gs` has the form "WIP on branch: object hash" or
            // "On branch: message". The branch, when present, comes before
            // the colon.
            let (branch, message) = match raw.split_once(": ") {
                Some((head, rest)) => (
                    head.rsplit(" on ")
                        .next()
                        .filter(|value| !value.is_empty() && *value != head)
                        .map(str::to_string),
                    rest.to_string(),
                ),
                None => (None, raw.to_string()),
            };

            stashes.push(StashEntry {
                index: index as u32,
                object_id,
                message,
                branch,
                date,
            });
        }
        Ok(stashes)
    }

    /// Puts the current changes aside.
    pub fn create_stash(
        &self,
        repo_path: &str,
        message: &str,
        include_untracked: bool,
    ) -> Result<RepositoryInfo, AppError> {
        let path = self.validate_repository(repo_path)?;
        let message = message.trim();
        if message.len() > 500 || message.chars().any(char::is_control) {
            return Err(AppError::translated(
                "invalidRequest",
                "stash.invalidMessage",
                "Invalid stash message.",
            ));
        }

        let mut args = vec![OsString::from("stash"), OsString::from("push")];
        if include_untracked {
            args.push(OsString::from("--include-untracked"));
        }
        if !message.is_empty() {
            args.push(OsString::from("--message"));
            args.push(OsString::from(message));
        }
        args.push(OsString::from("--"));

        let output = self.run_owned(&path, &args).map_err(|error| {
            AppError::translated(
                "internal",
                "stash.createFailed",
                format!("The stash could not be created: {}", error.message),
            )
            .with("reason", error.message)
        })?;
        if output.contains("No local changes") {
            return Err(AppError::translated(
                "invalidRequest",
                "stash.nothingToStash",
                "There is nothing to put aside.",
            ));
        }

        self.repository_info(&path)
    }

    /// Reapplies or deletes the exact stash object selected in the interface.
    /// The numeric position is accepted only while it still resolves to the
    /// supplied full object ID. Apply uses the ID itself, so an entry that moves
    /// after validation still cannot make Git apply another stash.
    pub fn apply_stash(
        &self,
        repo_path: &str,
        index: u32,
        object_id: &str,
        action: StashAction,
    ) -> Result<RepositoryInfo, AppError> {
        let path = self.validate_repository(repo_path)?;
        let reference = self.ensure_stash_is_current(&path, index, object_id)?;

        match action {
            StashAction::Apply => self.apply_stash_object(&path, object_id)?,
            StashAction::Drop => self.drop_stash_reference(&path, &reference)?,
            StashAction::Pop => {
                self.apply_stash_object(&path, object_id)?;

                // `stash pop` accepts only a reflog position, so using it would
                // re-resolve a potentially shifted index and could apply the
                // wrong entry. Apply the immutable object first, then re-check
                // the position before removing it. If that second step is no
                // longer safe, the intended changes are in the worktree and
                // the stash is deliberately kept.
                let reference = self
                    .ensure_stash_is_current(&path, index, object_id)
                    .map_err(|_| stash_applied_but_kept())?;
                self.drop_stash_reference(&path, &reference)
                    .map_err(|_| stash_applied_but_kept())?;
            }
        }

        self.repository_info(&path)
    }

    fn ensure_stash_is_current(
        &self,
        path: &Path,
        index: u32,
        object_id: &str,
    ) -> Result<String, AppError> {
        if !valid_stash_object_id(object_id) {
            return Err(stash_changed_since_load());
        }
        let current = self
            .list_stashes_at(path)?
            .into_iter()
            .find(|entry| entry.index == index);
        match current {
            Some(entry) if entry.object_id == object_id => Ok(format!("stash@{{{index}}}")),
            _ => Err(stash_changed_since_load()),
        }
    }

    fn apply_stash_object(&self, path: &Path, object_id: &str) -> Result<(), AppError> {
        self.run_owned(
            path,
            &[
                OsString::from("stash"),
                OsString::from("apply"),
                OsString::from("--"),
                OsString::from(object_id),
            ],
        )
        .map(|_| ())
        .map_err(stash_action_failed)
    }

    fn drop_stash_reference(&self, path: &Path, reference: &str) -> Result<(), AppError> {
        self.run_owned(
            path,
            &[
                OsString::from("stash"),
                OsString::from("drop"),
                OsString::from("--"),
                OsString::from(reference),
            ],
        )
        .map(|_| ())
        .map_err(stash_action_failed)
    }

    /// Says whether the repository was left half-way through an operation and
    /// which files are still in conflict.
    ///
    /// The app used to know how to count conflicts and nothing else: it showed
    /// them and left the user with no way out from the inside.
    pub fn conflict_state(&self, repo_path: &str) -> Result<ConflictState, AppError> {
        let path = self.validate_repository(repo_path)?;
        let git_dir = PathBuf::from(self.run(&path, &["rev-parse", "--git-dir"])?);
        let git_dir = if git_dir.is_absolute() {
            git_dir
        } else {
            path.join(git_dir)
        };

        let pending = if git_dir.join("MERGE_HEAD").exists() {
            PendingOperation::Merge
        } else if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
            PendingOperation::Rebase
        } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
            PendingOperation::CherryPick
        } else if git_dir.join("REVERT_HEAD").exists() {
            PendingOperation::Revert
        } else {
            PendingOperation::None
        };

        let conflicted = self.run(
            &path,
            &["diff", "--name-only", "--diff-filter=U", "-z", "--"],
        )?;

        Ok(ConflictState {
            pending,
            conflicted: conflicted
                .split('\0')
                .filter(|entry| !entry.is_empty())
                .map(str::to_string)
                .collect(),
        })
    }

    /// Annulla o porta a termine l'operazione in corso.
    pub fn resolve_conflict(
        &self,
        repo_path: &str,
        action: ConflictAction,
    ) -> Result<RepositoryInfo, AppError> {
        let path = self.validate_repository(repo_path)?;
        let state = self.conflict_state(repo_path)?;

        let command = match state.pending {
            PendingOperation::None => {
                return Err(AppError::translated(
                    "invalidRequest",
                    "conflict.nothingPending",
                    "There is no operation to finish.",
                ))
            }
            PendingOperation::Merge => "merge",
            PendingOperation::Rebase => "rebase",
            PendingOperation::CherryPick => "cherry-pick",
            PendingOperation::Revert => "revert",
        };

        if action == ConflictAction::Continue && !state.conflicted.is_empty() {
            return Err(AppError::translated(
                "invalidRequest",
                "conflict.stillConflicted",
                "There are still conflicted files: resolve them and stage them before continuing.",
            ));
        }

        let flag = match action {
            ConflictAction::Abort => "--abort",
            ConflictAction::Continue => "--continue",
        };

        // Without a fake editor, `--continue` would hang waiting for a commit
        // message nobody can write.
        self.run_owned(
            &path,
            &[
                OsString::from("-c"),
                OsString::from("core.editor=true"),
                OsString::from(command),
                OsString::from(flag),
            ],
        )
        .map_err(|error| {
            AppError::translated(
                "internal",
                "conflict.actionFailed",
                format!("The operation failed: {}", error.message),
            )
            .with("reason", error.message)
        })?;

        self.repository_info(&path)
    }

    fn worktree_root(&self, folder: &Path) -> Result<Option<PathBuf>, AppError> {
        match self.run(folder, &["rev-parse", "--show-toplevel"]) {
            Ok(root) => {
                let root = PathBuf::from(root).canonicalize().map_err(|error| {
                    AppError::translated(
                        "internal",
                        "git.rootUnresolvable",
                        format!("The root of the Git repository could not be resolved: {error}"),
                    )
                    .with("reason", error.to_string())
                })?;
                Ok(Some(root))
            }
            Err(error) if is_not_a_git_repository_error(&error.message) => Ok(None),
            Err(error) => Err(AppError::translated(
                "internal",
                "link.checkFolderFailed",
                format!(
                    "The chosen Git folder could not be checked: {}",
                    error.message
                ),
            )
            .with("reason", error.message)),
        }
    }

    fn rollback_new_git_metadata(&self, folder: &Path) -> Result<bool, AppError> {
        let metadata_path = folder.join(".git");
        let metadata = fs::symlink_metadata(&metadata_path).map_err(|error| {
            AppError::translated(
                "internal",
                "rollback.metadataUnreadable",
                format!(".git could not be checked: {error}"),
            )
            .with("reason", error.to_string())
        })?;
        if !is_safe_git_metadata_directory(&metadata) {
            return Ok(false);
        }

        let resolved = metadata_path.canonicalize().map_err(|error| {
            AppError::translated(
                "internal",
                "rollback.metadataUnresolvable",
                format!(".git could not be resolved: {error}"),
            )
            .with("reason", error.to_string())
        })?;
        if resolved.file_name().and_then(|name| name.to_str()) != Some(".git")
            || resolved.parent() != Some(folder)
        {
            return Ok(false);
        }
        match fs::symlink_metadata(resolved.join("index")) {
            Ok(_) => return Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(AppError::translated(
                    "internal",
                    "link.indexUnreadable",
                    format!("The Git index could not be checked: {error}"),
                )
                .with("reason", error.to_string()))
            }
        }
        if self.run(folder, &["rev-parse", "--verify", "HEAD"]).is_ok() {
            return Ok(false);
        }
        let refs = self.run(folder, &["for-each-ref", "--format=%(refname)"])?;
        let remotes = self.run(folder, &["remote"])?;
        if !refs.is_empty() || !remotes.is_empty() {
            return Ok(false);
        }

        fs::remove_dir_all(&resolved).map_err(|error| {
            AppError::translated(
                "internal",
                "rollback.removeFailed",
                format!("'{}' could not be removed: {error}", resolved.display()),
            )
            .with("path", resolved.display().to_string())
            .with("reason", error.to_string())
        })?;
        Ok(true)
    }

    pub fn repository_info(&self, repo_path: &Path) -> Result<RepositoryInfo, AppError> {
        let canonical = repo_path.canonicalize().map_err(|error| {
            AppError::translated(
                "invalidRequest",
                "error.invalidPath",
                format!("Invalid path '{}': {error}", repo_path.display()),
            )
            .with("path", repo_path.display().to_string())
            .with("reason", error.to_string())
        })?;

        let inside = self.run(&canonical, &["rev-parse", "--is-inside-work-tree"])?;
        if inside != "true" {
            return Err(AppError::translated(
                "invalidRequest",
                "git.notARepository",
                format!("Not a Git repository: {}", canonical.display()),
            )
            .with("path", canonical.display().to_string()));
        }

        let status_output = self.run(
            &canonical,
            &[
                "-c",
                "core.quotepath=false",
                "status",
                "--porcelain=v2",
                // Records separated by NUL: the paths arrive raw, without the
                // C-quoting Git applies to names containing quotes, backslashes
                // or control characters.
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
        )?;
        let parsed = parse_porcelain_v2(&status_output);

        let branch = parsed.branch.clone().unwrap_or_else(|| {
            self.run(&canonical, &["symbolic-ref", "--short", "-q", "HEAD"])
                .unwrap_or_else(|_| "HEAD".to_string())
        });
        let detached = branch == "(detached)" || branch == "HEAD";

        let remote_names = self.run(&canonical, &["remote"]).unwrap_or_default();
        let remote_name = remote_names
            .lines()
            .find(|name| *name == "origin")
            .or_else(|| remote_names.lines().find(|name| !name.trim().is_empty()))
            .map(ToOwned::to_owned);
        let remote_url = remote_name.as_deref().and_then(|name| {
            self.run(&canonical, &["remote", "get-url", "--", name])
                .ok()
                .filter(|value| !value.is_empty())
                .map(|value| redact_remote_url(&value))
        });

        let head_short = self
            .run(&canonical, &["rev-parse", "--short", "HEAD"])
            .ok()
            .filter(|value| !value.is_empty());
        let last_commit = self
            .run(&canonical, &["log", "-1", "--pretty=%s"])
            .ok()
            .filter(|value| !value.is_empty());

        let staged = parsed.changes.iter().filter(|change| change.staged).count() as u32;
        let unstaged = parsed
            .changes
            .iter()
            .filter(|change| change.unstaged)
            .count() as u32;
        let untracked = parsed
            .changes
            .iter()
            .filter(|change| change.untracked)
            .count() as u32;
        let conflicted = parsed
            .changes
            .iter()
            .filter(|change| change.conflicted)
            .count() as u32;

        Ok(RepositoryInfo {
            path: canonical.to_string_lossy().to_string(),
            name: canonical
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| canonical.display().to_string()),
            branch,
            detached,
            upstream: parsed.upstream,
            remote_name,
            remote_url,
            ahead: parsed.ahead,
            behind: parsed.behind,
            staged,
            unstaged,
            untracked,
            conflicted,
            changed_files: parsed.changes.len() as u32,
            head_short,
            last_commit,
            checked_at: now_millis(),
        })
    }

    pub fn repository_changes(&self, repo_path: &str) -> Result<Vec<FileChange>, AppError> {
        let path = self.validate_repository(repo_path)?;
        let status_output = self.run(
            &path,
            &[
                "-c",
                "core.quotepath=false",
                "status",
                "--porcelain=v2",
                // Records separated by NUL: the paths arrive raw, without the
                // C-quoting Git applies to names containing quotes, backslashes
                // or control characters.
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
        )?;
        Ok(parse_porcelain_v2(&status_output).changes)
    }

    pub fn repository_diff(&self, repo_path: &str) -> Result<DiffResult, AppError> {
        let path = self.validate_repository(repo_path)?;
        let staged = self.run(
            &path,
            &[
                "-c",
                "core.quotepath=false",
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--unified=3",
            ],
        )?;
        let unstaged = self.run(
            &path,
            &[
                "-c",
                "core.quotepath=false",
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--unified=3",
            ],
        )?;

        let (staged, staged_truncated) = truncate_utf8(staged, MAX_DIFF_BYTES / 2);
        let (unstaged, unstaged_truncated) = truncate_utf8(unstaged, MAX_DIFF_BYTES / 2);

        Ok(DiffResult {
            staged,
            unstaged,
            truncated: staged_truncated || unstaged_truncated,
        })
    }

    pub fn stage_files(&self, repo_path: &str, paths: Vec<String>) -> OperationResult {
        let operation = "stage";
        let path = match self.validate_repository(repo_path) {
            Ok(path) => path,
            Err(error) => return failure_from_path(repo_path, operation, error),
        };
        let name = repo_name(&path);
        let changes = match self.validate_file_selection(&path, paths, operation, |change| {
            !change.conflicted && (change.unstaged || change.untracked)
        }) {
            Ok(changes) => changes,
            Err(error) => return failure_from(&path, &name, operation, error),
        };

        let pathspecs = pathspecs_for_changes(&changes, true);
        let mut args = vec![OsString::from("add"), OsString::from("--")];
        args.extend(pathspecs);

        match self.run_owned(&path, &args) {
            Ok(output) => success_named(
                &path,
                &name,
                operation,
                selected_files_message(changes.len(), "preparato", "preparati"),
                output,
            ),
            Err(error) => failure_from(&path, &name, operation, error),
        }
    }

    pub fn unstage_files(&self, repo_path: &str, paths: Vec<String>) -> OperationResult {
        let operation = "unstage";
        let path = match self.validate_repository(repo_path) {
            Ok(path) => path,
            Err(error) => return failure_from_path(repo_path, operation, error),
        };
        let name = repo_name(&path);
        let changes = match self.validate_file_selection(&path, paths, operation, |change| {
            !change.conflicted && change.staged
        }) {
            Ok(changes) => changes,
            Err(error) => return failure_from(&path, &name, operation, error),
        };

        let pathspecs = pathspecs_for_changes(&changes, true);
        let mut args = if self.run(&path, &["rev-parse", "--verify", "HEAD"]).is_ok() {
            vec![
                OsString::from("reset"),
                OsString::from("--quiet"),
                OsString::from("HEAD"),
                OsString::from("--"),
            ]
        } else {
            vec![
                OsString::from("rm"),
                OsString::from("--cached"),
                OsString::from("-f"),
                OsString::from("--ignore-unmatch"),
                OsString::from("--"),
            ]
        };
        args.extend(pathspecs);

        match self.run_owned(&path, &args) {
            Ok(output) => success_named(
                &path,
                &name,
                operation,
                selected_files_message(
                    changes.len(),
                    "rimosso dallo staging",
                    "rimossi dallo staging",
                ),
                output,
            ),
            Err(error) => failure_from(&path, &name, operation, error),
        }
    }

    pub fn discard_files(&self, repo_path: &str, paths: Vec<String>) -> OperationResult {
        let operation = "discard";
        let path = match self.validate_repository(repo_path) {
            Ok(path) => path,
            Err(error) => return failure_from_path(repo_path, operation, error),
        };
        let name = repo_name(&path);
        let changes = match self.validate_file_selection(&path, paths, operation, |change| {
            !change.conflicted && (change.unstaged || change.untracked)
        }) {
            Ok(changes) => changes,
            Err(error) => return failure_from(&path, &name, operation, error),
        };

        let tracked = changes
            .iter()
            .filter(|change| !change.untracked)
            .cloned()
            .collect::<Vec<_>>();
        let untracked = changes
            .iter()
            .filter(|change| change.untracked)
            .cloned()
            .collect::<Vec<_>>();
        let mut output = String::new();

        if !tracked.is_empty() {
            let mut args = vec![
                OsString::from("restore"),
                OsString::from("--worktree"),
                OsString::from("--"),
            ];
            args.extend(pathspecs_for_changes(&tracked, false));
            match self.run_owned(&path, &args) {
                Ok(value) => output = value,
                Err(error) => return failure_from(&path, &name, operation, error),
            }
        }

        if !untracked.is_empty() {
            let mut removed = Vec::with_capacity(untracked.len());
            for change in &untracked {
                match remove_untracked_file(&path, &change.path) {
                    Ok(()) => removed.push(change.path.clone()),
                    Err(error) => {
                        let completed = tracked.len() + removed.len();
                        if completed == 0 {
                            return failure_from(&path, &name, operation, error);
                        }
                        // How many files have already been touched is the
                        // information that decides what to do next: the error's
                        // own message becomes a parameter instead of vanishing.
                        return failure_named(
                            &path,
                            &name,
                            operation,
                            format!(
                                "{completed} files were already restored or deleted, but the operation did not finish: {}",
                                error.message
                            ),
                        )
                        .translated("discard.partiallyDone")
                        .with("completed", completed.to_string())
                        .with("reason", error.message);
                    }
                }
            }
            output = combine_outputs(
                output,
                removed
                    .into_iter()
                    .map(|path| format!("Eliminato file nuovo: {path}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
        }

        success_named(
            &path,
            &name,
            operation,
            selected_files_message(changes.len(), "ripristinato", "ripristinati"),
            output,
        )
    }

    fn validate_file_selection<F>(
        &self,
        repo_path: &Path,
        requested_paths: Vec<String>,
        operation: &str,
        eligible: F,
    ) -> Result<Vec<FileChange>, AppError>
    where
        F: Fn(&FileChange) -> bool,
    {
        if requested_paths.is_empty() {
            return Err(AppError::translated(
                "invalidRequest",
                "files.selectAtLeastOne",
                "Select at least one file.",
            ));
        }
        if requested_paths.len() > MAX_FILE_OPERATION_PATHS {
            return Err(AppError::translated(
                "invalidRequest",
                "files.tooMany",
                format!(
                    "Too many files were selected. Work in groups of at most {MAX_FILE_OPERATION_PATHS}."
                ),
            )
            .with("limit", MAX_FILE_OPERATION_PATHS.to_string()));
        }

        let mut unique = HashSet::with_capacity(requested_paths.len());
        let mut argument_bytes = 0usize;
        for requested in &requested_paths {
            if requested.is_empty() || requested.contains('\0') {
                return Err(AppError::translated(
                    "invalidRequest",
                    "files.invalidPathInSelection",
                    "The selection contains an invalid path.",
                ));
            }
            if !unique.insert(requested.as_str()) {
                return Err(AppError::translated(
                    "invalidRequest",
                    "files.duplicateSelection",
                    format!("The file '{requested}' was selected more than once."),
                )
                .with("file", requested));
            }
            argument_bytes = argument_bytes.saturating_add(requested.len() + 12);
        }
        if argument_bytes > MAX_FILE_OPERATION_ARGUMENT_BYTES {
            return Err(AppError::translated(
                "invalidRequest",
                "files.selectionTooLarge",
                "The selection exceeds the limit of the Git command. Select fewer files and try again.",
            ));
        }

        let current = self.repository_changes(&repo_path.to_string_lossy())?;
        let mut selected = Vec::with_capacity(requested_paths.len());
        for requested in requested_paths {
            if !current.iter().any(|change| change.path == requested) {
                return Err(AppError::translated(
                    "notFound",
                    "files.noLongerChanged",
                    format!(
                        "The file '{requested}' is no longer reported as changed. Refresh the repository and try again."
                    ),
                )
                .with("file", requested));
            }
            let Some(change) = current
                .iter()
                .find(|change| change.path == requested && eligible(change))
            else {
                // Four whole sentences, not a fragment glued inside another
                // sentence: "the file X {is not staged}" imposes on every
                // language the structure of the original.
                let (message_id, english) = match operation {
                    "stage" => (
                        "files.nothingToStage",
                        format!("The file '{requested}' has no changes that can be staged."),
                    ),
                    "unstage" => (
                        "files.notStaged",
                        format!("The file '{requested}' is not staged."),
                    ),
                    "discard" => (
                        "files.nothingToDiscard",
                        format!("The file '{requested}' has no unstaged changes to discard."),
                    ),
                    _ => (
                        "files.notValidForOperation",
                        format!("The file '{requested}' is not valid for this operation."),
                    ),
                };
                return Err(AppError::translated("invalidRequest", message_id, english)
                    .with("file", requested));
            };
            selected.push(change.clone());
        }

        Ok(selected)
    }

    pub fn commit_many(
        &self,
        requests: Vec<CommitRequest>,
        on_progress: &(dyn Fn(usize, usize, &OperationResult) + Sync),
    ) -> Vec<OperationResult> {
        run_over_repositories(
            requests,
            &|request: CommitRequest| {
                if cancel_requested() {
                    cancelled(&request.repo_path, "commit")
                } else {
                    self.commit_one(request)
                }
            },
            on_progress,
        )
    }

    fn commit_one(&self, request: CommitRequest) -> OperationResult {
        let operation = "commit";
        let path = match self.validate_repository(&request.repo_path) {
            Ok(path) => path,
            Err(error) => return failure_from_path(&request.repo_path, operation, error),
        };
        let name = repo_name(&path);
        let message = request.message.trim();
        if message.is_empty() {
            return failure_named(&path, &name, operation, "The commit message is empty.")
                .translated("outcome.emptyCommitMessage");
        }

        let info = match self.repository_info(&path) {
            Ok(info) => info,
            Err(error) => return failure_from(&path, &name, operation, error),
        };
        if info.conflicted > 0 {
            return failure_named(
                &path,
                &name,
                operation,
                "The repository has conflicts to resolve.",
            )
            .translated("outcome.hasConflicts");
        }

        if request.stage_all {
            if let Err(error) = self.run(&path, &["add", "-A"]) {
                return failure_from(&path, &name, operation, error);
            }
        }

        let refreshed = match self.repository_info(&path) {
            Ok(info) => info,
            Err(error) => return failure_from(&path, &name, operation, error),
        };
        if refreshed.staged == 0 {
            return failure_named(
                &path,
                &name,
                operation,
                "No file is staged. Turn on the explicit inclusion of every change, or stage the files with Git.",
            )
            .translated("outcome.nothingStaged");
        }

        let args = vec![
            OsString::from("commit"),
            OsString::from("-m"),
            OsString::from(message),
        ];
        match self.run_owned(&path, &args) {
            Ok(output) => success_named(
                &path,
                &name,
                operation,
                "Commit creato correttamente.",
                output,
            ),
            Err(error) => failure_from(&path, &name, operation, error),
        }
    }

    pub fn fetch_many(
        &self,
        repo_paths: Vec<String>,
        github_token: Option<GitAccessToken>,
        on_progress: &(dyn Fn(usize, usize, &OperationResult) + Sync),
    ) -> Vec<OperationResult> {
        run_over_repositories(
            repo_paths,
            &|repo_path: String| {
                if cancel_requested() {
                    cancelled(&repo_path, "fetch")
                } else {
                    self.fetch_one(&repo_path, github_token.as_ref())
                }
            },
            on_progress,
        )
    }

    fn fetch_one(&self, repo_path: &str, github_token: Option<&GitAccessToken>) -> OperationResult {
        let operation = "fetch";
        let path = match self.validate_repository(repo_path) {
            Ok(path) => path,
            Err(error) => return failure_from_path(repo_path, operation, error),
        };
        let name = repo_name(&path);
        let info = match self.repository_info(&path) {
            Ok(info) => info,
            Err(error) => return failure_from(&path, &name, operation, error),
        };
        if info.remote_name.is_none() {
            return failure_named(&path, &name, operation, "Nessun remote configurato.");
        }

        let remote = info.remote_name.as_deref().unwrap_or("origin");
        let remote_urls = self.remote_urls(&path, remote, false);
        let github_remote =
            !remote_urls.is_empty() && remote_urls.iter().all(|url| is_github_https_remote(url));
        let fetch_result = if github_remote {
            let refspec = match self.github_fetch_refspec(&path, remote) {
                Ok(refspec) => refspec,
                Err(error) => return failure_from(&path, &name, operation, error),
            };
            self.run_network(
                &path,
                &[
                    "-c",
                    "protocol.ext.allow=never",
                    "fetch",
                    "--no-prune",
                    "--no-tags",
                    "--refmap=",
                    "--no-recurse-submodules",
                    "--",
                    remote_urls[0].as_str(),
                    refspec.as_str(),
                ],
                github_token,
            )
        } else {
            self.run_network(
                &path,
                &[
                    "-c",
                    "protocol.ext.allow=never",
                    "fetch",
                    "--no-prune",
                    "--no-tags",
                    "--no-recurse-submodules",
                    "--",
                    remote,
                ],
                None,
            )
        };
        match fetch_result {
            Ok(output) => success_named(
                &path,
                &name,
                operation,
                "Riferimenti remoti aggiornati.",
                output,
            ),
            Err(error) => failure_from(&path, &name, operation, error),
        }
    }

    pub fn pull_many(
        &self,
        repo_paths: Vec<String>,
        github_token: Option<GitAccessToken>,
        strategy: PullStrategy,
        on_progress: &(dyn Fn(usize, usize, &OperationResult) + Sync),
    ) -> Vec<OperationResult> {
        run_over_repositories(
            repo_paths,
            &|repo_path: String| {
                if cancel_requested() {
                    cancelled(&repo_path, "pull")
                } else {
                    self.pull_one(&repo_path, github_token.as_ref(), strategy)
                }
            },
            on_progress,
        )
    }

    fn pull_one(
        &self,
        repo_path: &str,
        github_token: Option<&GitAccessToken>,
        strategy: PullStrategy,
    ) -> OperationResult {
        let operation = "pull";
        let path = match self.validate_repository(repo_path) {
            Ok(path) => path,
            Err(error) => return failure_from_path(repo_path, operation, error),
        };
        let name = repo_name(&path);
        let info = match self.repository_info(&path) {
            Ok(info) => info,
            Err(error) => return failure_from(&path, &name, operation, error),
        };

        if info.conflicted > 0 || info.changed_files > 0 {
            return failure_named(
                &path,
                &name,
                operation,
                "Pull bloccato: sono presenti modifiche locali o conflitti.",
            );
        }
        let upstream = match self.upstream_target(&path, &info.branch) {
            Ok(Some(upstream)) => upstream,
            Ok(None) => {
                return failure_named(
                    &path,
                    &name,
                    operation,
                    "Il branch corrente non ha un upstream configurato.",
                );
            }
            Err(error) => return failure_from(&path, &name, operation, error),
        };
        let remote = upstream.remote.as_str();
        let remote_urls = self.remote_urls(&path, remote, false);
        let github_remote =
            !remote_urls.is_empty() && remote_urls.iter().all(|url| is_github_https_remote(url));
        let fetch_result = if github_remote {
            let refspec = match self.github_fetch_refspec(&path, remote) {
                Ok(refspec) => refspec,
                Err(error) => return failure_from(&path, &name, operation, error),
            };
            self.run_network(
                &path,
                &[
                    "-c",
                    "protocol.ext.allow=never",
                    "fetch",
                    "--no-prune",
                    "--no-tags",
                    "--refmap=",
                    "--no-recurse-submodules",
                    "--",
                    remote_urls[0].as_str(),
                    refspec.as_str(),
                ],
                github_token,
            )
        } else {
            self.run_network(
                &path,
                &[
                    "-c",
                    "protocol.ext.allow=never",
                    "fetch",
                    "--no-prune",
                    "--no-tags",
                    "--no-recurse-submodules",
                    "--",
                    remote,
                ],
                None,
            )
        };
        let fetch_output = match fetch_result {
            Ok(output) => output,
            Err(error) => return failure_from(&path, &name, operation, error),
        };

        let refreshed = match self.repository_info(&path) {
            Ok(info) => info,
            Err(error) => return failure_from(&path, &name, operation, error),
        };
        // Divergence stops fast-forward only. For the other two strategies it
        // is exactly the case they exist to resolve: refusing it would mean not
        // having added them.
        if strategy == PullStrategy::FastForward && refreshed.ahead > 0 && refreshed.behind > 0 {
            return failure_named(
                &path,
                &name,
                operation,
                "Pull blocked: the local and remote branches have diverged. Choose merge or rebase.",
            )
            .translated("outcome.pullDiverged");
        }
        if refreshed.behind == 0 {
            return success_named(
                &path,
                &name,
                operation,
                "The repository is already up to date.",
                fetch_output,
            )
            .translated("outcome.alreadyUpToDate");
        }

        // `core.editor=true` is not a detail: without it, merge and rebase
        // would open an editor that does not exist here and the command would
        // hang until the deadline.
        let integration_args: Vec<OsString> = match strategy {
            PullStrategy::FastForward => vec![
                OsString::from("merge"),
                OsString::from("--ff-only"),
                OsString::from("--no-edit"),
                OsString::from("--"),
                OsString::from(&upstream.tracking_ref),
            ],
            PullStrategy::Merge => vec![
                OsString::from("-c"),
                OsString::from("core.editor=true"),
                OsString::from("merge"),
                OsString::from("--no-edit"),
                OsString::from("--"),
                OsString::from(&upstream.tracking_ref),
            ],
            PullStrategy::Rebase => vec![
                OsString::from("-c"),
                OsString::from("core.editor=true"),
                OsString::from("rebase"),
                OsString::from("--"),
                OsString::from(&upstream.tracking_ref),
            ],
        };

        let done = match strategy {
            PullStrategy::FastForward => "Aggiornamento fast-forward completato.",
            PullStrategy::Merge => "Aggiornamento integrato con un merge.",
            PullStrategy::Rebase => "Commit locali riapplicati sopra il remote.",
        };

        match self.run_owned(&path, &integration_args) {
            Ok(merge_output) => success_named(
                &path,
                &name,
                operation,
                done,
                combine_outputs(fetch_output, merge_output),
            ),
            // Merge and rebase can stop on a conflict: that is not a fault but
            // a state the repository is left in, and it has to be said that
            // way.
            Err(error) => failure_from(&path, &name, operation, error),
        }
    }

    pub fn push_many(
        &self,
        repo_paths: Vec<String>,
        github_token: Option<GitAccessToken>,
        on_progress: &(dyn Fn(usize, usize, &OperationResult) + Sync),
    ) -> Vec<OperationResult> {
        run_over_repositories(
            repo_paths,
            &|repo_path: String| {
                if cancel_requested() {
                    cancelled(&repo_path, "push")
                } else {
                    self.push_one(&repo_path, github_token.as_ref())
                }
            },
            on_progress,
        )
    }

    fn push_one(&self, repo_path: &str, github_token: Option<&GitAccessToken>) -> OperationResult {
        let operation = "push";
        let path = match self.validate_repository(repo_path) {
            Ok(path) => path,
            Err(error) => return failure_from_path(repo_path, operation, error),
        };
        let name = repo_name(&path);
        let info = match self.repository_info(&path) {
            Ok(info) => info,
            Err(error) => return failure_from(&path, &name, operation, error),
        };

        if info.conflicted > 0 {
            return failure_named(
                &path,
                &name,
                operation,
                "Push bloccato: sono presenti conflitti.",
            );
        }
        if info.remote_name.is_none() {
            return failure_named(&path, &name, operation, "Nessun remote configurato.");
        }
        if info.behind > 0 {
            return failure_named(
                &path,
                &name,
                operation,
                "Push blocked: the remote branch has commits that are missing locally.",
            )
            .translated("outcome.pushBehind");
        }
        let upstream = match self.upstream_target(&path, &info.branch) {
            Ok(upstream) => upstream,
            Err(error) => return failure_from(&path, &name, operation, error),
        };
        if info.upstream.is_some() && upstream.is_none() {
            return failure_named(
                &path,
                &name,
                operation,
                "The upstream configuration could not be resolved safely.",
            )
            .translated("outcome.upstreamUnsafe");
        }
        let initial_push = upstream.is_none();
        if !initial_push && info.ahead == 0 {
            return success_named(&path, &name, operation, "No commit to send.", String::new())
                .translated("outcome.nothingToSend");
        }

        let (remote, remote_ref) = if let Some(upstream) = upstream {
            (upstream.remote, upstream.remote_ref)
        } else {
            let remote = info.remote_name.clone().unwrap_or_default();
            if info.detached {
                return failure_named(
                    &path,
                    &name,
                    operation,
                    "The first push is blocked because HEAD is detached.",
                )
                .translated("outcome.pushDetached");
            }
            if self.run(&path, &["rev-parse", "--verify", "HEAD"]).is_err() {
                return failure_named(
                    &path,
                    &name,
                    operation,
                    "Create at least one local commit before the first push.",
                )
                .translated("outcome.pushNeedsCommit");
            }
            if let Err(error) = self.run(&path, &["check-ref-format", "--branch", &info.branch]) {
                return failure_named(
                    &path,
                    &name,
                    operation,
                    format!("The local branch name is not valid for a push: {error}"),
                )
                .translated("outcome.pushInvalidBranch")
                .with("reason", error.message);
            }
            if let Err(error) = self.github_fetch_refspec(&path, &remote) {
                return failure_from(&path, &name, operation, error);
            }
            (remote, format!("refs/heads/{}", info.branch))
        };
        let remote_urls = self.remote_urls(&path, &remote, true);
        let github_remote =
            !remote_urls.is_empty() && remote_urls.iter().all(|url| is_github_https_remote(url));
        let auth = if github_remote { github_token } else { None };
        let refspec = format!("HEAD:{remote_ref}");
        let mut push_args = vec![
            "-c",
            "protocol.ext.allow=never",
            "push",
            "--porcelain",
            "--no-recurse-submodules",
            "--no-follow-tags",
            "--no-signed",
            "--no-verify",
        ];
        if initial_push {
            push_args.push("--set-upstream");
        }
        push_args.extend(["--", remote.as_str(), refspec.as_str()]);
        let push_result = self.run_network(&path, &push_args, auth);

        match push_result {
            Ok(output) => success_named(
                &path,
                &name,
                operation,
                "Push completato correttamente.",
                output,
            ),
            Err(error) => failure_from(&path, &name, operation, error),
        }
    }
}

fn serve_askpass(
    listener: TcpListener,
    cancel: Receiver<()>,
    nonce: [u8; ASKPASS_NONCE_BYTES],
    token: GitAccessToken,
    lifetime: Duration,
) {
    let deadline = Instant::now() + lifetime;
    let mut attempts = 0_usize;
    while Instant::now() < deadline && attempts < ASKPASS_MAX_ATTEMPTS {
        match cancel.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => return,
            Err(TryRecvError::Empty) => {}
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                attempts += 1;
                let _ = stream.set_read_timeout(Some(ASKPASS_IO_TIMEOUT));
                let _ = stream.set_write_timeout(Some(ASKPASS_IO_TIMEOUT));

                let mut request = [0_u8; ASKPASS_PROTOCOL_MAGIC.len() + ASKPASS_NONCE_BYTES];
                if stream.read_exact(&mut request).is_err()
                    || request[..ASKPASS_PROTOCOL_MAGIC.len()] != ASKPASS_PROTOCOL_MAGIC[..]
                    || !constant_time_eq(&request[ASKPASS_PROTOCOL_MAGIC.len()..], nonce.as_slice())
                {
                    continue;
                }

                let token_bytes = token.expose().as_bytes();
                if token_bytes.is_empty() || token_bytes.len() > ASKPASS_MAX_TOKEN_BYTES {
                    return;
                }
                let length = (token_bytes.len() as u32).to_be_bytes();
                if stream.write_all(&length).is_ok()
                    && stream.write_all(token_bytes).is_ok()
                    && stream.flush().is_ok()
                {
                    return;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return,
        }
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn decode_nonce(value: &str) -> Option<[u8; ASKPASS_NONCE_BYTES]> {
    if value.len() != ASKPASS_NONCE_BYTES * 2 || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    let mut nonce = [0_u8; ASKPASS_NONCE_BYTES];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = hex_value(pair[0])?;
        let low = hex_value(pair[1])?;
        nonce[index] = (high << 4) | low;
    }
    Some(nonce)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn classify_askpass_prompt(prompt: &str) -> Option<AskpassPromptKind> {
    let (remainder, kind) = if let Some(remainder) = prompt.strip_prefix("Username for '") {
        (remainder, AskpassPromptKind::Username)
    } else {
        let remainder = prompt.strip_prefix("Password for '")?;
        (remainder, AskpassPromptKind::Password)
    };
    let quote = remainder.find('\'')?;
    if remainder[quote + 1..].trim() != ":" {
        return None;
    }
    let candidate = &remainder[..quote];
    if candidate.contains('\\') || candidate.chars().any(|character| character.is_control()) {
        return None;
    }
    let url = Url::parse(candidate).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.port().is_some_and(|port| port != 443)
        || url.query().is_some()
        || url.fragment().is_some()
        || url.password().is_some()
    {
        return None;
    }
    match kind {
        AskpassPromptKind::Username if !url.username().is_empty() => None,
        AskpassPromptKind::Password
            if !url.username().is_empty() && url.username() != "x-access-token" =>
        {
            None
        }
        _ => Some(kind),
    }
}

fn validate_askpass_channel(
    endpoint: &str,
    nonce: &str,
) -> Result<(SocketAddr, [u8; ASKPASS_NONCE_BYTES]), String> {
    let address = endpoint
        .parse::<SocketAddr>()
        .map_err(|_| "Canale askpass non valido.".to_string())?;
    match address {
        SocketAddr::V4(address) if *address.ip() == Ipv4Addr::LOCALHOST && address.port() != 0 => {}
        _ => return Err("Canale askpass non valido.".to_string()),
    }
    let nonce = decode_nonce(nonce).ok_or_else(|| "Sessione askpass non valida.".to_string())?;
    Ok((address, nonce))
}

fn request_askpass_token(endpoint: &str, nonce: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    let (address, nonce) = validate_askpass_channel(endpoint, nonce)?;
    let mut stream = TcpStream::connect_timeout(&address, ASKPASS_CONNECT_TIMEOUT)
        .map_err(|_| "Canale askpass non disponibile.".to_string())?;
    stream
        .set_read_timeout(Some(ASKPASS_IO_TIMEOUT))
        .map_err(|_| "Canale askpass non disponibile.".to_string())?;
    stream
        .set_write_timeout(Some(ASKPASS_IO_TIMEOUT))
        .map_err(|_| "Canale askpass non disponibile.".to_string())?;
    stream
        .write_all(ASKPASS_PROTOCOL_MAGIC)
        .and_then(|_| stream.write_all(&nonce))
        .and_then(|_| stream.flush())
        .map_err(|_| "Canale askpass non disponibile.".to_string())?;

    let mut encoded_length = [0_u8; 4];
    stream
        .read_exact(&mut encoded_length)
        .map_err(|_| "Risposta askpass non valida.".to_string())?;
    let length = u32::from_be_bytes(encoded_length) as usize;
    if length == 0 || length > ASKPASS_MAX_TOKEN_BYTES {
        return Err("Risposta askpass non valida.".to_string());
    }
    let mut token = Zeroizing::new(vec![0_u8; length]);
    stream
        .read_exact(token.as_mut_slice())
        .map_err(|_| "Risposta askpass non valida.".to_string())?;
    if token
        .iter()
        .any(|byte| !byte.is_ascii() || byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err("Risposta askpass non valida.".to_string());
    }
    Ok(token)
}

pub(crate) fn run_askpass_if_requested() -> Option<i32> {
    let endpoint = std::env::var_os(GITHUB_ASKPASS_ENDPOINT_ENV);
    let nonce = std::env::var_os(GITHUB_ASKPASS_NONCE_ENV);
    let legacy = std::env::var_os(LEGACY_GITHUB_ASKPASS_MODE_ENV).is_some();
    if endpoint.is_none() && nonce.is_none() && !legacy {
        return None;
    }
    let (Some(endpoint), Some(nonce)) = (endpoint, nonce) else {
        return Some(1);
    };
    let Some(endpoint) = endpoint.to_str() else {
        return Some(1);
    };
    let Some(nonce) = nonce.to_str() else {
        return Some(1);
    };
    if validate_askpass_channel(endpoint, nonce).is_err() {
        return Some(1);
    }
    let prompt_parts = std::env::args_os().skip(1).collect::<Vec<_>>();
    let Some(prompt_parts) = prompt_parts
        .iter()
        .map(|part| part.to_str())
        .collect::<Option<Vec<_>>>()
    else {
        return Some(1);
    };
    let prompt = prompt_parts.join(" ");
    let Some(kind) = classify_askpass_prompt(&prompt) else {
        return Some(1);
    };

    let result = match kind {
        AskpassPromptKind::Username => {
            let mut stdout = std::io::stdout().lock();
            stdout
                .write_all(b"x-access-token\n")
                .and_then(|_| stdout.flush())
                .map_err(|_| "Output askpass non disponibile.".to_string())
        }
        AskpassPromptKind::Password => request_askpass_token(endpoint, nonce).and_then(|token| {
            let mut stdout = std::io::stdout().lock();
            stdout
                .write_all(token.as_slice())
                .and_then(|_| stdout.write_all(b"\n"))
                .and_then(|_| stdout.flush())
                .map_err(|_| "Output askpass non disponibile.".to_string())
        }),
    };
    Some(if result.is_ok() { 0 } else { 1 })
}

fn validate_github_remote(
    repository_full_name: &str,
    clone_url: &str,
) -> Result<ValidatedGitHubRemote, AppError> {
    if repository_full_name.is_empty()
        || repository_full_name != repository_full_name.trim()
        || repository_full_name.len() > 255
        || clone_url.is_empty()
        || clone_url != clone_url.trim()
        || clone_url.len() > 2_048
        || !clone_url.starts_with("https://github.com/")
        || repository_full_name
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
        || clone_url.chars().any(|character| {
            character.is_control() || character.is_whitespace() || matches!(character, '\\' | '%')
        })
    {
        return Err(AppError::translated(
            "invalidRequest",
            "remote.invalidGitHubInput",
            "Invalid GitHub repository or clone URL.",
        ));
    }

    let mut full_name_parts = repository_full_name.split('/');
    let owner = full_name_parts.next().unwrap_or_default();
    let repository = full_name_parts.next().unwrap_or_default();
    if owner.is_empty()
        || repository.is_empty()
        || full_name_parts.next().is_some()
        || matches!(owner, "." | "..")
        || matches!(repository, "." | "..")
    {
        return Err(AppError::translated(
            "invalidRequest",
            "remote.fullNameFormat",
            "The GitHub full name must have the form owner/repository.",
        ));
    }

    let url = Url::parse(clone_url).map_err(|_| {
        AppError::translated(
            "invalidRequest",
            "remote.invalidCloneUrl",
            "The clone URL of the GitHub repository is not valid.",
        )
    })?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::translated(
            "invalidRequest",
            "remote.httpsOnly",
            "Only HTTPS github.com URLs are allowed, with no credentials, port, query or fragment.",
        ));
    }

    let segments = url
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();
    if segments.len() != 2 || segments.iter().any(|segment| segment.is_empty()) {
        return Err(AppError::translated(
            "invalidRequest",
            "remote.urlMustBeOwnerRepository",
            "The GitHub URL must identify exactly owner/repository.",
        ));
    }
    let url_owner = segments[0];
    let url_repository = segments[1].strip_suffix(".git").unwrap_or(segments[1]);
    if url_repository.is_empty()
        || !owner.eq_ignore_ascii_case(url_owner)
        || !repository.eq_ignore_ascii_case(url_repository)
    {
        return Err(AppError::translated(
            "invalidRequest",
            "remote.fullNameMismatch",
            "repositoryFullName does not match the repository named by cloneUrl.",
        ));
    }

    Ok(ValidatedGitHubRemote {
        full_name: repository_full_name.to_string(),
        clone_url: clone_url.to_string(),
    })
}

/// Decides where the clone will land, refusing in advance everything that must
/// not even reach the network.
///
/// It lives apart from the network call because it is the only part verifiable
/// without contacting GitHub, and it is also the one where being wrong costs
/// most: a collision or a nesting must surface before the download, not after.
fn prepare_clone_destination(
    parent: &Path,
    remote: &ValidatedGitHubRemote,
    folder_name: Option<&str>,
) -> Result<PathBuf, AppError> {
    if !parent.is_dir() {
        return Err(AppError::translated(
            "invalidRequest",
            "clone.destinationNotFolder",
            format!("The destination is not a folder: {}", parent.display()),
        )
        .with("path", parent.display().to_string()));
    }

    let default_name = remote.full_name.split('/').nth(1).unwrap_or_default();
    let name = folder_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(default_name);
    let name = validate_folder_name(name)?;

    // Cloning inside an existing repository produces a nesting neither side
    // handles well. Linking already applies the same rule;
    // `ancestor_with_git_metadata` skips the folder itself, so that one has to
    // be looked at separately.
    if fs::symlink_metadata(parent.join(".git")).is_ok() {
        return Err(AppError::translated(
            "invalidRequest",
            "clone.parentIsRepository",
            format!(
                "The chosen folder is already a Git repository: {}. Choose one that is not.",
                parent.display()
            ),
        )
        .with("path", parent.display().to_string()));
    }
    if let Some(root) = ancestor_with_git_metadata(parent)? {
        return Err(AppError::translated(
            "invalidRequest",
            "clone.parentInsideRepository",
            format!(
                "The chosen folder is inside the repository '{}'. Choose one outside it.",
                root.display()
            ),
        )
        .with("repository", root.display().to_string()));
    }

    let destination = parent.join(&name);
    if fs::symlink_metadata(&destination).is_ok() {
        return Err(AppError::translated(
            "invalidRequest",
            "clone.nameTaken",
            format!("'{name}' already exists in this folder: choose another name."),
        )
        .with("name", name.clone()));
    }

    Ok(destination)
}

/// Accepts only a simple folder name.
///
/// The name ends up on the `git clone` command line and becomes a path: a
/// separator would take it out of the chosen folder, and a leading dash would
/// have it read as an option even though `--` already protects it. The
/// characters excluded at the end are the ones Windows does not preserve.
fn validate_folder_name(name: &str) -> Result<String, AppError> {
    let invalid = name.is_empty()
        || name.len() > 128
        || name != name.trim()
        || matches!(name, "." | "..")
        || name.starts_with('-')
        || name.ends_with('.')
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
        });

    if invalid {
        return Err(AppError::translated(
            "invalidRequest",
            "clone.folderNameInvalid",
            "Invalid folder name: use a simple name, with no path separators.",
        ));
    }

    Ok(name.to_string())
}

/// Arguments that harden a network command.
///
/// The policy, made explicit because until now it was an `if` in the middle of
/// another function and got read by accident:
///
/// **With the GitHub token** the app is the only source of credentials. The
/// system credential helper is emptied — otherwise it could answer in place of
/// the broker, with credentials the user did not choose for this operation —
/// along with proxies, redirects and extra headers: they are all channels
/// through which the token could end up elsewhere.
///
/// **Without a token**, that is on every remote which is not GitHub over HTTPS,
/// there is no secret of the app to protect and Git stays the system's own: the
/// credential helper the user configured keeps working, and that is how GitLab,
/// Bitbucket or a company server stay usable without this app having to keep
/// other credentials. The terminal prompt stays disabled regardless, because
/// there is no terminal here and Git would hang until the deadline.
fn network_hardening_args(authenticated: bool) -> Vec<OsString> {
    if !authenticated {
        return Vec::new();
    }

    vec![
        OsString::from("-c"),
        OsString::from("credential.helper="),
        OsString::from("-c"),
        OsString::from("credential.username=x-access-token"),
        OsString::from("-c"),
        OsString::from("credential.useHttpPath=true"),
        OsString::from("-c"),
        OsString::from(format!("core.hooksPath={DISABLED_GIT_HOOKS_PATH}")),
        OsString::from("-c"),
        OsString::from("http.sslVerify=true"),
        OsString::from("-c"),
        OsString::from("http.proxy="),
        OsString::from("-c"),
        OsString::from("http.followRedirects=false"),
        OsString::from("-c"),
        OsString::from("http.extraHeader="),
    ]
}

/// Accepts only a simple remote name.
///
/// Git accepts far more than this, but a name with separators or with a leading
/// dash is the only way for this value, which ends up on the command line, to
/// mean something other than a remote.
fn validate_remote_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    let invalid = trimmed.is_empty()
        || trimmed.len() > 100
        || trimmed.starts_with('-')
        || trimmed.starts_with('.')
        || !trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        });

    if invalid {
        return Err(AppError::translated(
            "invalidRequest",
            "remote.invalidName",
            "Invalid remote name: use letters, numbers, dashes or dots.",
        ));
    }

    Ok(trimmed.to_string())
}

/// Accepts only URLs that lead to an ordinary Git transport.
///
/// Refusing `::` is not cosmetic: it is the syntax of transport helpers, with
/// which a URL like `ext::sh -c ...` runs an arbitrary command at every fetch.
/// The rest of the defence is `protocol.ext.allow=never` at network time, but a
/// URL like that must not even be writable into the configuration.
fn validate_remote_url(url: &str) -> Result<String, AppError> {
    let trimmed = url.trim();
    let invalid = trimmed.is_empty()
        || trimmed.len() > 2_048
        || trimmed.starts_with('-')
        || trimmed.contains("::")
        || trimmed
            .chars()
            .any(|character| character.is_control() || character.is_whitespace());

    if invalid {
        return Err(AppError::translated(
            "invalidRequest",
            "remote.invalidUrl",
            "Invalid remote URL: no spaces, control characters or transport helpers.",
        ));
    }

    Ok(trimmed.to_string())
}

/// Translates `%(upstream:trackshort)` into a stable word.
///
/// Git uses `>`, `<`, `<>` and `=`; an empty string with an upstream configured
/// means the upstream no longer exists.
fn describe_track(trackshort: &str, has_upstream: bool) -> Option<String> {
    if !has_upstream {
        return None;
    }
    Some(
        match trackshort.trim() {
            ">" => "ahead",
            "<" => "behind",
            "<>" => "diverged",
            "=" => "same",
            _ => "gone",
        }
        .to_string(),
    )
}

fn cap_history(mut commits: Vec<CommitEntry>, max_commits: usize) -> (Vec<CommitEntry>, bool) {
    let truncated = commits.len() > max_commits;
    commits.truncate(max_commits);
    (commits, truncated)
}

fn valid_stash_object_id(object_id: &str) -> bool {
    matches!(object_id.len(), 40 | 64) && object_id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn stash_changed_since_load() -> AppError {
    AppError::translated(
        "conflict",
        "stash.changedSinceLoad",
        "The stash list changed since it was loaded. Refresh it and try again.",
    )
}

fn stash_applied_but_kept() -> AppError {
    AppError::translated(
        "partialSuccess",
        "stash.appliedButKept",
        "The changes were applied, but the stash entry was kept because it could not be removed safely. Refresh the list before trying again.",
    )
}

fn stash_action_failed(error: AppError) -> AppError {
    AppError::translated(
        "internal",
        "stash.actionFailed",
        format!("The stash operation failed: {}", error.message),
    )
    .with("reason", error.message)
}

fn github_remote_matches(expected: &ValidatedGitHubRemote, existing_url: &str) -> bool {
    validate_github_remote(&expected.full_name, existing_url).is_ok()
        || (existing_url
            .chars()
            .all(|character| !character.is_control() && !character.is_whitespace())
            && existing_url
                .eq_ignore_ascii_case(&format!("git@github.com:{}.git", expected.full_name)))
}

fn is_not_a_git_repository_error(error: &str) -> bool {
    error.to_ascii_lowercase().contains("not a git repository")
}

fn ancestor_with_git_metadata(folder: &Path) -> Result<Option<PathBuf>, AppError> {
    for ancestor in folder.ancestors().skip(1) {
        match fs::symlink_metadata(ancestor.join(".git")) {
            Ok(_) => return Ok(Some(ancestor.to_path_buf())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(AppError::translated(
                    "internal",
                    "clone.parentMetadataUnreadable",
                    format!(
                        "The Git metadata of the parent folder '{}' could not be checked: {error}",
                        ancestor.display()
                    ),
                )
                .with("path", ancestor.display().to_string())
                .with("reason", error.to_string()));
            }
        }
    }
    Ok(None)
}

fn is_safe_git_metadata_directory(metadata: &fs::Metadata) -> bool {
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return false;
    }

    #[cfg(target_os = "windows")]
    if metadata.file_attributes() & 0x0000_0400 != 0 {
        return false;
    }

    true
}

/// Parses the output of `git status --porcelain=v2 -z`.
///
/// The records are separated by NUL, not by newlines. The difference is not
/// cosmetic: without `-z` Git applies C-quoting to paths containing quotes,
/// backslashes or control characters, and `core.quotepath=false` only disables
/// the quoting of non-ASCII bytes. A file called `report"final".txt` therefore
/// arrived as a literal string with quotes and backslashes, the pathspec built
/// from it matched nothing, and stage and discard on that file did nothing — in
/// silence, with no error.
fn parse_porcelain_v2(output: &str) -> ParsedStatus {
    let mut parsed = ParsedStatus::default();
    let mut records = output.split('\0').filter(|record| !record.is_empty());

    while let Some(record) = records.next() {
        if let Some(branch) = record.strip_prefix("# branch.head ") {
            parsed.branch = Some(branch.trim().to_string());
            continue;
        }
        if let Some(upstream) = record.strip_prefix("# branch.upstream ") {
            parsed.upstream = Some(upstream.trim().to_string());
            continue;
        }
        if let Some(counts) = record.strip_prefix("# branch.ab ") {
            for part in counts.split_whitespace() {
                if let Some(ahead) = part.strip_prefix('+') {
                    parsed.ahead = ahead.parse().unwrap_or(0);
                } else if let Some(behind) = part.strip_prefix('-') {
                    parsed.behind = behind.parse().unwrap_or(0);
                }
            }
            continue;
        }

        // In the `-z` format the original path of a rename is a record of its
        // own, not a TAB-separated field inside the same record.
        let original_path = if record.starts_with('2') {
            records.next()
        } else {
            None
        };

        if let Some(change) = parse_change_record(record, original_path) {
            parsed.changes.push(change);
        }
    }

    parsed
}

fn parse_change_record(record: &str, original_path: Option<&str>) -> Option<FileChange> {
    if let Some(path) = record.strip_prefix("? ") {
        return Some(FileChange {
            path: path.to_string(),
            original_path: None,
            index_status: "?".to_string(),
            worktree_status: "?".to_string(),
            staged: false,
            unstaged: false,
            untracked: true,
            conflicted: false,
        });
    }

    let (xy, path, original_path, forced_conflict) = match record.chars().next()? {
        '1' => {
            let fields = record.splitn(9, ' ').collect::<Vec<_>>();
            (*fields.get(1)?, (*fields.get(8)?).to_string(), None, false)
        }
        '2' => {
            // The original path comes from the next record, not from a field
            // after a TAB: that is the difference `-z` introduces.
            let fields = record.splitn(10, ' ').collect::<Vec<_>>();
            (
                *fields.get(1)?,
                (*fields.get(9)?).to_string(),
                Some(original_path?.to_string()),
                false,
            )
        }
        'u' => {
            let fields = record.splitn(11, ' ').collect::<Vec<_>>();
            (*fields.get(1)?, (*fields.get(10)?).to_string(), None, true)
        }
        _ => return None,
    };

    let mut status = xy.chars();
    let index_status = status.next().unwrap_or('.');
    let worktree_status = status.next().unwrap_or('.');
    let conflicted = forced_conflict || index_status == 'U' || worktree_status == 'U';

    Some(FileChange {
        path,
        original_path,
        index_status: index_status.to_string(),
        worktree_status: worktree_status.to_string(),
        staged: index_status != '.' && !conflicted,
        unstaged: worktree_status != '.' && !conflicted,
        untracked: false,
        conflicted,
    })
}

fn literal_pathspec(path: &str) -> OsString {
    OsString::from(format!(":(literal){path}"))
}

fn pathspecs_for_changes(changes: &[FileChange], include_original_paths: bool) -> Vec<OsString> {
    let mut seen = HashSet::new();
    let mut pathspecs = Vec::with_capacity(changes.len() * 2);

    for change in changes {
        if seen.insert(change.path.as_str()) {
            pathspecs.push(literal_pathspec(&change.path));
        }
        if include_original_paths {
            if let Some(original_path) = change.original_path.as_deref() {
                if seen.insert(original_path) {
                    pathspecs.push(literal_pathspec(original_path));
                }
            }
        }
    }

    pathspecs
}

fn selected_files_message(count: usize, singular: &str, plural: &str) -> String {
    if count == 1 {
        format!("1 file {singular}.")
    } else {
        format!("{count} file {plural}.")
    }
}

fn remove_untracked_file(repo_path: &Path, git_path: &str) -> Result<(), AppError> {
    let relative = Path::new(git_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::translated(
            "forbidden",
            "discard.unsafeNewFilePath",
            format!("The path of the new file is not safe and was not deleted: '{git_path}'."),
        )
        .with("path", git_path));
    }

    let target = repo_path.join(relative);
    let parent = target.parent().ok_or_else(|| {
        AppError::translated(
            "invalidRequest",
            "discard.noValidParent",
            format!("The path '{git_path}' has no valid folder."),
        )
        .with("path", git_path)
    })?;
    let canonical_parent = parent.canonicalize().map_err(|error| {
        AppError::translated(
            "internal",
            "discard.parentUnreadable",
            format!(
                "The folder of the new file '{}' is not accessible: {error}",
                target.display()
            ),
        )
        .with("path", target.display().to_string())
        .with("reason", error.to_string())
    })?;
    if !canonical_parent.starts_with(repo_path) {
        return Err(AppError::translated(
            "forbidden",
            "discard.outsideRepository",
            format!(
                "The new file '{}' points outside the repository and was not deleted.",
                target.display()
            ),
        )
        .with("path", target.display().to_string()));
    }
    let metadata = fs::symlink_metadata(&target).map_err(|error| {
        AppError::translated(
            "notFound",
            "discard.fileGone",
            format!(
                "The new file '{}' is no longer accessible: {error}",
                target.display()
            ),
        )
        .with("path", target.display().to_string())
        .with("reason", error.to_string())
    })?;

    if metadata.is_dir() {
        return Err(AppError::translated(
            "forbidden",
            "discard.untrackedDirectory",
            format!(
                "The untracked folder '{}' was not deleted. Remove nested folders and repositories by hand.",
                target.display()
            ),
        )
        .with("path", target.display().to_string()));
    }
    if !metadata.is_file() && !metadata.file_type().is_symlink() {
        return Err(AppError::translated(
            "forbidden",
            "discard.specialPath",
            format!("The special path '{}' was not deleted.", target.display()),
        )
        .with("path", target.display().to_string()));
    }

    fs::remove_file(&target).map_err(|error| {
        AppError::translated(
            "internal",
            "discard.deleteFailed",
            format!("'{}' could not be deleted: {error}", target.display()),
        )
        .with("path", target.display().to_string())
        .with("reason", error.to_string())
    })
}

fn redact_remote_url(url: &str) -> String {
    let Some((scheme, remainder)) = url.split_once("://") else {
        return url.to_string();
    };
    let authority_end = remainder.find(['/', '?', '#']).unwrap_or(remainder.len());
    let (authority, suffix) = remainder.split_at(authority_end);
    let http = scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https");

    let sanitized_authority = match authority.rsplit_once('@') {
        // In HTTP(S) even a username-only userinfo may be an access token.
        Some((_, host)) if http => host.to_string(),
        // `ssh://git@host/path` is an ordinary, reusable SSH URL. Preserve that
        // username, while removing an inline password if one was configured.
        Some((userinfo, host)) if scheme.eq_ignore_ascii_case("ssh") => userinfo
            .split_once(':')
            .map(|(username, _)| format!("{username}@{host}"))
            .unwrap_or_else(|| authority.to_string()),
        // Unknown URL-style transports get the conservative treatment: keep
        // the endpoint but do not expose any userinfo to the webview.
        Some((_, host)) => host.to_string(),
        None => authority.to_string(),
    };
    // Query strings and fragments can carry credentials on any URL-style
    // transport, not only HTTP. They are not needed for display and must never
    // cross the IPC boundary.
    let end = suffix.find(['?', '#']).unwrap_or(suffix.len());
    let sanitized_suffix = &suffix[..end];

    format!("{scheme}://{sanitized_authority}{sanitized_suffix}")
}

fn is_github_https_remote(remote_url: &str) -> bool {
    if remote_url.contains(['\\', '%'])
        || remote_url
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return false;
    }

    let Ok(url) = Url::parse(remote_url) else {
        return false;
    };

    let segments = url
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();
    let repository = segments
        .get(1)
        .map(|repository| {
            repository
                .strip_suffix(".git")
                .unwrap_or(repository.as_ref())
        })
        .unwrap_or_default();

    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case("github.com"))
        && url.port().is_none_or(|port| port == 443)
        && url.query().is_none()
        && url.fragment().is_none()
        && segments.len() == 2
        && !segments[0].is_empty()
        && !repository.is_empty()
}

fn combine_outputs(first: String, second: String) -> String {
    match (first.is_empty(), second.is_empty()) {
        (true, _) => second,
        (_, true) => first,
        (false, false) => format!("{first}\n{second}"),
    }
}

/// Wraps Git's output in an error **without translating it**: those are Git's
/// words, not the application's, and must be shown as it wrote them. Only the
/// fallback gets an identifier, for when Git says nothing.
fn git_output_error(output: &Output) -> AppError {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() { stderr } else { stdout };
    if message.is_empty() {
        AppError::translated(
            "internal",
            "git.exitedWithCode",
            format!("Git exited with code {}.", output.status),
        )
        .with("code", output.status.to_string())
    } else {
        // No identifier: these are Git's words, and must be shown as it wrote
        // them. The generic code says exactly that — the cause was not told
        // apart by the application.
        AppError::new(
            crate::errors::GENERIC_CODE,
            truncate_utf8(message, MAX_LOG_BYTES).0,
        )
    }
}

/// Cuts on a character boundary and says whether it cut.
///
/// The value comes back **without** a marker. "… output truncated …" used to be
/// appended inside the string: convenient, but it was application text sewn into
/// Git's output, and therefore impossible to translate without touching Git's
/// words too. The cut is reported by the boolean, which was already there and
/// was thrown away by half the callers; the sentence is written by whoever holds
/// the dictionary.
fn truncate_utf8(value: String, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value, false);
    }

    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_string(), true)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn repo_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string())
}

fn success_named(
    path: &Path,
    name: &str,
    operation: &str,
    message: impl Into<String>,
    output: String,
) -> OperationResult {
    let (truncated_output, output_truncated) = truncate_utf8(output, MAX_LOG_BYTES);
    OperationResult {
        repo_path: path.to_string_lossy().to_string(),
        repo_name: name.to_string(),
        operation: operation.to_string(),
        success: true,
        code: OPERATION_OK.to_string(),
        message: message.into(),
        message_id: None,
        params: BTreeMap::new(),
        output: truncated_output,
        output_truncated,
    }
}

fn failure(repo_path: &str, operation: &str, message: impl Into<String>) -> OperationResult {
    let path = PathBuf::from(repo_path);
    let name = repo_name(&path);
    failure_named(&path, &name, operation, message)
}

/// Turns an error into an outcome without losing the identifier.
///
/// It is the bridge between the two paths. Without it, a translated error from
/// `git.rs` that ends up in the activity log would go back to being a single
/// sentence, and converting the error type would have served nothing precisely
/// where the user reads.
fn failure_from_path(repo_path: &str, operation: &str, error: AppError) -> OperationResult {
    let path = PathBuf::from(repo_path);
    let name = repo_name(&path);
    failure_from(&path, &name, operation, error)
}

fn failure_from(path: &Path, name: &str, operation: &str, error: AppError) -> OperationResult {
    let cancelled = error.code == OPERATION_CANCELLED;
    let mut result = failure_named(path, name, operation, error.message);
    result.message_id = error.message_id;
    result.params = error.params;
    if cancelled {
        result.code = OPERATION_CANCELLED.to_string();
    }
    result
}

fn failure_named(
    path: &Path,
    name: &str,
    operation: &str,
    message: impl Into<String>,
) -> OperationResult {
    OperationResult {
        repo_path: path.to_string_lossy().to_string(),
        repo_name: name.to_string(),
        operation: operation.to_string(),
        success: false,
        code: OPERATION_FAILED.to_string(),
        message: message.into(),
        message_id: None,
        params: BTreeMap::new(),
        output: String::new(),
        output_truncated: false,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use super::{
        cap_history, classify_askpass_prompt, failure_from, github_remote_matches,
        is_github_https_remote, literal_pathspec, network_hardening_args, now_millis,
        parse_porcelain_v2, prepare_clone_destination, redact_remote_url, request_askpass_token,
        run_over_repositories, truncate_utf8, valid_stash_object_id, validate_askpass_channel,
        validate_github_remote, validate_remote_name, validate_remote_url, wait_with_deadline,
        wait_with_deadline_until, AskpassBroker, AskpassPromptKind, CancellationState, CommitEntry,
        CommitRequest, ConflictAction, FileChange, GitClient, GitHubLinkRepositoryRequest,
        HistoryScope, PendingOperation, StashAction,
    };
    use super::{
        ASKPASS_SERVER_GRACE, LOCAL_COMMAND_TIMEOUT, MAX_CONCURRENT_REPOSITORIES,
        NETWORK_COMMAND_TIMEOUT,
    };
    use crate::github::GitAccessToken;

    static TEST_REPOSITORY_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TestRepository {
        path: PathBuf,
        git: GitClient,
    }

    impl TestRepository {
        fn empty_directory() -> Self {
            let suffix = TEST_REPOSITORY_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "rubyrepo-stage-test-{}-{}-{suffix}",
                std::process::id(),
                now_millis()
            ));
            fs::create_dir_all(&path).expect("create temporary Git repository");

            let git = GitClient::discover().expect("Git must be available for integration tests");
            Self { path, git }
        }

        fn new(with_initial_commit: bool) -> Self {
            let repository = Self::empty_directory();
            let path = &repository.path;
            let git = &repository.git;
            git.run(path, &["init", "--quiet"])
                .expect("initialize repository");
            git.run(path, &["config", "user.name", "RubyRepo Test"])
                .expect("configure test user name");
            git.run(
                path,
                &["config", "user.email", "repoflow-test@example.invalid"],
            )
            .expect("configure test user email");
            git.run(path, &["config", "commit.gpgsign", "false"])
                .expect("disable signing in test repository");
            git.run(path, &["config", "core.autocrlf", "false"])
                .expect("disable line-ending conversion in test repository");
            git.run(path, &["config", "core.hooksPath", ".git/no-hooks"])
                .expect("disable hooks in test repository");

            if with_initial_commit {
                repository.write("tracked.txt", "base\n");
                repository.write("other.txt", "other base\n");
                repository
                    .git
                    .run(&repository.path, &["add", "--", "."])
                    .expect("stage initial files");
                repository
                    .git
                    .run(&repository.path, &["commit", "--quiet", "-m", "initial"])
                    .expect("create initial commit");
            }

            repository
        }

        fn path_string(&self) -> String {
            self.path.to_string_lossy().to_string()
        }

        fn write(&self, relative: &str, contents: &str) {
            let target = self.path.join(relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).expect("create parent directory");
            }
            fs::write(target, contents).expect("write test file");
        }

        fn changes(&self) -> Vec<FileChange> {
            self.git
                .repository_changes(&self.path_string())
                .expect("read repository changes")
        }
    }

    /// A slow and portable process, to really exercise the kill-on-deadline
    /// path instead of hoping for a favourable race.
    #[cfg(target_os = "windows")]
    fn slow_command() -> Command {
        let mut command = Command::new("cmd");
        command.args(["/C", "ping", "-n", "6", "127.0.0.1"]);
        command
    }

    #[cfg(not(target_os = "windows"))]
    fn slow_command() -> Command {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 6"]);
        command
    }

    impl Drop for TestRepository {
        fn drop(&mut self) {
            let is_test_directory = self
                .path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("rubyrepo-stage-test-"));
            if is_test_directory {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
    }

    #[test]
    fn parses_branch_counts_and_file_states() {
        let status = concat!(
            "# branch.oid abcdef\0",
            "# branch.head main\0",
            "# branch.upstream origin/main\0",
            "# branch.ab +2 -1\0",
            "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb staged.txt\0",
            "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb folder/dirty file.txt\0",
            "? new.txt\0",
            "u UU N... 100644 100644 100644 100644 a b c conflict.txt\0",
        );

        let parsed = parse_porcelain_v2(status);
        assert_eq!(parsed.branch.as_deref(), Some("main"));
        assert_eq!(parsed.upstream.as_deref(), Some("origin/main"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
        assert_eq!(parsed.changes.len(), 4);
        assert!(parsed.changes[0].staged);
        assert!(parsed.changes[1].unstaged);
        assert!(parsed.changes[2].untracked);
        assert!(parsed.changes[3].conflicted);
    }

    #[test]
    fn parses_original_path_for_renames() {
        // With `-z` the original path is a separate record, not a field after
        // a TAB inside the same record.
        let parsed = parse_porcelain_v2(concat!(
            "2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 renamed.txt\0",
            "original.txt\0",
        ));

        assert_eq!(parsed.changes.len(), 1);
        assert_eq!(parsed.changes[0].path, "renamed.txt");
        assert_eq!(
            parsed.changes[0].original_path.as_deref(),
            Some("original.txt")
        );
    }

    /// The reason the format moved to `-z`. Without it, Git applies C-quoting
    /// to paths with quotes, backslashes or control characters --
    /// `core.quotepath=false` only disables the quoting of non-ASCII bytes --
    /// and the pathspec built from a quoted string matches no file: stage and
    /// discard did nothing, without even an error.
    #[test]
    fn paths_that_git_would_quote_arrive_verbatim() {
        let parsed = parse_porcelain_v2(concat!(
            "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb report\"finale\".txt\0",
            "? nome con \\ backslash.txt\0",
            "2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 nuovo nome.txt\0",
            "vecchio\"nome\".txt\0",
        ));

        assert_eq!(parsed.changes.len(), 3);
        assert_eq!(parsed.changes[0].path, "report\"finale\".txt");
        assert_eq!(parsed.changes[1].path, "nome con \\ backslash.txt");
        assert_eq!(parsed.changes[2].path, "nuovo nome.txt");
        assert_eq!(
            parsed.changes[2].original_path.as_deref(),
            Some("vecchio\"nome\".txt")
        );

        // The pathspec must carry the name exactly as it is on disk: that is
        // what previously matched nothing.
        assert_eq!(
            literal_pathspec(&parsed.changes[0].path),
            OsString::from(":(literal)report\"finale\".txt")
        );
    }

    /// The broker must keep listening for the whole life of the command it
    /// serves. It used to live a fixed 120 seconds while a network operation can
    /// last 300: a slow fetch that got round to asking for credentials after the
    /// second minute found the channel already closed and failed to authenticate
    /// — precisely in the condition where the user most needs it to work. The
    /// deadline now derives from the command's, and this test stops the two from
    /// diverging again.
    #[test]
    fn the_askpass_broker_outlives_the_command_it_serves() {
        assert!(
            ASKPASS_SERVER_GRACE > Duration::from_secs(0),
            "il broker deve sopravvivere al comando, non spegnersi insieme a lui"
        );
        assert!(
            NETWORK_COMMAND_TIMEOUT.saturating_add(ASKPASS_SERVER_GRACE) > NETWORK_COMMAND_TIMEOUT,
            "la scadenza del broker deve superare quella dell'operazione di rete"
        );
        assert!(
            LOCAL_COMMAND_TIMEOUT.saturating_add(ASKPASS_SERVER_GRACE) > LOCAL_COMMAND_TIMEOUT,
            "e anche quella delle operazioni locali"
        );
    }

    /// With more items than workers each thread has to take more than one: that
    /// is the work-stealing loop, the reason `run_over_repositories` exists. The
    /// commit test uses three repositories against four workers, so it never
    /// walks it.
    ///
    /// Git is not needed here: the unit under examination is the distribution of
    /// the work.
    #[test]
    fn work_is_distributed_and_results_stay_in_order_under_contention() {
        let total = MAX_CONCURRENT_REPOSITORIES * 5;
        let items = (0..total).collect::<Vec<usize>>();
        let seen_by = Mutex::new(Vec::new());
        let progress = Mutex::new(Vec::new());

        let results = run_over_repositories(
            items,
            &|item: usize| {
                seen_by
                    .lock()
                    .expect("mutex del test")
                    .push(std::thread::current().id());
                // A little asymmetric work, so the order of completion does
                // not coincide with the order of departure.
                std::thread::sleep(std::time::Duration::from_millis(
                    if item.is_multiple_of(2) { 6 } else { 1 },
                ));
                item * 10
            },
            &|completed, reported_total, _| {
                progress
                    .lock()
                    .expect("mutex del test")
                    .push((completed, reported_total));
            },
        );

        assert_eq!(
            results,
            (0..total).map(|item| item * 10).collect::<Vec<_>>(),
            "i risultati devono tornare nell'ordine di partenza, non di completamento"
        );

        let threads = seen_by.into_inner().expect("mutex del test");
        assert_eq!(threads.len(), total);
        let distinct = threads.iter().collect::<HashSet<_>>().len();
        assert!(
            distinct > 1 && distinct <= MAX_CONCURRENT_REPOSITORIES,
            "il lavoro deve essere distribuito su piu' thread ma non oltre il tetto: {distinct}"
        );
        assert!(
            threads.len() > distinct,
            "con piu' elementi che worker qualche thread deve prenderne piu' di uno"
        );

        let progress = progress.into_inner().expect("mutex del test");
        assert_eq!(progress.len(), total);
        assert!(progress.iter().all(|(_, reported)| *reported == total));
        let mut counters = progress.iter().map(|(done, _)| *done).collect::<Vec<_>>();
        counters.sort_unstable();
        assert_eq!(
            counters,
            (1..=total).collect::<Vec<_>>(),
            "ogni elemento deve produrre un avanzamento, senza salti ne ripetizioni"
        );
    }

    /// Batches run on several threads: the order of completion is not the order
    /// of departure. The results must still come back at their original
    /// position, otherwise the interface would attribute one repository's
    /// outcome to another — a silent error, and much worse than a failure.
    #[test]
    fn a_parallel_batch_keeps_results_aligned_with_their_requests() {
        let first = TestRepository::new(true);
        let second = TestRepository::new(true);
        let third = TestRepository::new(true);

        // Only the first and the third have anything to commit: if the results
        // slid by a position, the second's failure would land on the wrong row
        // and the test would notice.
        first.write("uno.txt", "contenuto uno\n");
        third.write("tre.txt", "contenuto tre\n");

        let requests = vec![
            CommitRequest {
                repo_path: first.path_string(),
                message: "primo".to_string(),
                stage_all: true,
            },
            CommitRequest {
                repo_path: second.path_string(),
                message: "secondo".to_string(),
                stage_all: true,
            },
            CommitRequest {
                repo_path: third.path_string(),
                message: "terzo".to_string(),
                stage_all: true,
            },
        ];

        let progress = Mutex::new(Vec::new());
        let results = first.git.commit_many(requests, &|completed, total, _| {
            progress
                .lock()
                .expect("il mutex del test non deve essere avvelenato")
                .push((completed, total));
        });

        // The comparison uses the folder name: `repo_path` is the canonical
        // form when the operation succeeds and the raw one when it fails, so it
        // is not a reliable discriminator.
        fn directory_name(repository: &TestRepository) -> String {
            repository
                .path
                .file_name()
                .expect("la cartella di prova ha un nome")
                .to_string_lossy()
                .to_string()
        }

        assert_eq!(results.len(), 3);
        assert_eq!(results[0].repo_name, directory_name(&first));
        assert_eq!(results[1].repo_name, directory_name(&second));
        assert_eq!(results[2].repo_name, directory_name(&third));
        assert!(results[0].success, "{}", results[0].message);
        assert!(
            !results[1].success,
            "la repository senza modifiche non deve produrre un commit"
        );
        assert!(results[2].success, "{}", results[2].message);

        let progress = progress.into_inner().expect("mutex del test");
        assert_eq!(progress.len(), 3, "un avanzamento per repository");
        assert!(progress.iter().all(|(_, total)| *total == 3));
        let mut completed = progress.iter().map(|(done, _)| *done).collect::<Vec<_>>();
        completed.sort_unstable();
        assert_eq!(
            completed,
            vec![1, 2, 3],
            "il conteggio deve avanzare una volta per repository, senza salti ne ripetizioni"
        );
    }

    #[test]
    fn creates_a_partial_commit_from_only_staged_files() {
        let repository = TestRepository::new(true);
        repository.write("tracked.txt", "committed change\n");
        repository.write("other.txt", "working tree only\n");

        let staged = repository
            .git
            .stage_files(&repository.path_string(), vec!["tracked.txt".to_string()]);
        assert!(staged.success, "{}", staged.message);

        let result = repository.git.commit_many(
            vec![CommitRequest {
                repo_path: repository.path_string(),
                message: "partial commit".to_string(),
                stage_all: false,
            }],
            &|_, _, _| {},
        );
        assert!(result[0].success, "{}", result[0].message);
        assert_eq!(
            repository
                .git
                .run(&repository.path, &["show", "HEAD:tracked.txt"])
                .expect("read committed tracked file"),
            "committed change"
        );
        assert_eq!(
            repository
                .git
                .run(&repository.path, &["show", "HEAD:other.txt"])
                .expect("read committed other file"),
            "other base"
        );
        let other = repository
            .changes()
            .into_iter()
            .find(|change| change.path == "other.txt")
            .expect("other file remains modified");
        assert!(other.unstaged);
        assert!(!other.staged);
    }

    #[test]
    fn discard_preserves_staged_content_and_unstage_preserves_worktree() {
        let repository = TestRepository::new(true);
        repository.write("tracked.txt", "staged version\n");
        let result = repository
            .git
            .stage_files(&repository.path_string(), vec!["tracked.txt".to_string()]);
        assert!(result.success, "{}", result.message);

        repository.write("tracked.txt", "later working version\n");
        let before = repository
            .changes()
            .into_iter()
            .find(|change| change.path == "tracked.txt")
            .expect("tracked file is changed");
        assert!(before.staged && before.unstaged);

        let discarded = repository
            .git
            .discard_files(&repository.path_string(), vec!["tracked.txt".to_string()]);
        assert!(discarded.success, "{}", discarded.message);
        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("read restored file"),
            "staged version\n"
        );
        let after_discard = repository
            .changes()
            .into_iter()
            .find(|change| change.path == "tracked.txt")
            .expect("staged change remains");
        assert!(after_discard.staged);
        assert!(!after_discard.unstaged);

        let unstaged = repository
            .git
            .unstage_files(&repository.path_string(), vec!["tracked.txt".to_string()]);
        assert!(unstaged.success, "{}", unstaged.message);
        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("read unstaged file"),
            "staged version\n"
        );
        let after_unstage = repository
            .changes()
            .into_iter()
            .find(|change| change.path == "tracked.txt")
            .expect("working tree change remains");
        assert!(!after_unstage.staged);
        assert!(after_unstage.unstaged);
    }

    #[test]
    fn literal_pathspecs_do_not_select_similar_untracked_files() {
        let repository = TestRepository::new(true);
        repository.write("file[1].txt", "selected\n");
        repository.write("file1.txt", "must remain untouched\n");

        let staged = repository
            .git
            .stage_files(&repository.path_string(), vec!["file[1].txt".to_string()]);
        assert!(staged.success, "{}", staged.message);
        let changes = repository.changes();
        assert!(changes
            .iter()
            .any(|change| change.path == "file[1].txt" && change.staged));
        assert!(changes
            .iter()
            .any(|change| change.path == "file1.txt" && change.untracked));

        let unstaged = repository
            .git
            .unstage_files(&repository.path_string(), vec!["file[1].txt".to_string()]);
        assert!(unstaged.success, "{}", unstaged.message);
        let discarded = repository
            .git
            .discard_files(&repository.path_string(), vec!["file[1].txt".to_string()]);
        assert!(discarded.success, "{}", discarded.message);
        assert!(!repository.path.join("file[1].txt").exists());
        assert!(repository.path.join("file1.txt").exists());
    }

    #[test]
    fn selects_the_eligible_entry_when_a_path_has_two_status_records() {
        let repository = TestRepository::new(true);
        repository
            .git
            .run(&repository.path, &["rm", "--cached", "--", "tracked.txt"])
            .expect("remove tracked file only from index");

        let same_path = repository
            .changes()
            .into_iter()
            .filter(|change| change.path == "tracked.txt")
            .collect::<Vec<_>>();
        assert!(same_path.iter().any(|change| change.staged));
        assert!(same_path.iter().any(|change| change.untracked));

        let result = repository
            .git
            .stage_files(&repository.path_string(), vec!["tracked.txt".to_string()]);
        assert!(result.success, "{}", result.message);
        assert!(repository
            .changes()
            .iter()
            .all(|change| change.path != "tracked.txt"));
    }

    #[test]
    fn discard_refuses_untracked_directories_and_nested_repositories() {
        let repository = TestRepository::new(true);
        let nested = repository.path.join("nested-repository");
        fs::create_dir_all(&nested).expect("create nested repository directory");
        repository
            .git
            .run(&nested, &["init", "--quiet"])
            .expect("initialize nested repository");

        let nested_change = repository
            .changes()
            .into_iter()
            .find(|change| change.untracked && change.path.starts_with("nested-repository"))
            .expect("nested repository is reported as untracked");
        let result = repository
            .git
            .discard_files(&repository.path_string(), vec![nested_change.path]);

        assert!(!result.success);
        assert!(nested.join(".git").exists());
    }

    #[test]
    fn unstage_works_before_the_first_commit_and_for_renames() {
        let unborn = TestRepository::new(false);
        unborn.write("first.txt", "staged version\n");
        let staged = unborn
            .git
            .stage_files(&unborn.path_string(), vec!["first.txt".to_string()]);
        assert!(staged.success, "{}", staged.message);
        unborn.write("first.txt", "working version\n");
        let unstaged = unborn
            .git
            .unstage_files(&unborn.path_string(), vec!["first.txt".to_string()]);
        assert!(unstaged.success, "{}", unstaged.message);
        assert_eq!(
            fs::read_to_string(unborn.path.join("first.txt")).expect("read unborn file"),
            "working version\n"
        );
        assert!(unborn
            .changes()
            .iter()
            .any(|change| change.path == "first.txt" && change.untracked));

        let renamed = TestRepository::new(true);
        renamed
            .git
            .run(&renamed.path, &["mv", "--", "tracked.txt", "renamed.txt"])
            .expect("rename tracked file");
        let rename_change = renamed
            .changes()
            .into_iter()
            .find(|change| change.path == "renamed.txt")
            .expect("renamed file is reported");
        assert_eq!(rename_change.original_path.as_deref(), Some("tracked.txt"));

        let result = renamed
            .git
            .unstage_files(&renamed.path_string(), vec!["renamed.txt".to_string()]);
        assert!(result.success, "{}", result.message);
        assert!(renamed.changes().iter().all(|change| !change.staged));
        assert!(renamed.path.join("renamed.txt").exists());
    }

    #[test]
    fn askpass_prompts_require_an_exact_github_https_origin() {
        assert_eq!(
            classify_askpass_prompt("Username for 'https://github.com/Example/Project.git': "),
            Some(AskpassPromptKind::Username)
        );
        assert_eq!(
            classify_askpass_prompt(
                "Password for 'https://x-access-token@github.com/Example/Project.git': "
            ),
            Some(AskpassPromptKind::Password)
        );
        assert_eq!(
            classify_askpass_prompt(
                "Password for 'https://x-access-token@github.com:443/Example/Project.git': "
            ),
            Some(AskpassPromptKind::Password)
        );

        for prompt in [
            "Password for 'http://github.com/Example/Project.git': ",
            "Password for 'https://github.com.evil.test/Example/Project.git': ",
            "Password for 'https://evil.test/Example/Project.git': ",
            "Password for 'https://attacker@github.com/Example/Project.git': ",
            "Password for 'https://github.com:8443/Example/Project.git': ",
            "Password for 'https://github.com/Example/Project.git?redirect=evil': ",
            "Token for 'https://github.com/Example/Project.git': ",
        ] {
            assert_eq!(classify_askpass_prompt(prompt), None, "accepted {prompt}");
        }

        let nonce = "ab".repeat(32);
        assert!(validate_askpass_channel("127.0.0.1:1", &nonce).is_ok());
        for endpoint in ["localhost:1", "0.0.0.0:1", "127.0.0.1:0", "[::1]:1"] {
            assert!(validate_askpass_channel(endpoint, &nonce).is_err());
        }
        assert!(validate_askpass_channel("127.0.0.1:1", "not-a-nonce").is_err());
    }

    #[test]
    fn askpass_broker_rejects_wrong_nonce_and_serves_the_token_once() {
        let token = GitAccessToken::new("ghu_test_sentinel".to_string())
            .expect("construct test access token");
        let broker = AskpassBroker::start(&token, LOCAL_COMMAND_TIMEOUT)
            .expect("start one-shot askpass broker");
        assert!(!broker.config.endpoint.contains("ghu_test_sentinel"));
        assert!(!broker.config.nonce.contains("ghu_test_sentinel"));

        let wrong_nonce = "00".repeat(32);
        let wrong = request_askpass_token(&broker.config.endpoint, &wrong_nonce);
        assert!(wrong.is_err());

        let received = request_askpass_token(&broker.config.endpoint, &broker.config.nonce)
            .expect("authorized helper receives token");
        assert_eq!(received.as_slice(), b"ghu_test_sentinel");
        assert!(request_askpass_token(&broker.config.endpoint, &broker.config.nonce).is_err());
    }

    #[test]
    fn askpass_brokers_use_distinct_random_nonces() {
        let token = GitAccessToken::new("ghu_test_sentinel".to_string())
            .expect("construct test access token");
        let first =
            AskpassBroker::start(&token, LOCAL_COMMAND_TIMEOUT).expect("start first broker");
        let second =
            AskpassBroker::start(&token, LOCAL_COMMAND_TIMEOUT).expect("start second broker");
        assert_eq!(first.config.nonce.len(), 64);
        assert_eq!(second.config.nonce.len(), 64);
        assert_ne!(first.config.nonce, second.config.nonce);
        assert_ne!(first.config.endpoint, second.config.endpoint);
    }

    #[test]
    fn validates_exact_github_clone_urls_and_existing_ssh_remotes() {
        let expected =
            validate_github_remote("Example/Project", "https://github.com/Example/Project.git")
                .expect("valid GitHub clone URL");

        assert!(github_remote_matches(
            &expected,
            "https://github.com/example/project"
        ));
        assert!(github_remote_matches(
            &expected,
            "git@github.com:EXAMPLE/PROJECT.git"
        ));
        assert!(!github_remote_matches(
            &expected,
            " git@github.com:Example/Project.git"
        ));
        assert!(!github_remote_matches(
            &expected,
            "ssh://git@github.com/Example/Project.git"
        ));
        assert!(!github_remote_matches(
            &expected,
            "git@github.com:Example/Project"
        ));
        assert!(!github_remote_matches(
            &expected,
            "git@github.com:Example/Other.git"
        ));

        for invalid in [
            "http://github.com/Example/Project.git",
            "https://user@github.com/Example/Project.git",
            "https://github.com:443/Example/Project.git",
            "https://github.com/Example/Project.git?ref=main",
            "https://github.com/Example/Project.git#fragment",
            "https://github.com/Example/Project/extra",
            "https://github.com.evil.test/Example/Project.git",
            "https://github.com/Example%2fProject.git",
        ] {
            assert!(
                validate_github_remote("Example/Project", invalid).is_err(),
                "unexpectedly accepted {invalid}"
            );
        }
        assert!(validate_github_remote(
            "Example/Different",
            "https://github.com/Example/Project.git"
        )
        .is_err());
    }

    #[test]
    fn links_an_empty_directory_and_is_idempotent() {
        let repository = TestRepository::empty_directory();
        let request = || GitHubLinkRepositoryRequest {
            folder_path: repository.path_string(),
            repository_full_name: "Example/Project".to_string(),
            clone_url: "https://github.com/Example/Project.git".to_string(),
        };

        let linked = repository
            .git
            .link_github_repository(request())
            .expect("initialize and link repository");
        assert!(linked.initialized);
        assert!(!linked.already_linked);
        assert!(repository.path.join(".git").is_dir());
        assert_eq!(
            repository
                .git
                .run(&repository.path, &["remote", "get-url", "origin"])
                .expect("read origin"),
            "https://github.com/Example/Project.git"
        );

        let linked_again = repository
            .git
            .link_github_repository(request())
            .expect("link operation is idempotent");
        assert!(!linked_again.initialized);
        assert!(linked_again.already_linked);
    }

    #[test]
    fn accepts_exact_ssh_origin_but_rejects_any_conflicting_push_url() {
        let repository = TestRepository::new(false);
        repository
            .git
            .run(
                &repository.path,
                &[
                    "remote",
                    "add",
                    "origin",
                    "git@github.com:Example/Project.git",
                ],
            )
            .expect("add SSH origin");
        let request = || GitHubLinkRepositoryRequest {
            folder_path: repository.path_string(),
            repository_full_name: "Example/Project".to_string(),
            clone_url: "https://github.com/Example/Project.git".to_string(),
        };

        let linked = repository
            .git
            .link_github_repository(request())
            .expect("recognize exact SSH origin");
        assert!(linked.already_linked);
        assert_eq!(linked.remote_url, "git@github.com:Example/Project.git");

        repository
            .git
            .run(
                &repository.path,
                &[
                    "config",
                    "--add",
                    "remote.origin.pushurl",
                    "https://github.com/Attacker/Other.git",
                ],
            )
            .expect("configure conflicting push URL");
        let error = repository
            .git
            .link_github_repository(request())
            .expect_err("conflicting push URL must be rejected");
        // The code is what the frontend looks at to show the conflict panel:
        // looking for it here is worth more than looking for a sentence.
        assert_eq!(error.code, crate::errors::ORIGIN_CONFLICT_CODE);
        assert_eq!(
            error.message_id.as_deref(),
            Some(super::ORIGIN_CONFLICT_MESSAGE_ID)
        );
        assert_eq!(
            repository
                .git
                .run(
                    &repository.path,
                    &["config", "--get", "remote.origin.pushurl"]
                )
                .expect("read unchanged push URL"),
            "https://github.com/Attacker/Other.git"
        );
    }

    /// Everything the clone can get wrong without touching the network. These
    /// are exactly the cases that, discovered after the download, would cost the
    /// whole download — and the one with the hostile name is the only one that
    /// could write outside the chosen folder.
    #[test]
    fn a_clone_destination_is_decided_before_reaching_the_network() {
        let workspace = TestRepository::empty_directory();
        let remote = validate_github_remote("zkoyar/demo", "https://github.com/zkoyar/demo.git")
            .expect("remote valido");

        let destination = prepare_clone_destination(&workspace.path, &remote, None)
            .expect("una cartella libera deve essere accettata");
        assert_eq!(
            destination,
            workspace.path.join("demo"),
            "senza un nome esplicito la cartella prende il nome della repository"
        );

        let chosen = prepare_clone_destination(&workspace.path, &remote, Some("  demo-2  "))
            .expect("un nome esplicito valido deve essere accettato");
        assert_eq!(chosen, workspace.path.join("demo-2"));

        // A field left empty counts as no name, not as an error: it is the case
        // of someone who clears the suggestion and writes nothing else.
        for empty in ["", "   "] {
            assert_eq!(
                prepare_clone_destination(&workspace.path, &remote, Some(empty))
                    .expect("un nome vuoto deve ricadere sul nome della repository"),
                workspace.path.join("demo"),
            );
        }

        // The name ends up on a command line and becomes a path: a separator
        // would take it out of the chosen folder.
        for hostile in [
            "../fuori",
            "sotto/dentro",
            "..",
            ".",
            "-opzione",
            "con:duepunti",
        ] {
            assert!(
                prepare_clone_destination(&workspace.path, &remote, Some(hostile)).is_err(),
                "il nome '{hostile}' non deve essere accettato"
            );
        }

        // A collision has to be said before the download, not after.
        fs::create_dir_all(workspace.path.join("demo")).expect("create colliding directory");
        // The assertion is on the identifier, not on the sentence: rewording a
        // translation must not break the test, getting the outcome wrong must.
        let error = prepare_clone_destination(&workspace.path, &remote, None)
            .expect_err("una cartella occupata deve fermare il clone");
        assert_eq!(error.message_id.as_deref(), Some("clone.nameTaken"));
        assert_eq!(error.params.get("name").map(String::as_str), Some("demo"));

        // Inside an existing repository, nobody handles the nesting.
        let repository = TestRepository::new(false);
        let inside = repository.path.join("sottocartella");
        fs::create_dir_all(&inside).expect("create nested directory");
        assert!(
            prepare_clone_destination(&repository.path, &remote, None).is_err(),
            "la radice di una repository non deve accogliere un clone"
        );
        assert!(
            prepare_clone_destination(&inside, &remote, None).is_err(),
            "nemmeno una cartella interna a una repository"
        );
    }

    /// The branch list is what you choose from when deciding where to move: if
    /// the current branch were not marked, or if a name disappeared, the choice
    /// would be made blind.
    #[test]
    fn branches_are_listed_with_the_current_one_marked() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        repository
            .git
            .create_branch(&path, "lavoro/nuovo", false)
            .expect("il branch va creato");

        let list = repository
            .git
            .list_branches(&path)
            .expect("l'elenco deve essere leggibile");

        assert!(
            !list.detached,
            "una repository con commit non e' scollegata"
        );
        let current = list
            .current
            .clone()
            .expect("ci deve essere un branch corrente");
        assert!(
            list.branches
                .iter()
                .any(|branch| branch.name == "lavoro/nuovo"),
            "il branch creato deve comparire: {:?}",
            list.branches.iter().map(|b| &b.name).collect::<Vec<_>>()
        );
        assert_eq!(
            list.branches.iter().filter(|branch| branch.current).count(),
            1,
            "esattamente un branch deve risultare corrente"
        );
        assert_eq!(
            list.branches.first().map(|branch| branch.name.as_str()),
            Some(current.as_str()),
            "il branch corrente va in cima"
        );

        // Without an upstream, no relation to a non-existent remote is
        // invented.
        let created = list
            .branches
            .iter()
            .find(|branch| branch.name == "lavoro/nuovo")
            .expect("branch creato");
        assert!(created.upstream.is_none());
        assert!(created.track.is_none());
        assert!(!created.remote_only);
    }

    /// Creating without switching and switching are two different gestures:
    /// confusing them would take the working copy out from under someone who
    /// only wanted to prepare a branch.
    #[test]
    fn creating_a_branch_moves_the_worktree_only_when_asked() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        let before = repository
            .git
            .repository_info(&repository.path)
            .expect("stato iniziale")
            .branch;

        let info = repository
            .git
            .create_branch(&path, "solo-creato", false)
            .expect("creazione senza spostamento");
        assert_eq!(info.branch, before, "senza checkout si resta dov'e' si era");

        let info = repository
            .git
            .create_branch(&path, "creato-e-scelto", true)
            .expect("creazione con spostamento");
        assert_eq!(info.branch, "creato-e-scelto");

        let info = repository
            .git
            .switch_branch(&path, "solo-creato")
            .expect("ritorno su un branch esistente");
        assert_eq!(info.branch, "solo-creato");
    }

    /// The name ends up on Git's command line. What counts as a valid reference
    /// is Git's decision, but a leading dash would be read as an option before
    /// even getting there.
    #[test]
    fn hostile_branch_names_never_reach_git() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        for hostile in [
            "",
            "   ",
            "-force",
            "--force",
            "con spazio",
            "doppio..punto",
            "finisce.lock",
            "~tilde",
            "con:duepunti",
        ] {
            assert!(
                repository.git.create_branch(&path, hostile, false).is_err(),
                "'{hostile}' non deve poter diventare un branch"
            );
        }

        // An internal slash, on the other hand, is entirely normal and must
        // pass.
        assert!(repository
            .git
            .create_branch(&path, "feature/con-slash", false)
            .is_ok());
    }

    /// A branch switch must never erase unsaved work: Git refuses on its own,
    /// and the app must not force it.
    #[test]
    fn switching_branch_refuses_to_discard_uncommitted_work() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        repository
            .git
            .create_branch(&path, "altro", true)
            .expect("branch di lavoro");
        repository.write("tracked.txt", "modifica su altro\n");
        repository
            .git
            .run(&repository.path, &["add", "--", "tracked.txt"])
            .expect("stage");
        repository
            .git
            .run(&repository.path, &["commit", "--quiet", "-m", "su altro"])
            .expect("commit su altro");

        repository
            .git
            .switch_branch(&path, "master")
            .or_else(|_| repository.git.switch_branch(&path, "main"))
            .expect("ritorno al branch iniziale");

        // An unsaved change the branch switch would overwrite.
        repository.write("tracked.txt", "lavoro non salvato\n");
        let error = repository
            .git
            .switch_branch(&path, "altro")
            .expect_err("Git deve rifiutare invece di sovrascrivere");
        assert!(
            !error.message.is_empty(),
            "il motivo del rifiuto deve arrivare all'utente"
        );
        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("rilettura"),
            "lavoro non salvato\n",
            "il lavoro non salvato deve essere ancora li'"
        );
    }

    /// The history exists to answer "what am I about to send". An empty list
    /// because there is no upstream and an empty list because there is nothing to
    /// send mean opposite things, and the caller must be able to tell them
    /// apart.
    #[test]
    fn outgoing_history_separates_nothing_to_send_from_no_upstream() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        let recent = repository
            .git
            .repository_history(&path, HistoryScope::Recent)
            .expect("la storia recente deve essere leggibile");
        assert_eq!(recent.commits.len(), 1, "c'e' un solo commit");
        assert_eq!(recent.commits[0].subject, "initial");
        assert!(!recent.commits[0].hash.is_empty());
        assert!(!recent.commits[0].short_hash.is_empty());
        assert!(!recent.commits[0].author.is_empty());
        assert!(!recent.truncated);

        let outgoing = repository
            .git
            .repository_history(&path, HistoryScope::Outgoing)
            .expect("anche senza upstream la chiamata deve riuscire");
        assert!(outgoing.commits.is_empty());
        assert!(
            outgoing.upstream.is_none(),
            "senza upstream il chiamante deve poter dire 'non applicabile' invece di 'niente da inviare'"
        );
    }

    #[test]
    fn history_marks_truncation_only_when_an_extra_commit_exists() {
        let commits = |count: usize| {
            (0..count)
                .map(|index| CommitEntry {
                    hash: format!("hash-{index}"),
                    short_hash: format!("h{index}"),
                    subject: format!("commit {index}"),
                    author: "Test".to_string(),
                    date: "2026-01-01T00:00:00Z".to_string(),
                })
                .collect::<Vec<_>>()
        };

        let (exact, exact_truncated) = cap_history(commits(200), 200);
        assert_eq!(exact.len(), 200);
        assert!(!exact_truncated);

        let (overflow, overflow_truncated) = cap_history(commits(201), 200);
        assert_eq!(overflow.len(), 200);
        assert!(overflow_truncated);
    }

    #[test]
    fn outgoing_history_never_parses_an_option_shaped_upstream_as_a_log_option() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();
        let branch = repository
            .git
            .repository_info(&repository.path)
            .expect("read current branch")
            .branch;
        let remote = "--output=history-output";
        let tracking_ref = format!("refs/remotes/{remote}/{branch}");
        let fetch = format!("+refs/heads/*:refs/remotes/{remote}/*");
        let branch_remote = format!("branch.{branch}.remote");
        let branch_merge = format!("branch.{branch}.merge");

        fs::create_dir_all(repository.path.join("history-output"))
            .expect("create the directory an injected --output would target");
        repository
            .git
            .run(
                &repository.path,
                &[
                    "config",
                    "remote.--output=history-output.url",
                    "https://example.invalid/repo",
                ],
            )
            .expect("configure option-shaped remote");
        repository
            .git
            .run(
                &repository.path,
                &["config", "remote.--output=history-output.fetch", &fetch],
            )
            .expect("configure remote ref mapping");
        repository
            .git
            .run(&repository.path, &["update-ref", &tracking_ref, "HEAD"])
            .expect("create the tracking ref");
        repository
            .git
            .run(&repository.path, &["config", &branch_remote, remote])
            .expect("configure branch remote");
        repository
            .git
            .run(
                &repository.path,
                &["config", &branch_merge, &format!("refs/heads/{branch}")],
            )
            .expect("configure branch merge ref");
        let short_upstream = format!("{remote}/{branch}");
        assert_eq!(
            repository
                .git
                .repository_info(&repository.path)
                .expect("read the hostile upstream fixture")
                .upstream
                .as_deref(),
            Some(short_upstream.as_str()),
            "the fixture must reach Git as an option-shaped short upstream"
        );

        let history = repository
            .git
            .repository_history(&path, HistoryScope::Outgoing)
            .expect("an option-shaped upstream is handled as a validated ref");

        assert!(history.commits.is_empty(), "tracking ref points at HEAD");
        assert!(
            !repository
                .path
                .join("history-output")
                .join(format!("{branch}..HEAD"))
                .exists(),
            "git log must not receive the short upstream as --output"
        );
    }

    /// Remotes are the only place where the app writes a URL into the
    /// configuration, and that URL is then used to talk to the network.
    #[test]
    fn remotes_can_be_added_changed_and_removed() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        assert!(repository
            .git
            .list_remotes(&path)
            .expect("elenco leggibile")
            .is_empty());

        repository
            .git
            .set_remote(&path, "origin", "https://example.invalid/a/b.git")
            .expect("aggiunta del remote");
        let remotes = repository.git.list_remotes(&path).expect("elenco");
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].name, "origin");
        assert_eq!(remotes[0].fetch_url, "https://example.invalid/a/b.git");
        assert_eq!(remotes[0].push_url, "https://example.invalid/a/b.git");

        // The same command must change the URL, not fail because it already
        // exists.
        repository
            .git
            .set_remote(&path, "origin", "https://example.invalid/a/c.git")
            .expect("cambio dell'URL");
        assert_eq!(
            repository.git.list_remotes(&path).expect("elenco")[0].fetch_url,
            "https://example.invalid/a/c.git"
        );

        repository
            .git
            .remove_remote(&path, "origin")
            .expect("rimozione");
        assert!(repository
            .git
            .list_remotes(&path)
            .expect("elenco")
            .is_empty());
    }

    #[test]
    fn listing_remotes_never_exposes_inline_credentials() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();
        repository
            .git
            .run(
                &repository.path,
                &[
                    "remote",
                    "add",
                    "origin",
                    "https://reader:fetch-secret@example.invalid/a/b.git",
                ],
            )
            .expect("configure credential-bearing fetch URL");
        repository
            .git
            .run(
                &repository.path,
                &[
                    "config",
                    "remote.origin.pushurl",
                    "https://writer:push-secret@example.invalid/a/b.git",
                ],
            )
            .expect("configure credential-bearing push URL");

        let remotes = repository.git.list_remotes(&path).expect("list remotes");
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].fetch_url, "https://example.invalid/a/b.git");
        assert_eq!(remotes[0].push_url, "https://example.invalid/a/b.git");
        assert!(!format!("{remotes:?}").contains("secret"));
    }

    /// `ext::` is the syntax of transport helpers: a URL like that runs a
    /// command at every fetch. `protocol.ext.allow=never` blocks it at network
    /// time, but a URL like that must not even be writable.
    #[test]
    fn hostile_remote_urls_and_names_are_refused() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        for url in [
            "ext::sh -c whoami",
            "",
            "   ",
            "-upload-pack=sh",
            "https://example.invalid/a b.git",
        ] {
            assert!(
                repository.git.set_remote(&path, "origin", url).is_err(),
                "l'URL '{url}' non deve poter entrare nella configurazione"
            );
        }

        for name in ["", "-x", ".nascosto", "con/slash", "con spazio"] {
            assert!(
                repository
                    .git
                    .set_remote(&path, name, "https://example.invalid/a/b.git")
                    .is_err(),
                "il nome '{name}' non deve essere accettato"
            );
        }

        assert!(validate_remote_name("origin").is_ok());
        assert!(validate_remote_url("git@github.com:a/b.git").is_ok());
    }

    /// A stash puts real work aside: if the index slid, the wrong entry would be
    /// reapplied or thrown away.
    #[test]
    fn stashes_are_created_listed_and_applied_by_stable_object_id() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        assert!(repository
            .git
            .list_stashes(&path)
            .expect("elenco")
            .is_empty());
        assert!(
            repository.git.create_stash(&path, "niente", false).is_err(),
            "senza modifiche non c'e' niente da mettere da parte"
        );

        repository.write("tracked.txt", "prima modifica\n");
        repository
            .git
            .create_stash(&path, "prima", false)
            .expect("primo stash");
        repository.write("tracked.txt", "seconda modifica\n");
        repository
            .git
            .create_stash(&path, "seconda", false)
            .expect("secondo stash");

        let stashes = repository.git.list_stashes(&path).expect("elenco");
        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].index, 0);
        assert_eq!(stashes[1].index, 1);
        assert!(valid_stash_object_id(&stashes[0].object_id));
        assert!(valid_stash_object_id(&stashes[1].object_id));
        assert_ne!(stashes[0].object_id, stashes[1].object_id);
        // La pila e' LIFO: in cima c'e' l'ultimo messo da parte.
        assert!(stashes[0].message.contains("seconda"), "{:?}", stashes[0]);
        assert!(stashes[1].message.contains("prima"), "{:?}", stashes[1]);

        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("rilettura"),
            "base\n",
            "dopo lo stash il file torna com'era"
        );

        repository
            .git
            .apply_stash(&path, 0, &stashes[0].object_id, StashAction::Pop)
            .expect("riapplicazione della cima");
        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("rilettura"),
            "seconda modifica\n"
        );
        assert_eq!(repository.git.list_stashes(&path).expect("elenco").len(), 1);

        assert!(
            repository
                .git
                .apply_stash(&path, 9, &stashes[1].object_id, StashAction::Drop)
                .is_err(),
            "una posizione che non esiste non deve toccare la pila"
        );
    }

    #[test]
    fn a_stale_stash_position_never_applies_or_drops_another_object() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        repository.write("tracked.txt", "first change\n");
        repository
            .git
            .create_stash(&path, "first", false)
            .expect("first stash");
        repository.write("tracked.txt", "selected change\n");
        repository
            .git
            .create_stash(&path, "selected", false)
            .expect("selected stash");
        let selected = repository.git.list_stashes(&path).expect("initial list")[0].clone();

        // A new external entry moves the selected object from index zero to
        // index one after the interface loaded it.
        repository.write("tracked.txt", "new top\n");
        repository
            .git
            .create_stash(&path, "new top", false)
            .expect("new top stash");
        let before_apply = repository.git.list_stashes(&path).expect("shifted list");
        let error = repository
            .git
            .apply_stash(
                &path,
                selected.index,
                &selected.object_id,
                StashAction::Apply,
            )
            .expect_err("the stale position must be refused");
        assert_eq!(error.message_id.as_deref(), Some("stash.changedSinceLoad"));
        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("worktree"),
            "base\n",
            "no different stash was applied"
        );
        assert_eq!(
            repository.git.list_stashes(&path).expect("unchanged list"),
            before_apply
        );

        // Removing the current top moves another saved entry to a different
        // position. Reusing its old index must not drop the object now there.
        let shifted = before_apply[1].clone();
        repository
            .git
            .run(&repository.path, &["stash", "drop", "--", "stash@{0}"])
            .expect("external removal");
        let before_drop = repository.git.list_stashes(&path).expect("after removal");
        let error = repository
            .git
            .apply_stash(&path, shifted.index, &shifted.object_id, StashAction::Drop)
            .expect_err("the shifted drop must be refused");
        assert_eq!(error.message_id.as_deref(), Some("stash.changedSinceLoad"));
        assert_eq!(
            repository.git.list_stashes(&path).expect("still unchanged"),
            before_drop,
            "no object at the reused index was dropped"
        );
    }

    /// Prima l'app sapeva contare i conflitti e nient'altro: li mostrava e
    /// lasciava l'utente senza alcun modo di uscirne dall'interno.
    #[test]
    fn a_conflicted_merge_is_reported_and_can_be_aborted() {
        let repository = TestRepository::new(true);
        let path = repository.path_string();

        let quiet = repository.git.conflict_state(&path).expect("stato");
        assert_eq!(quiet.pending, PendingOperation::None);
        assert!(quiet.conflicted.is_empty());
        assert!(
            repository
                .git
                .resolve_conflict(&path, ConflictAction::Abort)
                .is_err(),
            "senza operazione in corso non c'e' niente da annullare"
        );

        let base = repository
            .git
            .repository_info(&repository.path)
            .expect("stato")
            .branch;

        repository
            .git
            .create_branch(&path, "altro", true)
            .expect("branch");
        repository.write("tracked.txt", "versione di altro\n");
        repository
            .git
            .run(&repository.path, &["add", "--", "."])
            .expect("stage");
        repository
            .git
            .run(&repository.path, &["commit", "--quiet", "-m", "altro"])
            .expect("commit");

        repository.git.switch_branch(&path, &base).expect("ritorno");
        repository.write("tracked.txt", "versione di base\n");
        repository
            .git
            .run(&repository.path, &["add", "--", "."])
            .expect("stage");
        repository
            .git
            .run(&repository.path, &["commit", "--quiet", "-m", "base"])
            .expect("commit");

        // A merge bound to fail: the two sides touched the same line.
        let merged = repository.git.run_owned(
            &repository.path,
            &[
                OsString::from("-c"),
                OsString::from("core.editor=true"),
                OsString::from("merge"),
                OsString::from("--no-edit"),
                OsString::from("--"),
                OsString::from("altro"),
            ],
        );
        assert!(merged.is_err(), "il merge doveva entrare in conflitto");

        let state = repository.git.conflict_state(&path).expect("stato");
        assert_eq!(state.pending, PendingOperation::Merge);
        assert_eq!(state.conflicted, vec!["tracked.txt".to_string()]);

        assert!(
            repository
                .git
                .resolve_conflict(&path, ConflictAction::Continue)
                .is_err(),
            "con file ancora in conflitto non si puo' continuare"
        );

        let info = repository
            .git
            .resolve_conflict(&path, ConflictAction::Abort)
            .expect("annullamento del merge");
        assert_eq!(info.conflicted, 0);
        assert_eq!(
            fs::read_to_string(repository.path.join("tracked.txt")).expect("rilettura"),
            "versione di base\n",
            "dopo l'annullamento si torna esattamente a com'era"
        );
        assert_eq!(
            repository.git.conflict_state(&path).expect("stato").pending,
            PendingOperation::None
        );
    }

    /// The credentials policy is a decision, not a detail: with the GitHub token
    /// the app must be the only source, while on every other remote it must get
    /// out of the way and leave the user's helper alone, otherwise GitLab,
    /// Bitbucket and company servers would become unusable.
    #[test]
    fn the_system_credential_helper_survives_only_where_the_app_has_no_secret() {
        let authenticated: Vec<String> = network_hardening_args(true)
            .iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect();

        assert!(
            authenticated
                .iter()
                .any(|value| value == "credential.helper="),
            "con il token l'helper di sistema non deve poter rispondere al posto del broker"
        );
        assert!(authenticated.iter().any(|value| value == "http.proxy="));
        assert!(authenticated
            .iter()
            .any(|value| value == "http.followRedirects=false"));
        assert!(authenticated
            .iter()
            .any(|value| value == "http.extraHeader="));

        assert!(
            network_hardening_args(false).is_empty(),
            "senza segreti dell'app Git deve restare quello di sistema, helper compreso"
        );
    }

    #[test]
    fn refuses_to_initialize_a_nested_repository() {
        let parent = TestRepository::new(false);
        let nested = parent.path.join("nested");
        fs::create_dir_all(&nested).expect("create nested directory");

        let error = parent
            .git
            .link_github_repository(GitHubLinkRepositoryRequest {
                folder_path: nested.to_string_lossy().to_string(),
                repository_full_name: "Example/Project".to_string(),
                clone_url: "https://github.com/Example/Project.git".to_string(),
            })
            .expect_err("nested repository creation must be rejected");
        assert_eq!(error.message_id.as_deref(), Some("link.belongsToParent"));
        assert!(!nested.join(".git").exists());
    }

    #[test]
    fn blocks_dangerous_local_and_worktree_network_configuration() {
        let repository = TestRepository::new(false);
        repository
            .git
            .run(&repository.path, &["config", "http.sslVerify", "false"])
            .expect("configure unsafe local HTTP setting");
        assert!(repository
            .git
            .ensure_safe_local_network_config(&repository.path)
            .is_err());
        repository
            .git
            .run(&repository.path, &["config", "--unset", "http.sslVerify"])
            .expect("remove unsafe local HTTP setting");

        repository
            .git
            .run(
                &repository.path,
                &["config", "include.path", "outside-config"],
            )
            .expect("configure unsafe include");
        assert!(repository
            .git
            .ensure_safe_local_network_config(&repository.path)
            .is_err());
        repository
            .git
            .run(&repository.path, &["config", "--unset", "include.path"])
            .expect("remove unsafe include");

        repository
            .git
            .run(
                &repository.path,
                &["config", "extensions.worktreeConfig", "true"],
            )
            .expect("enable worktree config");
        repository
            .git
            .run(
                &repository.path,
                &[
                    "config",
                    "--worktree",
                    "credential.helper",
                    "attacker-helper",
                ],
            )
            .expect("configure unsafe worktree credential helper");
        assert!(repository
            .git
            .ensure_safe_local_network_config(&repository.path)
            .is_err());
    }

    #[test]
    fn status_and_diff_disable_repository_configured_executables() {
        let repository = TestRepository::new(true);
        repository
            .git
            .run(
                &repository.path,
                &["config", "core.fsmonitor", "definitely-not-an-executable"],
            )
            .expect("configure unsafe fsmonitor");
        repository
            .git
            .run(
                &repository.path,
                &[
                    "config",
                    "diff.unsafe.textconv",
                    "definitely-not-an-executable",
                ],
            )
            .expect("configure unsafe textconv");
        repository.write(".gitattributes", "tracked.txt diff=unsafe\n");
        repository.write("tracked.txt", "changed\n");

        repository
            .git
            .repository_info(&repository.path)
            .expect("status ignores configured fsmonitor executable");
        repository
            .git
            .repository_diff(&repository.path_string())
            .expect("diff ignores configured textconv executable");
    }

    #[test]
    fn upstream_atoms_support_remote_names_containing_slashes() {
        let remote = TestRepository::empty_directory();
        remote
            .git
            .run(&remote.path, &["init", "--bare", "--quiet", "--template="])
            .expect("initialize bare remote");
        let repository = TestRepository::new(true);
        let remote_path = remote.path_string();
        repository
            .git
            .run(
                &repository.path,
                &["remote", "add", "team/github", &remote_path],
            )
            .expect("add slash remote");
        let initial_push =
            repository
                .git
                .push_many(vec![repository.path_string()], None, &|_, _, _| {});
        assert!(initial_push[0].success, "{}", initial_push[0].message);
        let branch = repository
            .git
            .repository_info(&repository.path)
            .expect("read repository")
            .branch;
        let upstream = repository
            .git
            .upstream_target(&repository.path, &branch)
            .expect("read upstream atoms")
            .expect("upstream is configured");
        assert_eq!(upstream.remote, "team/github");
        assert!(upstream.remote_ref.starts_with("refs/heads/"));

        repository
            .git
            .run(
                &repository.path,
                &["update-ref", "refs/remotes/team/github/remote-only", "HEAD"],
            )
            .expect("create a remote-only branch under a slash remote");
        let branches = repository
            .git
            .list_branches(&repository.path_string())
            .expect("list branches under a slash remote");
        let remote_only = branches
            .branches
            .iter()
            .find(|candidate| candidate.name == "remote-only")
            .expect("remote-only branch keeps only its branch name");
        assert!(remote_only.remote_only);
        assert_eq!(
            remote_only.upstream.as_deref(),
            Some("team/github/remote-only")
        );

        repository.write("tracked.txt", "next\n");
        repository
            .git
            .run(&repository.path, &["add", "--", "tracked.txt"])
            .expect("stage next commit");
        repository
            .git
            .run(&repository.path, &["commit", "--quiet", "-m", "next"])
            .expect("create next commit");
        let pushed = repository
            .git
            .push_many(vec![repository.path_string()], None, &|_, _, _| {});
        assert!(pushed[0].success, "{}", pushed[0].message);
    }

    #[test]
    fn option_shaped_remote_name_is_passed_after_double_dash() {
        let remote = TestRepository::empty_directory();
        remote
            .git
            .run(&remote.path, &["init", "--bare", "--quiet", "--template="])
            .expect("initialize bare remote");
        let seed = TestRepository::new(true);
        let remote_path = remote.path_string();
        seed.git
            .run(
                &seed.path,
                &[
                    "push",
                    "--",
                    &remote_path,
                    "HEAD:refs/heads/mrm-option-test",
                ],
            )
            .expect("seed bare remote");
        remote
            .git
            .run(
                &remote.path,
                &["symbolic-ref", "HEAD", "refs/heads/mrm-option-test"],
            )
            .expect("set bare remote HEAD");
        let repository = TestRepository::new(false);
        repository
            .git
            .run(
                &repository.path,
                &["config", "remote.--upload-pack=never.url", &remote_path],
            )
            .expect("configure option-shaped remote");
        let result = repository
            .git
            .fetch_many(vec![repository.path_string()], None, &|_, _, _| {});
        assert!(result[0].success, "{}", result[0].message);
    }

    #[test]
    fn first_push_sets_upstream_and_requires_a_commit() {
        let remote = TestRepository::empty_directory();
        remote
            .git
            .run(&remote.path, &["init", "--bare", "--quiet", "--template="])
            .expect("initialize bare remote");
        let remote_path = remote.path_string();

        let repository = TestRepository::new(true);
        repository
            .git
            .run(&repository.path, &["remote", "add", "origin", &remote_path])
            .expect("add local bare remote");
        let result = repository
            .git
            .push_many(vec![repository.path_string()], None, &|_, _, _| {});
        assert!(result[0].success, "{}", result[0].message);
        assert!(repository
            .git
            .run(
                &repository.path,
                &[
                    "rev-parse",
                    "--abbrev-ref",
                    "--symbolic-full-name",
                    "@{upstream}",
                ],
            )
            .expect("read configured upstream")
            .starts_with("origin/"));

        let unborn = TestRepository::new(false);
        unborn
            .git
            .run(&unborn.path, &["remote", "add", "origin", &remote_path])
            .expect("add remote to unborn repository");
        let result = unborn
            .git
            .push_many(vec![unborn.path_string()], None, &|_, _, _| {});
        assert!(!result[0].success);
        assert!(
            result[0].message.contains("commit"),
            "{}",
            result[0].message
        );
    }

    #[test]
    fn redacts_only_url_authority_and_sensitive_suffixes() {
        assert_eq!(
            redact_remote_url(
                "https://reader:secret@example.com/org/repo.git?token=hidden#private"
            ),
            "https://example.com/org/repo.git"
        );
        assert_eq!(
            redact_remote_url("https://example.com/org/repo@archive.git"),
            "https://example.com/org/repo@archive.git",
            "an at sign in the path is not userinfo"
        );
        assert_eq!(
            redact_remote_url("ssh://git@example.com/org/repo.git"),
            "ssh://git@example.com/org/repo.git",
            "the normal SSH username stays reusable"
        );
        assert_eq!(
            redact_remote_url("ssh://git:secret@example.com/org/repo.git"),
            "ssh://git@example.com/org/repo.git"
        );
        assert_eq!(
            redact_remote_url("ssh://git@example.com/org/repo.git?key=secret#private"),
            "ssh://git@example.com/org/repo.git"
        );
        assert_eq!(
            redact_remote_url("ftp://example.com/org/repo.git?token=secret#private"),
            "ftp://example.com/org/repo.git"
        );
        assert_eq!(
            redact_remote_url("git@github.com:org/repo.git"),
            "git@github.com:org/repo.git"
        );
    }

    #[test]
    fn truncation_keeps_valid_utf8() {
        let (value, truncated) = truncate_utf8("èèèè".to_string(), 5);
        assert!(truncated);
        assert!(value.starts_with("èè"));

        // The value comes back without a marker: the sentence is added by the
        // frontend, which knows what language the user is reading in. Appending
        // it here would slip it among Git's words, where it is not
        // translatable.
        assert_eq!(value, "èè", "il taglio non deve aggiungere testo proprio");

        let (short, untouched) = truncate_utf8("èè".to_string(), 64);
        assert!(!untouched);
        assert_eq!(short, "èè");
    }

    #[test]
    fn github_auth_is_only_enabled_for_exact_secure_remotes() {
        assert!(is_github_https_remote(
            "https://github.com/example/project.git"
        ));
        assert!(is_github_https_remote(
            "https://github.com:443/example/project.git"
        ));

        assert!(!is_github_https_remote(
            "http://github.com/example/project.git"
        ));
        assert!(!is_github_https_remote(
            "https://github.com.evil.test/example/project.git"
        ));
        assert!(!is_github_https_remote(
            "https://github.com@evil.test/example/project.git"
        ));
        assert!(!is_github_https_remote(
            "https://user@github.com/example/project.git"
        ));
        assert!(!is_github_https_remote(
            "git@github.com:example/project.git"
        ));
        assert!(!is_github_https_remote("https://github.com/"));
        assert!(!is_github_https_remote(
            "https://github.com/example/project/extra"
        ));
        assert!(!is_github_https_remote(
            "https://github.com/example%2fproject.git"
        ));
    }

    /// The deadline must give control back, not merely wait for the process to
    /// end. The test command deliberately starts a grandchild (`ping` under
    /// `cmd`, `sleep` under `sh`) that outlives the `kill` while holding the pipe
    /// open: if waiting for the readers were blocking, this would return only
    /// after six seconds, recreating the very block the deadline must remove.
    #[test]
    fn a_process_that_exceeds_the_deadline_is_killed() {
        let mut command = slow_command();
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("il processo di prova deve essere avviabile");

        let started = Instant::now();
        let error = wait_with_deadline(child, Duration::from_millis(300))
            .expect_err("la scadenza deve produrre un errore");

        assert_eq!(error.message_id.as_deref(), Some("git.timedOut"));
        assert_eq!(error.code, "timeout");
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "l'attesa deve terminare alla scadenza, non alla fine del processo: {:?}",
            started.elapsed()
        );
    }

    /// Draining the pipes is not a detail: without the two reader threads an
    /// output larger than the pipe buffer would block Git while writing, while we
    /// wait for it to finish.
    #[test]
    fn a_large_diff_does_not_deadlock_the_drained_pipes() {
        let repository = TestRepository::new(true);
        let large = "riga di prova che occupa spazio a sufficienza
"
        .repeat(40_000);
        repository.write("grande.txt", &large);

        let staged = repository
            .git
            .stage_files(&repository.path_string(), vec!["grande.txt".to_string()]);
        assert!(staged.success, "{}", staged.message);

        let diff = repository
            .git
            .repository_diff(&repository.path_string())
            .expect("il diff deve completare invece di bloccarsi");

        assert!(!diff.staged.is_empty());
        assert!(
            diff.truncated,
            "un diff da oltre un megabyte deve risultare troncato"
        );
    }

    /// Cancellation must kill the running process, not wait for it to end. The
    /// predicate is injected instead of raising the global flag, which would fail
    /// the parallel tests that actually run Git.
    #[test]
    fn a_cancelled_operation_kills_the_running_process() {
        let mut command = slow_command();
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("il processo di prova deve essere avviabile");

        let started = Instant::now();
        let error = wait_with_deadline_until(child, Duration::from_secs(60), &|| true)
            .expect_err("l'annullamento deve produrre un errore");

        assert_eq!(error.message_id.as_deref(), Some("git.cancelled"));
        assert_eq!(error.code, "cancelled");
        let outcome = failure_from(
            &PathBuf::from("cancelled-repository"),
            "cancelled-repository",
            "fetch",
            error,
        );
        assert_eq!(outcome.code, "cancelled");
        assert!(!outcome.success);
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "l'annullamento deve avere effetto subito, non alla scadenza: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn concurrent_operation_does_not_clear_existing_cancellation() {
        let state = CancellationState::new();
        let first = state.begin();

        state.request_cancel();
        assert!(state.cancel_requested());

        let second = state.begin();
        assert!(
            state.cancel_requested(),
            "a second active operation must not revive the cancelled one"
        );
        drop(first);
        assert!(
            state.cancel_requested(),
            "one cancellable flow is still active"
        );

        drop(second);
        assert!(!state.cancel_requested());

        state.request_cancel();
        assert!(
            !state.cancel_requested(),
            "a late cancellation must not poison the next operation"
        );
        let next = state.begin();
        assert!(!state.cancel_requested());
        drop(next);
    }
}
