use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    pub path: String,
    pub name: String,
    pub branch: String,
    pub detached: bool,
    pub upstream: Option<String>,
    pub remote_name: Option<String>,
    pub remote_url: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
    pub conflicted: u32,
    pub changed_files: u32,
    pub head_short: Option<String>,
    pub last_commit: Option<String>,
    pub checked_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root_path: String,
    pub repositories: Vec<RepositoryInfo>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub staged: String,
    pub unstaged: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub repo_path: String,
    pub message: String,
    pub stage_all: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLinkRepositoryRequest {
    pub folder_path: String,
    pub repository_full_name: String,
    pub clone_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLinkRepositoryResult {
    pub repository: RepositoryInfo,
    pub initialized: bool,
    pub already_linked: bool,
    pub remote_name: String,
    pub remote_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCloneRepositoryRequest {
    /// The folder that will contain the clone, not the clone's own folder.
    pub parent_path: String,
    pub repository_full_name: String,
    pub clone_url: String,
    /// Name of the folder to create. Absent means "same as the repository":
    /// it is only needed when that name is already taken.
    pub folder_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
    /// Absent for local branches with no upstream, and for remote-only ones.
    pub upstream: Option<String>,
    /// Relation to the upstream: `ahead`, `behind`, `diverged`, `same`, `gone`.
    /// Comes from `%(upstream:trackshort)`, which unlike `track` does not change
    /// with the language Git speaks.
    pub track: Option<String>,
    pub subject: String,
    /// True when the branch exists only on a remote: choosing it creates the
    /// local copy that will track it.
    pub remote_only: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    pub branches: Vec<BranchInfo>,
    pub current: Option<String>,
    pub detached: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchBranchRequest {
    pub repo_path: String,
    pub branch: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBranchRequest {
    pub repo_path: String,
    pub name: String,
    /// False leaves the branch created without switching to it.
    pub checkout: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitEntry {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    /// ISO 8601 date exactly as Git produces it, with no reinterpretation.
    pub date: String,
}

/// Which part of the history is being asked for.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryScope {
    /// The most recent commits of the current branch.
    Recent,
    /// Only what a push would send: `@{upstream}..HEAD`.
    Outgoing,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRequest {
    pub repo_path: String,
    pub scope: HistoryScope,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResult {
    pub commits: Vec<CommitEntry>,
    /// Absent when the branch has no upstream: there "to send" means nothing,
    /// and that has to be said rather than shown as an empty list.
    pub upstream: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: String,
    /// Differs from `fetch_url` only when someone configured it on purpose.
    pub push_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRequest {
    pub repo_path: String,
    pub name: String,
    /// Absent when removing.
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// Current display position in the stack. It may change when another stash
    /// is created or removed, so actions also carry `object_id`.
    pub index: u32,
    /// Full object ID returned by `%H`; stable even when the reflog position
    /// changes. The backend verifies it again before every action.
    pub object_id: String,
    pub message: String,
    pub branch: Option<String>,
    pub date: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStashRequest {
    pub repo_path: String,
    pub message: String,
    pub include_untracked: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StashAction {
    /// Reapplies it and leaves the entry in the stack.
    Apply,
    /// Reapplies it and removes it.
    Pop,
    /// Throws it away without reapplying it.
    Drop,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashActionRequest {
    pub repo_path: String,
    pub index: u32,
    pub object_id: String,
    pub action: StashAction,
}

/// An operation left half-finished inside the repository.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PendingOperation {
    None,
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictState {
    pub pending: PendingOperation,
    /// Files still in conflict, with the path exactly as Git reports it.
    pub conflicted: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictAction {
    Abort,
    Continue,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictActionRequest {
    pub repo_path: String,
    pub action: ConflictAction,
}

/// How to integrate what comes from the remote.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PullStrategy {
    /// Moves forward only when there is nothing to reconcile. It stays the
    /// default because it is the only one that cannot produce a surprise
    /// conflict.
    #[default]
    FastForward,
    Merge,
    Rebase,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCloneRepositoryResult {
    pub repository: RepositoryInfo,
    pub folder_path: String,
    pub remote_name: String,
    pub remote_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub repo_path: String,
    pub repo_name: String,
    pub operation: String,
    pub success: bool,
    /// The outcome in a form code can read, not only a human eye.
    ///
    /// `success` alone was not enough: a repository skipped because the user
    /// cancelled, one that vanished from disk, and one that genuinely failed
    /// were three identical failures, told apart only by reading the prose of
    /// the message. Cancelling a push over forty repositories showed thirty
    /// "failed" rows with no way to know which had merely been skipped.
    pub code: String,
    pub message: String,
    /// Name of this outcome in the frontend dictionary, when it has one.
    ///
    /// It sits **beside** `message`, not in its place: `message` stays the
    /// English sentence, and still appears when no identifier has been assigned
    /// yet or when the dictionary does not know it. The message degrades, it
    /// does not disappear, and the conversion can proceed one site at a time.
    pub message_id: Option<String>,
    /// The values to place inside the translated sentence, kept separate from
    /// the sentence itself: the translation decides where they go, not the word
    /// order of the original.
    pub params: BTreeMap<String, String>,
    pub output: String,
    /// True when `output` was cut because it was too long.
    ///
    /// The marker is written by the frontend. Appending it here inside `output`
    /// meant slipping application text among Git's own words, and that text
    /// could not be translated without touching theirs too.
    pub output_truncated: bool,
}

impl OperationResult {
    /// Assigns the translation identifier. Same shape as
    /// `AppError::translated`, so the two paths look alike.
    pub fn translated(mut self, message_id: &str) -> Self {
        self.message_id = Some(message_id.to_string());
        self
    }

    pub fn with(mut self, name: &str, value: impl Into<String>) -> Self {
        self.params.insert(name.to_string(), value.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These field names are the contract with `src/types.ts`. Renaming a Rust
    /// field without updating the frontend fails no compilation at all: the
    /// value simply arrives `undefined` at runtime, and since the components
    /// are barely covered by tests you find out by using the app. These checks
    /// turn that silent break into a red test.
    fn field_names(value: &serde_json::Value) -> Vec<String> {
        let mut names = value
            .as_object()
            .expect("la struttura deve serializzare come oggetto")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    fn repository() -> RepositoryInfo {
        RepositoryInfo {
            path: "/workspace/demo".to_string(),
            name: "demo".to_string(),
            branch: "main".to_string(),
            detached: false,
            upstream: Some("origin/main".to_string()),
            remote_name: Some("origin".to_string()),
            remote_url: Some("https://github.com/demo/demo.git".to_string()),
            ahead: 1,
            behind: 2,
            staged: 3,
            unstaged: 4,
            untracked: 5,
            conflicted: 6,
            changed_files: 7,
            head_short: Some("abc1234".to_string()),
            last_commit: Some("commit".to_string()),
            checked_at: 1,
        }
    }

    #[test]
    fn repository_info_matches_the_frontend_contract() {
        let json = serde_json::to_value(repository()).expect("serializzabile");
        assert_eq!(
            field_names(&json),
            vec![
                "ahead",
                "behind",
                "branch",
                "changedFiles",
                "checkedAt",
                "conflicted",
                "detached",
                "headShort",
                "lastCommit",
                "name",
                "path",
                "remoteName",
                "remoteUrl",
                "staged",
                "unstaged",
                "untracked",
                "upstream",
            ]
        );
    }

    #[test]
    fn file_change_matches_the_frontend_contract() {
        let json = serde_json::to_value(FileChange {
            path: "a.txt".to_string(),
            original_path: Some("b.txt".to_string()),
            index_status: "M".to_string(),
            worktree_status: ".".to_string(),
            staged: true,
            unstaged: false,
            untracked: false,
            conflicted: false,
        })
        .expect("serializzabile");

        assert_eq!(
            field_names(&json),
            vec![
                "conflicted",
                "indexStatus",
                "originalPath",
                "path",
                "staged",
                "unstaged",
                "untracked",
                "worktreeStatus",
            ]
        );
    }

    #[test]
    fn operation_result_and_diff_match_the_frontend_contract() {
        let json = serde_json::to_value(OperationResult {
            repo_path: "/workspace/demo".to_string(),
            repo_name: "demo".to_string(),
            operation: "fetch".to_string(),
            success: true,
            code: "ok".to_string(),
            message: "ok".to_string(),
            message_id: None,
            params: BTreeMap::new(),
            output: String::new(),
            output_truncated: false,
        })
        .expect("serializzabile");
        assert_eq!(
            field_names(&json),
            vec![
                "code",
                "message",
                "messageId",
                "operation",
                "output",
                "outputTruncated",
                "params",
                "repoName",
                "repoPath",
                "success"
            ]
        );

        // The identifier and the parameters travel beside the message, not in
        // its place: the frontend translates when it recognises the identifier
        // and shows the English sentence when it does not.
        let translated = serde_json::to_value(
            OperationResult {
                repo_path: "/workspace/demo".to_string(),
                repo_name: "demo".to_string(),
                operation: "pull".to_string(),
                success: true,
                code: "ok".to_string(),
                message: "The repository is already up to date.".to_string(),
                message_id: None,
                params: BTreeMap::new(),
                output: String::new(),
                output_truncated: false,
            }
            .translated("outcome.alreadyUpToDate")
            .with("branch", "main"),
        )
        .expect("serializzabile");
        assert_eq!(translated["messageId"], "outcome.alreadyUpToDate");
        assert_eq!(translated["params"]["branch"], "main");
        assert_eq!(
            translated["message"], "The repository is already up to date.",
            "la frase inglese deve restare come ripiego"
        );

        let json = serde_json::to_value(DiffResult {
            staged: String::new(),
            unstaged: String::new(),
            truncated: false,
        })
        .expect("serializzabile");
        assert_eq!(field_names(&json), vec!["staged", "truncated", "unstaged"]);
    }

    #[test]
    fn scan_result_and_link_result_match_the_frontend_contract() {
        let json = serde_json::to_value(ScanResult {
            root_path: "/workspace".to_string(),
            repositories: Vec::new(),
            warnings: Vec::new(),
        })
        .expect("serializzabile");
        assert_eq!(
            field_names(&json),
            vec!["repositories", "rootPath", "warnings"]
        );

        let json = serde_json::to_value(GitHubLinkRepositoryResult {
            repository: repository(),
            initialized: true,
            already_linked: false,
            remote_name: "origin".to_string(),
            remote_url: "https://github.com/demo/demo.git".to_string(),
        })
        .expect("serializzabile");
        assert_eq!(
            field_names(&json),
            vec![
                "alreadyLinked",
                "initialized",
                "remoteName",
                "remoteUrl",
                "repository",
            ]
        );
    }

    #[test]
    fn stash_entries_expose_the_stable_object_id() {
        let json = serde_json::to_value(StashEntry {
            index: 2,
            object_id: "0123456789012345678901234567890123456789".to_string(),
            message: "saved work".to_string(),
            branch: Some("main".to_string()),
            date: "2026-08-10T10:00:00Z".to_string(),
        })
        .expect("serializzabile");
        assert_eq!(
            field_names(&json),
            vec!["branch", "date", "index", "message", "objectId"]
        );
    }

    /// Requests travel the other way: the frontend builds them, so what needs
    /// checking is deserialization from the camelCase names.
    #[test]
    fn requests_are_accepted_in_camel_case_from_the_frontend() {
        let commit: CommitRequest = serde_json::from_str(
            r#"{"repoPath":"/workspace/demo","message":"messaggio","stageAll":true}"#,
        )
        .expect("il frontend invia camelCase");
        assert_eq!(commit.repo_path, "/workspace/demo");
        assert!(commit.stage_all);

        let link: GitHubLinkRepositoryRequest = serde_json::from_str(
            r#"{"folderPath":"/workspace/demo","repositoryFullName":"demo/demo","cloneUrl":"https://github.com/demo/demo.git"}"#,
        )
        .expect("il frontend invia camelCase");
        assert_eq!(link.repository_full_name, "demo/demo");

        let stash: StashActionRequest = serde_json::from_str(
            r#"{"repoPath":"/workspace/demo","index":1,"objectId":"0123456789012345678901234567890123456789","action":"drop"}"#,
        )
        .expect("the frontend sends the stable stash object ID");
        assert_eq!(stash.index, 1);
        assert_eq!(stash.object_id.len(), 40);
        assert_eq!(stash.action, StashAction::Drop);

        // The snake_case form must not be accepted: it would mean the contract
        // is ambiguous, and that a break could pass unnoticed.
        assert!(serde_json::from_str::<CommitRequest>(
            r#"{"repo_path":"/x","message":"m","stage_all":true}"#
        )
        .is_err());
    }
}
