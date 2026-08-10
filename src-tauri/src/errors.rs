//! The structured error every Tauri command returns.
//!
//! Each command used to return `Result<T, String>` and flatten even the GitHub
//! errors with `.map_err(|e| e.to_string())` — errors that were already typed:
//! `code`, `retryable` and `retry_after_seconds` existed in the backend but
//! never reached the frontend. The interface was therefore forced to tell the
//! cases apart with a regex over the message text, mixing hand-written prose
//! with Git's raw stderr — a branch that breaks in silence when a sentence is
//! reworded or Git changes version.
//!
//! `AppError` keeps the code when there is one, and carries a `message_id`
//! beside the message: the name of the sentence in the frontend dictionary,
//! which is the only place where all five languages exist.
//!
//! The automatic conversion from `String` **no longer exists**. It did, and it
//! earned its keep: it allowed converting one message at a time with the
//! project compiling at every step. But while it remained, an error with no
//! identifier was indistinguishable from a classified one, and with five
//! languages that difference is between a translated message and one that stays
//! English for everybody. Now the compiler demands an explicit choice at every
//! error.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::github::{GitHubError, GitHubErrorCode};

/// Generic code for errors with no classification of their own. It is not an
/// "unknown" to hide: it says the cause was not told apart.
pub const GENERIC_CODE: &str = "internal";

/// Code for path authorisation errors, which the frontend must be able to tell
/// apart in order to suggest scanning again.
pub const UNAUTHORIZED_REPOSITORY_CODE: &str = "unauthorizedRepository";

/// Code for the conflict on the `origin` remote while linking to GitHub: the
/// one case the frontend used to discriminate with a regex.
pub const ORIGIN_CONFLICT_CODE: &str = "originConflict";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    /// English text, and the fallback the frontend shows when there is no
    /// translatable identifier. Git's own output arrives here too, and that is
    /// deliberate: it is Git speaking, not the application.
    pub message: String,
    /// Identifier of the translated message, when the error has one.
    ///
    /// Added beside `message` rather than replacing it so the conversion can
    /// proceed one call site at a time with the project compiling throughout.
    /// The last step removes `From<String>`, after which every error must carry
    /// an identifier and the compiler enforces it.
    pub message_id: Option<String>,
    /// Values filling the `{name}` placeholders of the translated message.
    pub params: BTreeMap<String, String>,
    pub retryable: bool,
    pub retry_after_seconds: Option<u64>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            message_id: None,
            params: BTreeMap::new(),
            retryable: false,
            retry_after_seconds: None,
        }
    }

    /// Error carrying a translatable identifier.
    ///
    /// `message` stays as the English text so logs and the browser preview keep
    /// reading, and so an identifier the frontend does not know yet degrades to
    /// a sentence instead of to nothing.
    pub fn translated(code: &str, message_id: &str, message: impl Into<String>) -> Self {
        Self {
            message_id: Some(message_id.to_string()),
            ..Self::new(code, message)
        }
    }

    /// Adds a value for a `{name}` placeholder.
    pub fn with(mut self, name: &str, value: impl Into<String>) -> Self {
        self.params.insert(name.to_string(), value.into());
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl From<GitHubError> for AppError {
    fn from(error: GitHubError) -> Self {
        let code = github_code(&error.code);
        Self {
            code: code.to_string(),
            message: error.message,
            message_id: Some(format!("github.error.{code}")),
            params: BTreeMap::new(),
            retryable: error.retryable,
            retry_after_seconds: error.retry_after_seconds,
        }
    }
}

/// The codes travel as camelCase strings: they are a contract towards the
/// frontend, so they must stay stable even if the Rust enum changes shape.
fn github_code(code: &GitHubErrorCode) -> &'static str {
    match code {
        GitHubErrorCode::InvalidRequest => "invalidRequest",
        GitHubErrorCode::Network => "network",
        GitHubErrorCode::Timeout => "timeout",
        GitHubErrorCode::InvalidResponse => "invalidResponse",
        GitHubErrorCode::InvalidDeviceFlow => "invalidDeviceFlow",
        GitHubErrorCode::NoPendingLogin => "noPendingLogin",
        GitHubErrorCode::LoginSuperseded => "loginSuperseded",
        GitHubErrorCode::AuthorizationDenied => "authorizationDenied",
        GitHubErrorCode::AuthenticationRequired => "authenticationRequired",
        GitHubErrorCode::AuthenticationExpired => "authenticationExpired",
        GitHubErrorCode::RateLimited => "rateLimited",
        GitHubErrorCode::Forbidden => "forbidden",
        GitHubErrorCode::NotFound => "notFound",
        GitHubErrorCode::StorageUnavailable => "storageUnavailable",
        GitHubErrorCode::Internal => "internal",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The contract towards the frontend is camelCase, as for every other
    /// structure that crosses the IPC.
    #[test]
    fn the_serialized_shape_uses_camel_case_field_names() {
        let error = AppError {
            code: ORIGIN_CONFLICT_CODE.to_string(),
            message: "conflict".to_string(),
            message_id: Some("originConflict".to_string()),
            params: BTreeMap::new(),
            retryable: true,
            retry_after_seconds: Some(30),
        };

        let json = serde_json::to_value(&error).expect("serializzabile");
        assert_eq!(json["code"], ORIGIN_CONFLICT_CODE);
        assert_eq!(json["message"], "conflict");
        assert_eq!(json["messageId"], "originConflict");
        assert_eq!(json["retryable"], true);
        assert_eq!(json["retryAfterSeconds"], 30);
        assert!(
            json.get("retry_after_seconds").is_none(),
            "il campo snake_case non deve comparire nel payload"
        );
    }

    /// The point of the conversion: GitHub errors reach the frontend with their
    /// own code, instead of being flattened down to the message alone.
    #[test]
    fn github_errors_keep_their_code_and_retry_hint() {
        let source = GitHubError {
            code: GitHubErrorCode::RateLimited,
            message: "troppe richieste".to_string(),
            retryable: true,
            retry_after_seconds: Some(60),
        };

        let converted = AppError::from(source);
        assert_eq!(converted.code, "rateLimited");
        assert_eq!(
            converted.message_id.as_deref(),
            Some("github.error.rateLimited")
        );
        assert!(converted.retryable);
        assert_eq!(converted.retry_after_seconds, Some(60));
    }

    #[test]
    fn every_github_error_code_has_a_stable_translation_id() {
        let cases = [
            (GitHubErrorCode::InvalidRequest, "invalidRequest"),
            (GitHubErrorCode::Network, "network"),
            (GitHubErrorCode::Timeout, "timeout"),
            (GitHubErrorCode::InvalidResponse, "invalidResponse"),
            (GitHubErrorCode::InvalidDeviceFlow, "invalidDeviceFlow"),
            (GitHubErrorCode::NoPendingLogin, "noPendingLogin"),
            (GitHubErrorCode::LoginSuperseded, "loginSuperseded"),
            (GitHubErrorCode::AuthorizationDenied, "authorizationDenied"),
            (
                GitHubErrorCode::AuthenticationRequired,
                "authenticationRequired",
            ),
            (
                GitHubErrorCode::AuthenticationExpired,
                "authenticationExpired",
            ),
            (GitHubErrorCode::RateLimited, "rateLimited"),
            (GitHubErrorCode::Forbidden, "forbidden"),
            (GitHubErrorCode::NotFound, "notFound"),
            (GitHubErrorCode::StorageUnavailable, "storageUnavailable"),
            (GitHubErrorCode::Internal, "internal"),
        ];

        for (code, camel_code) in cases {
            let converted = AppError::from(GitHubError {
                code,
                message: "safe fallback".to_string(),
                retryable: false,
                retry_after_seconds: None,
            });
            assert_eq!(converted.code, camel_code);
            assert_eq!(
                converted.message_id.as_deref(),
                Some(format!("github.error.{camel_code}").as_str())
            );
        }
    }

    /// An error without an identifier is still possible, but now it has to be
    /// built while saying so: `AppError::new` picks the generic code and leaves
    /// `message_id` empty, so the frontend shows the English sentence.
    ///
    /// `From<String>` used to exist, and this test checked that any string
    /// degraded onto the generic code. The automatic conversion was removed on
    /// purpose: it made the difference between a classified error and an
    /// unclassified one invisible, and with five languages that difference is
    /// between a translated message and one that stays English for everybody.
    #[test]
    fn an_error_without_an_identifier_is_still_possible_but_explicit() {
        let plain = AppError::new(GENERIC_CODE, "something went wrong");
        assert_eq!(plain.code, GENERIC_CODE);
        assert_eq!(plain.message_id, None);
        assert!(plain.params.is_empty());
        assert!(!plain.retryable);
        assert_eq!(plain.retry_after_seconds, None);
    }
}
