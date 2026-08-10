mod diagnostics;
mod errors;
mod git;
mod github;
mod models;
mod scanner;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use errors::{AppError, UNAUTHORIZED_REPOSITORY_CODE};
use models::{
    BranchList, CommitRequest, ConflictActionRequest, ConflictState, CreateBranchRequest,
    CreateStashRequest, DiffResult, FileChange, GitHubCloneRepositoryRequest,
    GitHubCloneRepositoryResult, GitHubLinkRepositoryRequest, GitHubLinkRepositoryResult,
    HistoryRequest, HistoryResult, OperationResult, PullStrategy, RemoteInfo, RemoteRequest,
    RepositoryInfo, ScanResult, StashActionRequest, StashEntry, SwitchBranchRequest,
};
use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

struct AppState {
    authorized_repositories: Mutex<HashSet<PathBuf>>,
    /// Folders the user picked in person in the native dialog.
    ///
    /// It exists because the dialog is now opened by the backend: the frontend
    /// can no longer make up a path and present it as "chosen by the user".
    /// `github_link_repository` used to accept whatever `folder_path` reached it
    /// from the webview and run `git init` there, adding it to the authorised
    /// set afterwards: knowing a writable path was enough.
    folders_chosen_by_user: Mutex<HashSet<PathBuf>>,
    github: github::GitHubClient,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            authorized_repositories: Mutex::new(HashSet::new()),
            folders_chosen_by_user: Mutex::new(load_chosen_folders()),
            github: github::GitHubClient::default(),
        }
    }
}

/// File where the folders the user picked in the native dialog live.
const CHOSEN_FOLDERS_FILE: &str = "chosen-folders.txt";

/// The name this file used to have. It is still read once, when the new one is
/// missing, so an existing installation does not silently lose its authorised
/// folders on upgrade: without it the app would come back showing the
/// remembered workspace while refusing every scan of it, which is precisely the
/// failure the persistence was added to prevent.
const LEGACY_CHOSEN_FOLDERS_FILE: &str = "cartelle-scelte.txt";

/// Re-reads the list of folders chosen in earlier sessions.
///
/// Without persistence, the gate added to close the `git init` hole had killed
/// the memory of the working folder: the app showed the remembered path but the
/// scan always refused it, because the set started empty at every launch.
///
/// The gate keeps doing its job: telling a choice by the user apart from a
/// string invented by the webview. A real choice, recorded, stays a real
/// choice. Every entry is canonicalised again on re-reading, so a path that
/// vanished or was tampered with does not get in.
fn load_chosen_folders() -> HashSet<PathBuf> {
    let current = diagnostics::application_directory()
        .map(|directory| load_chosen_folders_from(&directory))
        .unwrap_or_default();
    if !current.is_empty() {
        return current;
    }

    // Nothing under the current name. An install from before the app was called
    // RubyRepo keeps its list in the previous data folder, and reading it once
    // is what stops the rename from silently emptying the authorised set — the
    // app would show the remembered workspace and refuse every scan of it.
    diagnostics::legacy_application_directory()
        .map(|directory| load_chosen_folders_from(&directory))
        .unwrap_or_default()
}

fn load_chosen_folders_from(directory: &Path) -> HashSet<PathBuf> {
    let contents = std::fs::read_to_string(directory.join(CHOSEN_FOLDERS_FILE))
        // The file the previous versions wrote. Read only as a fallback, and
        // never written again: the next `store_chosen_folders` moves the list to
        // the new name on its own.
        .or_else(|_| std::fs::read_to_string(directory.join(LEGACY_CHOSEN_FOLDERS_FILE)));
    let Ok(contents) = contents else {
        // Missing on the first run, or unreadable: start from nothing.
        return HashSet::new();
    };

    contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| Path::new(line).canonicalize().ok())
        .filter(|path| path.is_dir())
        .collect()
}

/// Rewrites the list. A write error must interrupt nothing: persistence is a
/// convenience, and the gate works for the current session regardless.
fn store_chosen_folders(folders: &HashSet<PathBuf>) {
    if let Some(directory) = diagnostics::application_directory() {
        store_chosen_folders_in(&directory, folders);
    }
}

fn store_chosen_folders_in(directory: &Path, folders: &HashSet<PathBuf>) {
    if std::fs::create_dir_all(directory).is_err() {
        return;
    }

    let contents = folders
        .iter()
        .filter_map(|path| path.to_str())
        .collect::<Vec<_>>()
        .join("\n");
    let _ = std::fs::write(directory.join(CHOSEN_FOLDERS_FILE), contents);
}

fn canonical_path(path: &str) -> Result<PathBuf, AppError> {
    Path::new(path).canonicalize().map_err(|error| {
        AppError::translated(
            "internal",
            "error.invalidPath",
            format!("Invalid path '{path}': {error}"),
        )
        .with("path", path)
        .with("reason", error.to_string())
    })
}

/// Canonicalises every path, checks it is among the authorised ones, and
/// **returns the canonical forms**, which are the only ones that should reach
/// Git.
///
/// Returning them is not a cosmetic detail. The canonical form used to serve
/// only for the comparison and was then discarded, while the caller's raw
/// string was what reached the commands: between the check and the use the path
/// was resolved a second time, and the window was widened by the hop into
/// `spawn_blocking` and, for network operations, by the token request that
/// happens in between. A link or a directory swapped in that interval made Git
/// operate on a path other than the authorised one.
fn ensure_authorized(state: &AppState, repo_paths: &[String]) -> Result<Vec<String>, AppError> {
    let authorized = state.authorized_repositories.lock().map_err(|_| {
        AppError::translated(
            "internal",
            "error.internalState",
            "Internal state is unavailable.",
        )
    })?;

    repo_paths
        .iter()
        .map(|path| {
            let canonical = canonical_path(path)?;
            if !authorized.contains(&canonical) {
                return Err(AppError::translated(
                    UNAUTHORIZED_REPOSITORY_CODE,
                    "error.unauthorizedRepository",
                    format!(
                        "Repository not authorised. Scan again: {}",
                        canonical.display()
                    ),
                )
                .with("path", canonical.display().to_string()));
            }
            canonical.to_str().map(str::to_string).ok_or_else(|| {
                AppError::translated(
                    "internal",
                    "error.repositoryPathNotText",
                    format!(
                        "The repository path cannot be represented as text: {}",
                        canonical.display()
                    ),
                )
                .with("path", canonical.display().to_string())
            })
        })
        .collect()
}

/// Outcome of checking a single path in a batch request.
#[derive(Debug)]
enum AuthorizedPath {
    /// Authorised, canonical, and still present on disk.
    Ready(String),
    /// The repository is no longer reachable: folder moved, renamed, deleted,
    /// or on an unmounted volume.
    Unavailable { requested: String, reason: String },
}

/// Like `ensure_authorized`, but without failing the whole request when one
/// repository is no longer reachable.
///
/// The distinction is deliberate. An **unauthorised** path is an anomaly — the
/// frontend sent something that did not come from a scan — and keeps failing
/// everything, safely. A path that has simply **vanished** is ordinary business
/// in a live workspace: a single renamed folder used to be enough to fail the
/// operation on all the others.
fn resolve_authorized(
    state: &AppState,
    repo_paths: &[String],
) -> Result<Vec<AuthorizedPath>, AppError> {
    let authorized = state.authorized_repositories.lock().map_err(|_| {
        AppError::translated(
            "internal",
            "error.internalState",
            "Internal state is unavailable.",
        )
    })?;

    repo_paths
        .iter()
        .map(|path| {
            let canonical = match canonical_path(path) {
                Ok(canonical) => canonical,
                Err(reason) => {
                    return Ok(AuthorizedPath::Unavailable {
                        requested: path.clone(),
                        reason: reason.message,
                    })
                }
            };

            if !authorized.contains(&canonical) {
                return Err(AppError::translated(
                    UNAUTHORIZED_REPOSITORY_CODE,
                    "error.unauthorizedRepository",
                    format!(
                        "Repository not authorised. Scan again: {}",
                        canonical.display()
                    ),
                )
                .with("path", canonical.display().to_string()));
            }

            canonical
                .to_str()
                .map(|canonical| AuthorizedPath::Ready(canonical.to_string()))
                .ok_or_else(|| {
                    AppError::translated(
                        "internal",
                        "error.repositoryPathNotText",
                        format!(
                            "The repository path cannot be represented as text: {}",
                            canonical.display()
                        ),
                    )
                    .with("path", canonical.display().to_string())
                })
        })
        .collect()
}

/// Separates the usable paths from the unreachable ones, which become failure
/// outcomes for the affected repository alone.
fn partition_authorized(resolved: &[AuthorizedPath]) -> (Vec<String>, Vec<(String, String)>) {
    let mut ready = Vec::new();
    let mut unavailable = Vec::new();

    for entry in resolved {
        match entry {
            AuthorizedPath::Ready(path) => ready.push(path.clone()),
            AuthorizedPath::Unavailable { requested, reason } => {
                unavailable.push((requested.clone(), reason.clone()))
            }
        }
    }

    (ready, unavailable)
}

/// Puts the outcomes back in the order the frontend sent the requests.
///
/// The commands used to put the outcomes of vanished repositories **first** and
/// append the others afterwards: one renamed folder was enough for the returned
/// order to stop matching the sent one, and for the interface to attribute an
/// outcome to the wrong row. `run_over_repositories` preserves the order
/// internally: it was this layer that destroyed it.
fn merge_in_request_order(
    resolved: &[AuthorizedPath],
    operation: &str,
    completed: Vec<OperationResult>,
) -> Vec<OperationResult> {
    // The invariant lived only in a comment: if `completed` came back shorter,
    // every outcome would slide by one position and the last would disappear —
    // exactly the defect this function exists to prevent.
    debug_assert_eq!(
        completed.len(),
        resolved
            .iter()
            .filter(|entry| matches!(entry, AuthorizedPath::Ready(_)))
            .count(),
        "un esito per ogni repository elaborata"
    );

    let mut completed = completed.into_iter();
    resolved
        .iter()
        .filter_map(|entry| match entry {
            AuthorizedPath::Ready(_) => completed.next(),
            AuthorizedPath::Unavailable { requested, reason } => {
                Some(git::unavailable_result(requested, operation, reason))
            }
        })
        .collect()
}

/// Variant for the commands that work on a single repository.
fn ensure_authorized_one(state: &AppState, repo_path: &str) -> Result<String, AppError> {
    let requested = [repo_path.to_string()];
    let mut canonical = ensure_authorized(state, &requested)?;
    canonical.pop().ok_or_else(|| {
        AppError::translated(
            "internal",
            "error.noRepositoryPath",
            "No repository path given.",
        )
    })
}

/// Progress of a batch operation, emitted after each repository.
///
/// Deliberately light: it carries the count and the summary outcome, not the
/// full `OperationResult`, which can hold up to 16 KB of Git output per
/// repository. The detail arrives all together at the end anyway.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchProgress {
    operation: String,
    completed: usize,
    total: usize,
    repo_name: String,
    success: bool,
}

/// Name of the channel the frontend listens on.
const BATCH_PROGRESS_EVENT: &str = "batch-progress";

/// How many repositories found between one scan progress report and the next.
const SCAN_PROGRESS_EVERY: usize = 5;

fn emit_progress(
    app: &tauri::AppHandle,
    operation: &str,
    completed: usize,
    total: usize,
    result: &OperationResult,
) {
    // A failure to emit must not interrupt the batch: progress is informative,
    // and the real outcomes come back from the command regardless.
    let _ = app.emit(
        BATCH_PROGRESS_EVENT,
        BatchProgress {
            operation: operation.to_string(),
            completed,
            total,
            repo_name: result.repo_name.clone(),
            success: result.success,
        },
    );
}

fn join_error(error: impl std::fmt::Display) -> AppError {
    AppError::translated(
        "internal",
        "error.operationInterrupted",
        format!("The internal operation was interrupted: {error}"),
    )
    .with("reason", error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHubFrontendUser {
    login: String,
    name: Option<String>,
    avatar_url: String,
    html_url: String,
    bio: Option<String>,
    followers: u64,
    following: u64,
    public_repos: u64,
    total_private_repos: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHubFrontendSession {
    user: GitHubFrontendUser,
    repository_count: usize,
    installation_count: usize,
    expires_at: Option<u64>,
    persisted: bool,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum GitHubFrontendLoginPoll {
    Pending {
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: u64,
    },
    SlowDown {
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: u64,
    },
    Complete {
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: u64,
        session: GitHubFrontendSession,
    },
    /// It carries no message: the status alone is enough for the frontend to
    /// choose the sentence in the active language, which the backend does not
    /// know.
    Expired {
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHubFrontendRepository {
    id: u64,
    name: String,
    full_name: String,
    owner: String,
    private: bool,
    html_url: String,
    clone_url: String,
    ssh_url: String,
    default_branch: String,
    can_push: bool,
    can_admin: bool,
    installation_id: u64,
}

async fn frontend_github_session(
    client: &github::GitHubClient,
    session: &github::GitHubSession,
) -> GitHubFrontendSession {
    // Counts from the cache: they are two informative numbers, not worth a full
    // pagination on every read of the session.
    let (repository_count, installation_count) = client.repository_counts().await;

    GitHubFrontendSession {
        user: GitHubFrontendUser {
            login: session.user.login.clone(),
            name: session.user.name.clone(),
            avatar_url: session.user.avatar_url.clone(),
            html_url: session.user.html_url.clone(),
            bio: session.user.bio.clone(),
            followers: session.user.followers,
            following: session.user.following,
            public_repos: session.user.public_repos,
            total_private_repos: session.user.total_private_repos,
        },
        repository_count,
        installation_count,
        expires_at: session.expires_at,
        persisted: session.persisted,
    }
}

/// Opens the native folder dialog and records the chosen path.
///
/// The dialog lives in the backend, not the frontend, precisely so that "folder
/// chosen by the user" can be told apart from "string sent by the webview".
/// Returns `None` if the user cancels.
async fn choose_folder(
    app: &tauri::AppHandle,
    state: &AppState,
    title: &str,
) -> Result<Option<String>, AppError> {
    let dialog = app.dialog().clone();
    let title = title.to_string();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        dialog.file().set_title(title).blocking_pick_folder()
    })
    .await
    .map_err(join_error)?;

    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let chosen = chosen.into_path().map_err(|error| {
        AppError::translated(
            "internal",
            "error.folderNotUsable",
            format!("The chosen folder cannot be used: {error}"),
        )
        .with("reason", error.to_string())
    })?;
    let canonical = canonical_path(&chosen.to_string_lossy())?;

    {
        let mut chosen = state.folders_chosen_by_user.lock().map_err(|_| {
            AppError::translated(
                "internal",
                "error.internalState",
                "Internal state is unavailable.",
            )
        })?;
        chosen.insert(canonical.clone());
        store_chosen_folders(&chosen);
    }

    Ok(Some(
        canonical
            .to_str()
            .ok_or_else(|| folder_path_not_text(&canonical))?
            .to_string(),
    ))
}

/// Cleans the title that arrives from the frontend before handing it to the
/// native dialog.
///
/// The title is the only interface text the backend cannot translate on its
/// own: the dictionary lives in the frontend, which is also the only side that
/// knows which language is active. It therefore arrives already translated, but
/// is not used blindly — no line breaks, which would split the title bar, and a
/// maximum length, because an arbitrary string still comes from the webview. If
/// it ends up empty, the English sentence takes over, which is the original.
fn dialog_title(requested: &str, fallback: &'static str) -> String {
    let cleaned: String = requested
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.to_string()
    }
}

#[tauri::command]
async fn choose_workspace_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    title: String,
) -> Result<Option<String>, AppError> {
    choose_folder(
        &app,
        &state,
        &dialog_title(&title, "Choose the folder that contains the repositories"),
    )
    .await
}

#[tauri::command]
async fn choose_link_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    title: String,
) -> Result<Option<String>, AppError> {
    choose_folder(
        &app,
        &state,
        &dialog_title(&title, "Choose the local folder to link to GitHub"),
    )
    .await
}

/// Checks the path is one of the folders the user picked in the dialog.
///
/// A strict rule, reserved for the scan root: it is the root that decides which
/// repositories become authorised, so it must come from the dialog and from
/// nowhere else.
fn ensure_chosen_by_user(state: &AppState, folder_path: &str) -> Result<String, AppError> {
    let canonical = canonical_path(folder_path)?;
    let chosen = state.folders_chosen_by_user.lock().map_err(|_| {
        AppError::translated(
            "internal",
            "error.internalState",
            "Internal state is unavailable.",
        )
    })?;

    if !chosen.contains(&canonical) {
        return Err(unchosen_folder());
    }

    folder_as_text(&canonical)
}

/// Checks the folder comes from the user and not from a string invented by the
/// webview, accepting the two legitimate origins.
///
/// Linking to GitHub starts from two places: the picker inside the dialog,
/// which produces a folder chosen in person, and the dashboard rows, where the
/// path is that of a repository the backend itself found while scanning a root
/// that in turn came out of the dialog. Admitting only the first made the
/// second path always refused: pressing the link icon on a row answered by
/// asking to repeat a selection there was no way to make.
///
/// The security property holds all the same. `authorized_repositories` is
/// rewritten in full by the scan and contains nothing the webview can name at
/// will: it remains impossible to have `git init` run on an arbitrary path just
/// because it is writable.
fn ensure_folder_from_user(state: &AppState, folder_path: &str) -> Result<String, AppError> {
    let canonical = canonical_path(folder_path)?;

    let chosen_in_dialog = {
        let chosen = state.folders_chosen_by_user.lock().map_err(|_| {
            AppError::translated(
                "internal",
                "error.internalState",
                "Internal state is unavailable.",
            )
        })?;
        chosen.contains(&canonical)
    };

    if !chosen_in_dialog {
        let authorized = state.authorized_repositories.lock().map_err(|_| {
            AppError::translated(
                "internal",
                "error.internalState",
                "Internal state is unavailable.",
            )
        })?;
        if !authorized.contains(&canonical) {
            return Err(unchosen_folder());
        }
    }

    folder_as_text(&canonical)
}

fn unchosen_folder() -> AppError {
    AppError::translated(
        UNAUTHORIZED_REPOSITORY_CODE,
        "error.folderNotChosen",
        "The folder was not picked in the dialog: choose it again.",
    )
}

fn folder_path_not_text(canonical: &Path) -> AppError {
    AppError::translated(
        "internal",
        "error.folderPathNotText",
        format!(
            "The folder path cannot be represented as text: {}",
            canonical.display()
        ),
    )
    .with("path", canonical.display().to_string())
}

fn folder_as_text(canonical: &Path) -> Result<String, AppError> {
    canonical
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| folder_path_not_text(canonical))
}

#[tauri::command]
async fn scan_repositories(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    root_path: String,
    max_depth: Option<u32>,
) -> Result<ScanResult, AppError> {
    // Same rule as linking: the scan root decides which repositories become
    // authorised, so it cannot be a string chosen by the webview.
    let root_path = ensure_chosen_by_user(&state, &root_path)?;

    let _operation = git::begin_operation();
    let result = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_repositories(root_path, max_depth, &|found, name| {
            // One event per repository means up to 2000 IPC messages and as
            // many renders on a scan at the cap. The real cost is the Git
            // process per repository, but the churn is free to remove.
            if found != 1 && !found.is_multiple_of(SCAN_PROGRESS_EVERY) {
                return;
            }
            // The total is zero because during the walk there is no way to
            // know how many repositories there are: the interface shows the
            // count, not a percentage.
            let _ = app.emit(
                BATCH_PROGRESS_EVENT,
                BatchProgress {
                    operation: "scan".to_string(),
                    completed: found,
                    total: 0,
                    repo_name: name.to_string(),
                    success: true,
                },
            );
        })
    })
    .await
    .map_err(join_error)??;

    // The set is built in full before being installed. The code used to call
    // `clear()` and then insert with `?`: a path that became unresolvable
    // between the walk and this loop made the command exit leaving the
    // authorisations empty or half-filled, while the interface kept the previous
    // rows — which from that moment on all failed.
    let mut discovered = HashSet::with_capacity(result.repositories.len());
    for repository in &result.repositories {
        discovered.insert(canonical_path(&repository.path)?);
    }

    *state.authorized_repositories.lock().map_err(|_| {
        AppError::translated(
            "internal",
            "error.internalState",
            "Internal state is unavailable.",
        )
    })? = discovered;

    Ok(result)
}

#[tauri::command]
async fn refresh_repositories(
    state: tauri::State<'_, AppState>,
    repo_paths: Vec<String>,
) -> Result<Vec<RepositoryInfo>, AppError> {
    // Le repository sparite vengono semplicemente omesse dal risultato:
    // the interface merges by path, so the rows left unrefreshed keep their
    // previous state instead of failing the whole update.
    let _operation = git::begin_operation();
    let (repo_paths, _unavailable) =
        partition_authorized(&resolve_authorized(&state, &repo_paths)?);
    tauri::async_runtime::spawn_blocking(move || scanner::refresh_repositories(repo_paths))
        .await
        .map_err(join_error)?
}

#[tauri::command]
async fn get_repository_changes(
    state: tauri::State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<FileChange>, AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.repository_changes(&repo_path)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn get_repository_diff(
    state: tauri::State<'_, AppState>,
    repo_path: String,
) -> Result<DiffResult, AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.repository_diff(&repo_path)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn stage_files(
    state: tauri::State<'_, AppState>,
    repo_path: String,
    paths: Vec<String>,
) -> Result<OperationResult, AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let git = git::GitClient::discover()?;
        Ok::<OperationResult, AppError>(git.stage_files(&repo_path, paths))
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn unstage_files(
    state: tauri::State<'_, AppState>,
    repo_path: String,
    paths: Vec<String>,
) -> Result<OperationResult, AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let git = git::GitClient::discover()?;
        Ok::<OperationResult, AppError>(git.unstage_files(&repo_path, paths))
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn discard_files(
    state: tauri::State<'_, AppState>,
    repo_path: String,
    paths: Vec<String>,
) -> Result<OperationResult, AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let git = git::GitClient::discover()?;
        Ok::<OperationResult, AppError>(git.discard_files(&repo_path, paths))
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn github_begin_login(
    state: tauri::State<'_, AppState>,
) -> Result<github::GitHubDeviceAuthorization, AppError> {
    state.github.begin_login().await.map_err(AppError::from)
}

#[tauri::command]
async fn github_poll_login(
    state: tauri::State<'_, AppState>,
) -> Result<GitHubFrontendLoginPoll, AppError> {
    let result = state.github.poll_login().await?;

    Ok(match result {
        github::GitHubLoginPoll::Pending {
            retry_after_seconds,
        } => GitHubFrontendLoginPoll::Pending {
            retry_after_seconds,
        },
        github::GitHubLoginPoll::SlowDown {
            retry_after_seconds,
        } => GitHubFrontendLoginPoll::SlowDown {
            retry_after_seconds,
        },
        github::GitHubLoginPoll::Complete { session } => {
            let session = frontend_github_session(&state.github, &session).await;
            GitHubFrontendLoginPoll::Complete {
                retry_after_seconds: 0,
                session,
            }
        }
        github::GitHubLoginPoll::Expired => GitHubFrontendLoginPoll::Expired {
            retry_after_seconds: 0,
        },
    })
}

#[tauri::command]
async fn github_get_session(
    state: tauri::State<'_, AppState>,
) -> Result<Option<GitHubFrontendSession>, AppError> {
    let session = state.github.get_session().await?;
    match session {
        Some(session) => Ok(Some(frontend_github_session(&state.github, &session).await)),
        None => Ok(None),
    }
}

#[tauri::command]
async fn github_list_repositories(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<GitHubFrontendRepository>, AppError> {
    let list = state.github.list_repositories().await?;

    Ok(list
        .repositories
        .into_iter()
        .map(|repository| {
            let can_admin = repository
                .permissions
                .as_ref()
                .is_some_and(|permissions| permissions.admin);
            GitHubFrontendRepository {
                id: repository.id,
                name: repository.name,
                full_name: repository.full_name,
                owner: repository.owner,
                private: repository.private,
                html_url: repository.html_url,
                clone_url: repository.clone_url,
                ssh_url: repository.ssh_url,
                default_branch: repository
                    .default_branch
                    .unwrap_or_else(|| "sconosciuto".to_string()),
                can_push: repository.can_push && !repository.archived && !repository.disabled,
                can_admin,
                installation_id: repository.installation_id,
            }
        })
        .collect())
}

#[tauri::command]
async fn github_create_repository(
    state: tauri::State<'_, AppState>,
    request: github::GitHubCreateRepositoryRequest,
) -> Result<github::GitHubCreatedRepository, AppError> {
    state
        .github
        .create_repository(request)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
async fn github_delete_repository(
    state: tauri::State<'_, AppState>,
    request: github::GitHubDeleteRepositoryRequest,
) -> Result<github::GitHubDeleteRepositoryResult, AppError> {
    github::validate_delete_repository_request(&request)?;
    let repositories = state.github.list_repositories().await?.repositories;
    github::ensure_repository_can_be_deleted(&repositories, &request)?;
    state
        .github
        .delete_repository(request)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
async fn github_link_repository(
    state: tauri::State<'_, AppState>,
    request: GitHubLinkRepositoryRequest,
) -> Result<GitHubLinkRepositoryResult, AppError> {
    let repositories = state.github.list_repositories().await?.repositories;

    let repository = repositories
        .into_iter()
        .find(|repository| repository.full_name == request.repository_full_name)
        .ok_or_else(|| {
            AppError::translated(
                "notFound",
                "error.repositoryNotAccessible",
                "The GitHub repository is not reachable through the current installations.",
            )
        })?;
    if repository.clone_url != request.clone_url {
        return Err(AppError::translated(
            "invalidRequest",
            "error.cloneUrlMismatch",
            "The clone URL does not match the one GitHub returned for the repository.",
        ));
    }
    if !repository.can_push || repository.archived || repository.disabled {
        return Err(AppError::translated(
            "forbidden",
            "error.repositoryNotWritable",
            "The GitHub repository is not writable, or it is archived or disabled.",
        ));
    }

    // The folder must be one of those picked in the native dialog, not any
    // string that arrived from the webview: `git init` is run there
    // downstream.
    let folder_path = ensure_folder_from_user(&state, &request.folder_path)?;

    let trusted_request = GitHubLinkRepositoryRequest {
        folder_path,
        repository_full_name: repository.full_name,
        clone_url: repository.clone_url,
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.link_github_repository(trusted_request)
    })
    .await
    .map_err(join_error)??;

    let canonical = canonical_path(&result.repository.path)?;
    state
        .authorized_repositories
        .lock()
        .map_err(|_| {
            AppError::translated(
                "internal",
                "error.internalState",
                "Internal state is unavailable.",
            )
        })?
        .insert(canonical);

    Ok(result)
}

#[tauri::command]
async fn repository_history(
    state: tauri::State<'_, AppState>,
    request: HistoryRequest,
) -> Result<HistoryResult, AppError> {
    let repo_path = ensure_authorized_one(&state, &request.repo_path)?;
    let scope = request.scope;
    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.repository_history(&repo_path, scope)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn list_remotes(
    state: tauri::State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<RemoteInfo>, AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.list_remotes(&repo_path)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn set_remote(
    state: tauri::State<'_, AppState>,
    request: RemoteRequest,
) -> Result<RepositoryInfo, AppError> {
    let repo_path = ensure_authorized_one(&state, &request.repo_path)?;
    let name = request.name;
    let url = request.url.ok_or_else(|| {
        AppError::translated(
            "internal",
            "error.remoteUrlRequired",
            "A URL is needed to configure the remote.",
        )
    })?;

    tauri::async_runtime::spawn_blocking(move || {
        let client = git::GitClient::discover()?;
        client.set_remote(&repo_path, &name, &url)?;
        client.repository_info(std::path::Path::new(&repo_path))
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn remove_remote(
    state: tauri::State<'_, AppState>,
    request: RemoteRequest,
) -> Result<RepositoryInfo, AppError> {
    let repo_path = ensure_authorized_one(&state, &request.repo_path)?;
    let name = request.name;

    tauri::async_runtime::spawn_blocking(move || {
        let client = git::GitClient::discover()?;
        client.remove_remote(&repo_path, &name)?;
        client.repository_info(std::path::Path::new(&repo_path))
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn list_stashes(
    state: tauri::State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<StashEntry>, AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.list_stashes(&repo_path)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn create_stash(
    state: tauri::State<'_, AppState>,
    request: CreateStashRequest,
) -> Result<RepositoryInfo, AppError> {
    let repo_path = ensure_authorized_one(&state, &request.repo_path)?;
    let CreateStashRequest {
        message,
        include_untracked,
        ..
    } = request;

    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.create_stash(&repo_path, &message, include_untracked)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn apply_stash(
    state: tauri::State<'_, AppState>,
    request: StashActionRequest,
) -> Result<RepositoryInfo, AppError> {
    let repo_path = ensure_authorized_one(&state, &request.repo_path)?;
    let StashActionRequest {
        index,
        object_id,
        action,
        ..
    } = request;

    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.apply_stash(&repo_path, index, &object_id, action)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn conflict_state(
    state: tauri::State<'_, AppState>,
    repo_path: String,
) -> Result<ConflictState, AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.conflict_state(&repo_path)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn resolve_conflict(
    state: tauri::State<'_, AppState>,
    request: ConflictActionRequest,
) -> Result<RepositoryInfo, AppError> {
    let repo_path = ensure_authorized_one(&state, &request.repo_path)?;
    let action = request.action;

    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.resolve_conflict(&repo_path, action)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn list_branches(
    state: tauri::State<'_, AppState>,
    repo_path: String,
) -> Result<BranchList, AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.list_branches(&repo_path)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn switch_branch(
    state: tauri::State<'_, AppState>,
    request: SwitchBranchRequest,
) -> Result<RepositoryInfo, AppError> {
    let repo_path = ensure_authorized_one(&state, &request.repo_path)?;
    let branch = request.branch;
    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.switch_branch(&repo_path, &branch)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn create_branch(
    state: tauri::State<'_, AppState>,
    request: CreateBranchRequest,
) -> Result<RepositoryInfo, AppError> {
    let repo_path = ensure_authorized_one(&state, &request.repo_path)?;
    let CreateBranchRequest { name, checkout, .. } = request;
    tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.create_branch(&repo_path, &name, checkout)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
async fn github_clone_repository(
    state: tauri::State<'_, AppState>,
    request: GitHubCloneRepositoryRequest,
) -> Result<GitHubCloneRepositoryResult, AppError> {
    let repositories = state.github.list_repositories().await?.repositories;

    let repository = repositories
        .into_iter()
        .find(|repository| repository.full_name == request.repository_full_name)
        .ok_or_else(|| {
            AppError::translated(
                "notFound",
                "error.repositoryNotAccessible",
                "The GitHub repository is not reachable through the current installations.",
            )
        })?;
    if repository.clone_url != request.clone_url {
        return Err(AppError::translated(
            "invalidRequest",
            "error.cloneUrlMismatch",
            "The clone URL does not match the one GitHub returned for the repository.",
        ));
    }

    // A strict rule, as for the scan root: here no existing repository is
    // touched, a new folder is created on disk. The permission must come from
    // the native dialog and not from an already authorised repository.
    let parent_path = ensure_chosen_by_user(&state, &request.parent_path)?;

    // Cloning needs read access, not write: an archived or read-only repository
    // stays clonable, and forbidding it here would protect nobody.
    let trusted_request = GitHubCloneRepositoryRequest {
        parent_path,
        repository_full_name: repository.full_name,
        clone_url: repository.clone_url,
        folder_name: request.folder_name,
    };

    let github_token = state.github.token_for_git().await?.ok_or_else(|| {
        AppError::translated(
            "authenticationRequired",
            "account.sessionUnavailable",
            "GitHub authorised the request, but the session is no longer available.",
        )
    })?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        git::GitClient::discover()?.clone_github_repository(trusted_request, &github_token)
    })
    .await
    .map_err(join_error)??;

    let canonical = canonical_path(&result.repository.path)?;
    state
        .authorized_repositories
        .lock()
        .map_err(|_| {
            AppError::translated(
                "internal",
                "error.internalState",
                "Internal state is unavailable.",
            )
        })?
        .insert(canonical);

    Ok(result)
}

#[tauri::command]
async fn choose_clone_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    title: String,
) -> Result<Option<String>, AppError> {
    choose_folder(
        &app,
        &state,
        &dialog_title(&title, "Choose where to create the local copy"),
    )
    .await
}

#[tauri::command]
async fn github_logout(state: tauri::State<'_, AppState>) -> Result<(), AppError> {
    state
        .github
        .logout()
        .await
        .map(|_| ())
        .map_err(AppError::from)
}

#[tauri::command]
async fn commit_repositories(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    requests: Vec<CommitRequest>,
) -> Result<Vec<OperationResult>, AppError> {
    let repo_paths = requests
        .iter()
        .map(|request| request.repo_path.clone())
        .collect::<Vec<_>>();
    // `begin_operation` before any waiting: resolving the paths and above all
    // `token_for_git` can take seconds — a token refresh over the network may
    // happen in between — and a cancellation that arrived in that window used to
    // be cleared without the user ever knowing.
    let _operation = git::begin_operation();
    let resolved = resolve_authorized(&state, &repo_paths)?;

    // The requests receive the canonical paths: the caller's string must not
    // reach Git, since in the meantime it could resolve elsewhere. Vanished
    // repositories stay out, and their outcome comes back in the right place in
    // `merge_in_request_order`.
    let requests = requests
        .into_iter()
        .zip(&resolved)
        .filter_map(|(mut request, entry)| match entry {
            AuthorizedPath::Ready(canonical) => {
                request.repo_path = canonical.clone();
                Some(request)
            }
            AuthorizedPath::Unavailable { .. } => None,
        })
        .collect::<Vec<_>>();

    let completed = tauri::async_runtime::spawn_blocking(move || {
        Ok::<Vec<OperationResult>, AppError>(
            git::GitClient::discover()?.commit_many(requests, &|completed, total, result| {
                emit_progress(&app, "commit", completed, total, result)
            }),
        )
    })
    .await
    .map_err(join_error)??;

    Ok(merge_in_request_order(&resolved, "commit", completed))
}

#[tauri::command]
async fn fetch_repositories(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    repo_paths: Vec<String>,
) -> Result<Vec<OperationResult>, AppError> {
    // `begin_operation` before any waiting: resolving the paths and above all
    // `token_for_git` can take seconds — a token refresh over the network may
    // happen in between — and a cancellation that arrived in that window used to
    // be cleared without the user ever knowing.
    let _operation = git::begin_operation();
    let resolved = resolve_authorized(&state, &repo_paths)?;
    let (repo_paths, _) = partition_authorized(&resolved);
    let github_token = state.github.token_for_git().await?;

    let completed = tauri::async_runtime::spawn_blocking(move || {
        Ok::<Vec<OperationResult>, AppError>(git::GitClient::discover()?.fetch_many(
            repo_paths,
            github_token,
            &|completed, total, result| emit_progress(&app, "fetch", completed, total, result),
        ))
    })
    .await
    .map_err(join_error)??;

    Ok(merge_in_request_order(&resolved, "fetch", completed))
}

#[tauri::command]
async fn pull_repositories(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    repo_paths: Vec<String>,
    // An absent `strategy` means fast-forward: the cautious strategy stays the
    // behaviour for whoever does not choose.
    strategy: Option<PullStrategy>,
) -> Result<Vec<OperationResult>, AppError> {
    // `begin_operation` before any waiting: resolving the paths and above all
    // `token_for_git` can take seconds — a token refresh over the network may
    // happen in between — and a cancellation that arrived in that window used to
    // be cleared without the user ever knowing.
    let _operation = git::begin_operation();
    let resolved = resolve_authorized(&state, &repo_paths)?;
    let (repo_paths, _) = partition_authorized(&resolved);
    let github_token = state.github.token_for_git().await?;
    let strategy = strategy.unwrap_or_default();

    let completed = tauri::async_runtime::spawn_blocking(move || {
        Ok::<Vec<OperationResult>, AppError>(git::GitClient::discover()?.pull_many(
            repo_paths,
            github_token,
            strategy,
            &|completed, total, result| emit_progress(&app, "pull", completed, total, result),
        ))
    })
    .await
    .map_err(join_error)??;

    Ok(merge_in_request_order(&resolved, "pull", completed))
}

#[tauri::command]
async fn push_repositories(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    repo_paths: Vec<String>,
) -> Result<Vec<OperationResult>, AppError> {
    // `begin_operation` before any waiting: resolving the paths and above all
    // `token_for_git` can take seconds — a token refresh over the network may
    // happen in between — and a cancellation that arrived in that window used to
    // be cleared without the user ever knowing.
    let _operation = git::begin_operation();
    let resolved = resolve_authorized(&state, &repo_paths)?;
    let (repo_paths, _) = partition_authorized(&resolved);
    let github_token = state.github.token_for_git().await?;

    let completed = tauri::async_runtime::spawn_blocking(move || {
        Ok::<Vec<OperationResult>, AppError>(git::GitClient::discover()?.push_many(
            repo_paths,
            github_token,
            &|completed, total, result| emit_progress(&app, "push", completed, total, result),
        ))
    })
    .await
    .map_err(join_error)??;

    Ok(merge_in_request_order(&resolved, "push", completed))
}

/// Shows the repository folder in the system file manager.
///
/// It goes through a command of ours instead of the
/// `opener:allow-reveal-item-in-dir` permission granted to the webview, which
/// had no scope: with that, the interface could ask the OS to reveal any
/// absolute path whose name it knew, stepping over `ensure_authorized` because
/// the call never passed through the command layer. Now the same rule as
/// everything else applies: only the repositories of the current scan.
#[tauri::command]
async fn reveal_repository(
    state: tauri::State<'_, AppState>,
    repo_path: String,
) -> Result<(), AppError> {
    let repo_path = ensure_authorized_one(&state, &repo_path)?;
    tauri_plugin_opener::reveal_item_in_dir(&repo_path).map_err(|error| {
        AppError::translated(
            "internal",
            "error.folderUnreadable",
            format!("The folder could not be opened: {error}"),
        )
        .with("reason", error.to_string())
    })
}

/// Chiede l'interruzione dell'operazione Git in corso. Non attende: i cicli
/// batch e l'attesa del processo controllano la richiesta e si fermano appena
/// possibile, uccidendo il processo Git attivo.
#[tauri::command]
fn cancel_operations() {
    git::request_cancel();
}

/// Runs this executable as a constrained Git askpass helper when invoked by a
/// child Git process. The helper validates a github.com HTTPS prompt and obtains
/// the token once from the parent process's in-memory, nonce-protected broker;
/// it never reads the OS keyring or receives the token through arguments or
/// environment variables.
pub fn run_git_askpass_if_requested() -> Option<i32> {
    git::run_askpass_if_requested()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything else: from here on a panic leaves a trace on disk instead
    // of making the process disappear in silence.
    diagnostics::install_panic_hook();

    let app = tauri::Builder::default()
        .manage(AppState::default())
        .plugin(diagnostics::logging_plugin())
        // Window size and position survive closing: every start used to reopen
        // at 1440x900 in the centre, ignoring how the user had arranged the
        // window.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_repositories,
            refresh_repositories,
            get_repository_changes,
            get_repository_diff,
            list_branches,
            switch_branch,
            create_branch,
            repository_history,
            list_remotes,
            set_remote,
            remove_remote,
            list_stashes,
            create_stash,
            apply_stash,
            conflict_state,
            resolve_conflict,
            stage_files,
            unstage_files,
            discard_files,
            github_begin_login,
            github_poll_login,
            github_get_session,
            github_list_repositories,
            github_create_repository,
            github_delete_repository,
            github_link_repository,
            github_clone_repository,
            github_logout,
            commit_repositories,
            fetch_repositories,
            pull_repositories,
            push_repositories,
            cancel_operations,
            reveal_repository,
            choose_workspace_folder,
            choose_link_folder,
            choose_clone_folder,
        ])
        .build(tauri::generate_context!());

    match app {
        Ok(app) => {
            log::info!("RubyRepo {} started", env!("CARGO_PKG_VERSION"));
            app.run(|_handle, _event| {});
        }
        Err(error) => {
            // The old `.expect(...)` died here with no window and, in release
            // on Windows, without even a line on stderr.
            diagnostics::write_fatal(&format!("RubyRepo failed to start: {error}"));
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a temporary folder for the test and registers it among the
    /// authorised ones. Returns the state, the canonical form, and the path as a
    /// caller would write it: on platforms with a verbatim prefix the two do not
    /// coincide.
    fn authorized_state(name: &str) -> (AppState, PathBuf, PathBuf) {
        let directory = std::env::temp_dir().join(format!("mrm-auth-{name}"));
        std::fs::create_dir_all(&directory).expect("la cartella di prova deve essere creabile");
        let canonical = directory
            .canonicalize()
            .expect("la cartella appena creata deve essere canonicalizzabile");

        let state = AppState::default();
        state
            .authorized_repositories
            .lock()
            .expect("stato non contendibile nel test")
            .insert(canonical.clone());

        (state, canonical, directory)
    }

    /// The point of the fix: what comes out of the authorisation, and therefore
    /// what reaches Git, is the canonical form and not the string the caller
    /// supplied.
    #[test]
    fn authorization_returns_canonical_paths_instead_of_caller_strings() {
        let (state, canonical, directory) = authorized_state("canonical");
        let requested = directory.to_string_lossy().to_string();

        let resolved = ensure_authorized(&state, std::slice::from_ref(&requested))
            .expect("il percorso indica una repository autorizzata");

        assert_eq!(resolved.len(), 1);
        assert_eq!(
            resolved[0],
            canonical.to_str().expect("percorso rappresentabile")
        );
        // On Windows canonicalisation adds the verbatim prefix, so the two
        // strings genuinely diverge and the assertion has teeth. Elsewhere they
        // may coincide: in that case the one above still holds.
        if canonical != directory {
            assert_ne!(
                resolved[0], requested,
                "la forma canonica deve sostituire la stringa del chiamante"
            );
        }

        std::fs::remove_dir_all(&canonical).ok();
    }

    /// The hole this gate closes: `github_link_repository` accepted whatever
    /// `folder_path` arrived from the webview and ran `git init` there, adding
    /// it to the authorised set afterwards. Knowing a writable path was enough.
    /// Now the dialog is opened by the backend, which knows which folders the
    /// user really picked.
    #[test]
    fn only_folders_picked_in_the_native_dialog_are_accepted() {
        let (state, canonical, directory) = authorized_state("chosen");
        let requested = directory.to_string_lossy().to_string();

        // A folder that exists and is even authorised as a repository is not
        // enough: it has to have come through the dialog.
        let error = ensure_chosen_by_user(&state, &requested)
            .expect_err("una cartella mai scelta nel dialog non deve essere accettata");
        assert_eq!(error.code, UNAUTHORIZED_REPOSITORY_CODE);

        state
            .folders_chosen_by_user
            .lock()
            .expect("stato non contendibile nel test")
            .insert(canonical.clone());

        let accepted = ensure_chosen_by_user(&state, &requested).expect("ora e' stata scelta");
        assert_eq!(
            accepted,
            canonical.to_str().expect("percorso rappresentabile"),
            "deve tornare la forma canonica, non la stringa del chiamante"
        );

        std::fs::remove_dir_all(&canonical).ok();
    }

    /// The title of the native dialog is the only interface text that arrives
    /// from the webview instead of being born in the backend, because the
    /// frontend is what knows the active language. It must therefore be treated
    /// as input, not as a constant: no control characters, which in the title
    /// bar would disappear or break it, and a limited length.
    #[test]
    fn a_dialog_title_from_the_webview_is_cleaned_before_it_is_shown() {
        assert_eq!(
            dialog_title("Scegli la cartella", "fallback"),
            "Scegli la cartella",
            "un titolo normale deve passare intatto"
        );

        assert_eq!(
            dialog_title("Scegli\r\n\tla cartella", "fallback"),
            "Sceglila cartella",
            "i caratteri di controllo non devono raggiungere la barra del titolo"
        );

        assert_eq!(
            dialog_title("   ", "fallback"),
            "fallback",
            "un titolo vuoto o di soli spazi torna alla frase inglese"
        );

        let long = "a".repeat(500);
        assert_eq!(
            dialog_title(&long, "fallback").chars().count(),
            120,
            "un titolo arbitrariamente lungo deve essere troncato"
        );

        // The truncation counts characters, not bytes: cutting in the middle of
        // a UTF-8 sequence would produce a panic instead of a short title.
        let accented = "à".repeat(500);
        assert_eq!(
            dialog_title(&accented, "fallback").chars().count(),
            120,
            "il taglio deve valere anche sui caratteri multibyte"
        );
    }

    /// The gate, as it was, made it impossible to link a dashboard row to
    /// GitHub: the path is that of a repository found by the scan, not a folder
    /// picked in the dialog, and the user was asked to repeat a selection there
    /// was no way to make. It must stay a gate, though, because `git init` runs
    /// downstream.
    #[test]
    fn a_scanned_repository_can_be_linked_but_an_invented_path_cannot() {
        let (state, canonical, directory) = authorized_state("linkable");
        let requested = directory.to_string_lossy().to_string();

        // Found by a scan, never picked in the dialog: exactly the case of the
        // dashboard row.
        let accepted = ensure_folder_from_user(&state, &requested)
            .expect("una repository trovata dalla scansione deve essere collegabile");
        assert_eq!(
            accepted,
            canonical.to_str().expect("percorso rappresentabile"),
            "deve tornare la forma canonica, non la stringa del chiamante"
        );

        // The scan root, on the other hand, stays reserved for the dialog.
        let error = ensure_chosen_by_user(&state, &requested)
            .expect_err("essere autorizzata non basta per fare da radice di scansione");
        assert_eq!(error.code, UNAUTHORIZED_REPOSITORY_CODE);

        // Any writable folder stays out: that was the original hole.
        let outsider = std::env::temp_dir().join("mrm-cartella-estranea");
        std::fs::create_dir_all(&outsider).expect("cartella di prova creabile");
        let error = ensure_folder_from_user(&state, &outsider.to_string_lossy())
            .expect_err("una cartella mai vista non deve poter ricevere git init");
        assert_eq!(error.code, UNAUTHORIZED_REPOSITORY_CODE);

        std::fs::remove_dir_all(&outsider).ok();
        std::fs::remove_dir_all(&canonical).ok();
    }

    /// The persistence exists because the folder gate had killed the memory of
    /// the working folder: the app showed the remembered path and the scan
    /// always refused it. It must stay a gate, though: a vanished folder or a
    /// path never chosen must not come back in through this file.
    #[test]
    fn chosen_folders_survive_a_restart_but_vanished_ones_do_not() {
        let base = std::env::temp_dir().join("mrm-chosen-folders");
        std::fs::create_dir_all(&base).expect("cartella di prova creabile");

        let alive = base.join("viva");
        std::fs::create_dir_all(&alive).expect("cartella viva creabile");
        let alive = alive.canonicalize().expect("canonicalizzabile");

        let gone = base.join("sparita");
        std::fs::create_dir_all(&gone).expect("cartella sparita creabile");
        let gone = gone.canonicalize().expect("canonicalizzabile");

        let mut folders = HashSet::new();
        folders.insert(alive.clone());
        folders.insert(gone.clone());
        store_chosen_folders_in(&base, &folders);

        std::fs::remove_dir_all(&gone).expect("rimozione della cartella sparita");

        let reloaded = load_chosen_folders_from(&base);
        assert!(
            reloaded.contains(&alive),
            "una cartella scelta e ancora presente deve tornare disponibile"
        );
        assert!(
            !reloaded.contains(&gone),
            "una cartella sparita non deve rientrare dal file"
        );

        // A missing file is not an error: it is the first run.
        let vuota = base.join("mai-usata");
        std::fs::create_dir_all(&vuota).expect("cartella vuota creabile");
        assert!(load_chosen_folders_from(&vuota).is_empty());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn unauthorized_paths_are_rejected_before_reaching_git() {
        let (state, canonical, _) = authorized_state("rejected");
        let outsider = std::env::temp_dir().to_string_lossy().to_string();

        let error = ensure_authorized(&state, &[outsider])
            .expect_err("una cartella non scansionata non deve essere autorizzata");
        // The code, not the text: that is what the frontend must be able to
        // read in order to suggest scanning again.
        assert_eq!(error.code, UNAUTHORIZED_REPOSITORY_CODE);
        // The identifier, not the sentence: now that the message is translated,
        // the text depends on the language and asserting on it would be brittle.
        assert_eq!(
            error.message_id.as_deref(),
            Some("error.unauthorizedRepository")
        );

        std::fs::remove_dir_all(&canonical).ok();
    }

    /// A single unauthorised path must block the whole request: batch operations
    /// must not be able to smuggle a foreign repository through alongside the
    /// valid ones.
    #[test]
    fn a_single_unauthorized_path_rejects_the_whole_batch() {
        let (state, canonical, _) = authorized_state("batch");
        let authorized = canonical.to_string_lossy().to_string();
        let outsider = std::env::temp_dir().to_string_lossy().to_string();

        assert!(ensure_authorized(&state, std::slice::from_ref(&authorized)).is_ok());
        assert!(ensure_authorized(&state, &[authorized, outsider]).is_err());

        std::fs::remove_dir_all(&canonical).ok();
    }

    /// The defect this helper closes: the outcomes of vanished repositories were
    /// put first and the others appended, so as soon as one folder disappeared
    /// the returned order no longer matched the sent one and the interface
    /// attributed an outcome to the wrong row.
    #[test]
    fn results_come_back_in_the_order_the_frontend_asked_for() {
        let resolved = vec![
            AuthorizedPath::Ready("/w/prima".to_string()),
            AuthorizedPath::Unavailable {
                requested: "/w/sparita".to_string(),
                reason: "cartella inesistente".to_string(),
            },
            AuthorizedPath::Ready("/w/terza".to_string()),
        ];

        // Git returns only the outcomes of the repositories actually processed,
        // in the order they were handed to it.
        let completed = vec![
            git::unavailable_result("/w/prima", "fetch", "esito uno"),
            git::unavailable_result("/w/terza", "fetch", "esito tre"),
        ];

        let merged = merge_in_request_order(&resolved, "fetch", completed);

        assert_eq!(merged.len(), 3);
        assert!(merged[0].message.contains("esito uno"));
        assert!(
            merged[1].message.contains("cartella inesistente"),
            "l'esito della repository sparita deve stare nella sua posizione originale: {}",
            merged[1].message
        );
        assert!(merged[2].message.contains("esito tre"));
    }

    #[test]
    fn the_single_path_helper_agrees_with_the_batch_one() {
        let (state, canonical, _) = authorized_state("single");
        let requested = canonical.to_string_lossy().to_string();

        let one = ensure_authorized_one(&state, &requested).expect("percorso autorizzato");
        let many = ensure_authorized(&state, std::slice::from_ref(&requested))
            .expect("percorso autorizzato");
        assert_eq!(vec![one], many);

        std::fs::remove_dir_all(&canonical).ok();
    }

    /// A repository that vanished from disk must not prevent work on the
    /// others: one renamed folder used to be enough to fail the operation on all
    /// thirty-seven.
    #[test]
    fn a_vanished_repository_is_isolated_instead_of_failing_the_batch() {
        let (state, canonical, _) = authorized_state("vanished");
        let alive = canonical.to_string_lossy().to_string();
        let gone = canonical
            .join("sottocartella-inesistente")
            .to_string_lossy()
            .to_string();

        let resolved = resolve_authorized(&state, &[alive.clone(), gone.clone()])
            .expect("una repository sparita non deve far fallire la richiesta");
        let (ready, unavailable) = partition_authorized(&resolved);

        assert_eq!(ready.len(), 1, "la repository viva deve restare lavorabile");
        assert_eq!(
            ready[0],
            canonical.to_str().expect("percorso rappresentabile")
        );
        assert_eq!(unavailable.len(), 1);
        assert_eq!(unavailable[0].0, gone);

        std::fs::remove_dir_all(&canonical).ok();
    }

    /// The tolerance applies only to vanished repositories. An unauthorised path
    /// stays an anomaly and keeps failing everything: it means the frontend sent
    /// something that did not come from a scan.
    #[test]
    fn an_unauthorized_path_still_fails_the_tolerant_resolver() {
        let (state, canonical, _) = authorized_state("tolerant");
        let alive = canonical.to_string_lossy().to_string();
        let outsider = std::env::temp_dir().to_string_lossy().to_string();

        let error = resolve_authorized(&state, &[alive, outsider])
            .expect_err("una repository estranea deve restare un errore duro");
        assert_eq!(error.code, UNAUTHORIZED_REPOSITORY_CODE);
        // The identifier, not the sentence: now that the message is translated,
        // the text depends on the language and asserting on it would be brittle.
        assert_eq!(
            error.message_id.as_deref(),
            Some("error.unauthorizedRepository")
        );

        std::fs::remove_dir_all(&canonical).ok();
    }
}
