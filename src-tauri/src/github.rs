use std::collections::HashSet;
use std::fmt;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use keyring::v1::{Entry as KeyringEntry, Error as KeyringError};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, LINK, RETRY_AFTER};
use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use url::Url;
use zeroize::Zeroizing;

pub const GITHUB_CLIENT_ID: &str = "Iv23liflntPHvmAvb8Hf";

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const OAUTH_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const API_BASE_URL: &str = "https://api.github.com";
const API_VERSION: &str = "2026-03-10";
const API_VERSION_HEADER: &str = "x-github-api-version";
const USER_AGENT_VALUE: &str = concat!("RubyRepo/", env!("CARGO_PKG_VERSION"));
const KEYRING_SERVICE: &str = "com.rubyrepo.desktop.github";

/// The keychain service used before the rename. Read once, when the new one is
/// empty, so an existing sign-in survives the change of name: losing it would
/// mean going through the whole Device Flow again for no reason the user can
/// see.
const LEGACY_KEYRING_SERVICE: &str = "com.multirepomanager.desktop.github";
const KEYRING_ACCOUNT: &str = "github.com:Iv23liflntPHvmAvb8Hf";
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_GRANT_TYPE: &str = "refresh_token";
const TOKEN_STORAGE_VERSION: u8 = 1;
/// How long the counts shown in the interface stay valid. They are
/// informative: a few minutes of delay changes nothing, a full pagination on
/// every read does.
const COUNTS_CACHE_SECONDS: u64 = 300;
const REFRESH_SKEW_SECONDS: u64 = 5 * 60;
const HTTP_TIMEOUT_SECONDS: u64 = 30;
const CONNECT_TIMEOUT_SECONDS: u64 = 10;
const MAX_PAGES: usize = 1_000;
const MAX_ERROR_MESSAGE_CHARS: usize = 600;
const MAX_REPOSITORY_NAME_CHARS: usize = 100;
const MAX_REPOSITORY_DESCRIPTION_CHARS: usize = 350;
const MAX_REPOSITORY_FULL_NAME_CHARS: usize = 255;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitHubErrorCode {
    InvalidRequest,
    Network,
    Timeout,
    InvalidResponse,
    InvalidDeviceFlow,
    NoPendingLogin,
    LoginSuperseded,
    AuthorizationDenied,
    AuthenticationRequired,
    AuthenticationExpired,
    RateLimited,
    Forbidden,
    NotFound,
    StorageUnavailable,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubError {
    pub code: GitHubErrorCode,
    pub message: String,
    pub retryable: bool,
    pub retry_after_seconds: Option<u64>,
}

impl GitHubError {
    fn new(code: GitHubErrorCode, message: impl AsRef<str>, retryable: bool) -> Self {
        Self {
            code,
            message: sanitize_error_message(message.as_ref()),
            retryable,
            retry_after_seconds: None,
        }
    }

    fn with_retry_after(mut self, retry_after_seconds: Option<u64>) -> Self {
        self.retry_after_seconds = retry_after_seconds;
        self
    }

    fn authentication_required() -> Self {
        Self::new(
            GitHubErrorCode::AuthenticationRequired,
            "Sign in to GitHub to continue.",
            false,
        )
    }
}

impl fmt::Display for GitHubError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for GitHubError {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeviceAuthorization {
    pub user_code: String,
    pub verification_uri: String,
    /// Unix timestamp in milliseconds.
    pub expires_at: u64,
    pub interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum GitHubLoginPoll {
    Pending {
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: u64,
    },
    SlowDown {
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: u64,
    },
    Complete {
        session: GitHubSession,
    },
    Expired,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSession {
    pub user: GitHubUser,
    /// Unix timestamp in milliseconds; absent for non-expiring tokens.
    pub expires_at: Option<u64>,
    /// Unix timestamp in milliseconds; absent when no refresh token was issued.
    pub refresh_expires_at: Option<u64>,
    /// False means that the token is available only until this process exits.
    pub persisted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUser {
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
    pub html_url: String,
    pub bio: Option<String>,
    pub followers: u64,
    pub following: u64,
    pub public_repos: u64,
    pub total_private_repos: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubInstallation {
    pub id: u64,
    pub account_id: u64,
    pub account_login: String,
    pub account_type: String,
    pub avatar_url: String,
    pub repository_selection: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryPermissions {
    pub admin: bool,
    pub maintain: bool,
    pub push: bool,
    pub triage: bool,
    pub pull: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    pub id: u64,
    pub installation_id: u64,
    pub name: String,
    pub full_name: String,
    pub owner: String,
    pub private: bool,
    pub archived: bool,
    pub disabled: bool,
    pub default_branch: Option<String>,
    pub html_url: String,
    pub clone_url: String,
    pub ssh_url: String,
    pub can_push: bool,
    pub permissions: Option<GitHubRepositoryPermissions>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryList {
    pub installations: Vec<GitHubInstallation>,
    pub repositories: Vec<GitHubRepository>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreateRepositoryRequest {
    pub name: String,
    pub description: Option<String>,
    pub private: bool,
    pub auto_init: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCreatedRepository {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub html_url: String,
    pub clone_url: String,
    pub ssh_url: String,
    pub default_branch: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeleteRepositoryRequest {
    pub repository_id: u64,
    pub repository_full_name: String,
    pub confirmation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubDeleteRepositoryResult {
    pub repository_id: u64,
    pub repository_full_name: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLogoutResult {
    pub logged_out: bool,
    pub persisted_credential_removed: bool,
}

#[derive(Clone)]
pub struct GitHubClient {
    /// Built on the first request rather than in the constructor: `AppState` is
    /// created during Tauri setup, before any window exists, and a failure in
    /// `reqwest` (TLS init, system certificates) used to kill the process in
    /// silence. This way the error becomes an ordinary `GitHubError` on the
    /// first GitHub operation, and handling local repositories keeps working.
    http: OnceLock<Client>,
    state: Arc<Mutex<ClientState>>,
    /// Root of the OAuth endpoints, replaceable **in tests only**.
    ///
    /// The Device Flow and token refresh were entirely unverified: no test
    /// touched an HTTP request. This field exists to point them at a fake
    /// server. It does not touch `ensure_allowed_api_url`, which keeps pinning
    /// the API calls to `api.github.com` over HTTPS on 443: that check is a
    /// defence against SSRF and must not be weakened for the convenience of
    /// testing.
    #[cfg(test)]
    oauth_base: Option<String>,
}

#[derive(Clone)]
pub(crate) struct GitAccessToken(Arc<Zeroizing<String>>);

impl GitAccessToken {
    pub(crate) fn new(value: String) -> Result<Self, GitHubError> {
        if value.is_empty()
            || value.len() > 8_192
            || value
                .chars()
                .any(|character| character.is_control() || character.is_whitespace())
        {
            return Err(GitHubError::new(
                GitHubErrorCode::InvalidResponse,
                "GitHub returned an invalid credential.",
                false,
            ));
        }
        Ok(Self(Arc::new(Zeroizing::new(value))))
    }

    pub(crate) fn expose(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Debug for GitAccessToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("GitAccessToken([REDACTED])")
    }
}

impl fmt::Debug for GitHubClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("GitHubClient")
            .finish_non_exhaustive()
    }
}

impl GitHubClient {
    /// Infallible by construction: see the comment on the `http` field.
    pub fn new() -> Self {
        Self {
            http: OnceLock::new(),
            state: Arc::new(Mutex::new(ClientState::default())),
            #[cfg(test)]
            oauth_base: None,
        }
    }

    /// The URL to ask for a device code.
    fn device_code_url(&self) -> String {
        #[cfg(test)]
        if let Some(base) = &self.oauth_base {
            return format!("{base}/login/device/code");
        }
        DEVICE_CODE_URL.to_string()
    }

    /// URL a cui scambiare e rinnovare i token.
    fn oauth_token_url(&self) -> String {
        #[cfg(test)]
        if let Some(base) = &self.oauth_base {
            return format!("{base}/login/oauth/access_token");
        }
        OAUTH_TOKEN_URL.to_string()
    }

    /// Constructor reserved for tests, pointing the OAuth endpoints at a fake
    /// server. It does not exist in the production binary.
    #[cfg(test)]
    pub(crate) fn with_oauth_base(base: impl Into<String>) -> Self {
        Self {
            http: OnceLock::new(),
            state: Arc::new(Mutex::new(ClientState::default())),
            oauth_base: Some(base.into()),
        }
    }

    /// Returns the HTTP client, building it on the first call. If the build
    /// fails the error is raised again on every later attempt, so a transient
    /// fault can clear without restarting the app.
    fn http(&self) -> Result<&Client, GitHubError> {
        if let Some(client) = self.http.get() {
            return Ok(client);
        }

        let client = build_http_client()?;
        // If another concurrent call already won the race, use its client.
        let _ = self.http.set(client);
        self.http.get().ok_or_else(|| {
            GitHubError::new(
                GitHubErrorCode::Internal,
                "The GitHub client could not be initialized.",
                false,
            )
        })
    }

    /// Starts one Device Flow authorization. The device code is retained only in this
    /// backend instance and is never part of the serialized return value.
    pub async fn begin_login(&self) -> Result<GitHubDeviceAuthorization, GitHubError> {
        self.ensure_storage_loaded().await;

        let response = self
            .http()?
            .post(self.device_code_url())
            .header(ACCEPT, "application/json")
            .form(&[("client_id", GITHUB_CLIENT_ID)])
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let envelope = response
            .json::<DeviceCodeEnvelope>()
            .await
            .map_err(|_| invalid_response("GitHub did not return a valid Device Flow response."))?;

        if !status.is_success() || envelope.error.is_some() {
            return Err(oauth_error(
                envelope.error.as_deref(),
                envelope.error_description.as_deref(),
                status,
            ));
        }

        let device_code = required_nonempty(envelope.device_code, "device_code")?;
        let user_code = required_nonempty(envelope.user_code, "user_code")?;
        let verification_uri = validate_verification_uri(&required_nonempty(
            envelope.verification_uri,
            "verification_uri",
        )?)?;
        let expires_in = envelope
            .expires_in
            .filter(|value| *value > 0)
            .ok_or_else(|| invalid_response("The GitHub code expiry is invalid."))?;
        let interval_seconds = envelope.interval.unwrap_or(5).max(1);
        let now = unix_seconds()?;
        let expires_at = now.saturating_add(expires_in);

        let mut state = self.state.lock().await;
        state.next_flow_id = state.next_flow_id.wrapping_add(1).max(1);
        let flow_id = state.next_flow_id;
        state.pending_login = Some(PendingLogin {
            flow_id,
            device_code,
            expires_at,
            interval_seconds,
            next_poll_at: now.saturating_add(interval_seconds),
        });

        Ok(GitHubDeviceAuthorization {
            user_code,
            verification_uri,
            expires_at: seconds_to_millis(expires_at),
            interval_seconds,
        })
    }

    /// Performs at most one network poll. Callers must honor retryAfterSeconds.
    pub async fn poll_login(&self) -> Result<GitHubLoginPoll, GitHubError> {
        let now = unix_seconds()?;
        let (flow_id, device_code) = {
            let mut state = self.state.lock().await;
            let pending = state.pending_login.as_mut().ok_or_else(|| {
                GitHubError::new(
                    GitHubErrorCode::NoPendingLogin,
                    "There is no pending GitHub sign-in.",
                    false,
                )
            })?;

            if now >= pending.expires_at {
                state.pending_login = None;
                return Ok(GitHubLoginPoll::Expired);
            }
            if now < pending.next_poll_at {
                return Ok(GitHubLoginPoll::Pending {
                    retry_after_seconds: pending.next_poll_at.saturating_sub(now).max(1),
                });
            }

            pending.next_poll_at = now.saturating_add(pending.interval_seconds);
            (pending.flow_id, pending.device_code.clone())
        };

        let response = self
            .http()?
            .post(self.oauth_token_url())
            .header(ACCEPT, "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("device_code", device_code.as_str()),
                ("grant_type", DEVICE_GRANT_TYPE),
            ])
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let envelope = response
            .json::<OAuthEnvelope>()
            .await
            .map_err(|_| invalid_response("GitHub did not return a valid OAuth response."))?;

        let mut state = self.state.lock().await;
        let is_current_flow = state
            .pending_login
            .as_ref()
            .is_some_and(|pending| pending.flow_id == flow_id);
        if !is_current_flow {
            return Err(GitHubError::new(
                GitHubErrorCode::LoginSuperseded,
                "This sign-in request was superseded by a newer one.",
                false,
            ));
        }

        if !status.is_success() && envelope.error.is_none() {
            return Err(http_status_error(
                status,
                None,
                "The GitHub OAuth request failed.",
            ));
        }

        if let Some(error) = envelope.error.as_deref() {
            match error {
                "authorization_pending" => {
                    let pending = state.pending_login.as_ref().expect("flow checked above");
                    return Ok(GitHubLoginPoll::Pending {
                        retry_after_seconds: pending.interval_seconds,
                    });
                }
                "slow_down" => {
                    let pending = state.pending_login.as_mut().expect("flow checked above");
                    let increased = pending.interval_seconds.saturating_add(5);
                    pending.interval_seconds =
                        envelope.interval.unwrap_or(increased).max(increased);
                    pending.next_poll_at = now.saturating_add(pending.interval_seconds);
                    return Ok(GitHubLoginPoll::SlowDown {
                        retry_after_seconds: pending.interval_seconds,
                    });
                }
                "expired_token" | "token_expired" => {
                    state.pending_login = None;
                    return Ok(GitHubLoginPoll::Expired);
                }
                "access_denied" => {
                    state.pending_login = None;
                    return Err(GitHubError::new(
                        GitHubErrorCode::AuthorizationDenied,
                        "GitHub authorization was cancelled.",
                        false,
                    ));
                }
                "incorrect_device_code" | "bad_verification_code" => {
                    state.pending_login = None;
                    return Err(GitHubError::new(
                        GitHubErrorCode::InvalidDeviceFlow,
                        "The GitHub device code is no longer valid.",
                        false,
                    ));
                }
                _ => {
                    state.pending_login = None;
                    return Err(oauth_error(
                        Some(error),
                        envelope.error_description.as_deref(),
                        status,
                    ));
                }
            }
        }

        let tokens = token_bundle_from_oauth(envelope, now)?;
        let persisted = persist_keyring_bundle(tokens.clone()).await;
        state.credentials = Some(Credentials { tokens, persisted });
        state.pending_login = None;
        drop(state);

        let session = self.get_session().await?.ok_or_else(|| {
            GitHubError::new(
                GitHubErrorCode::AuthenticationExpired,
                "GitHub authorized the device, but the session is unavailable.",
                false,
            )
        })?;
        Ok(GitHubLoginPoll::Complete { session })
    }

    /// Returns the current user session, refreshing expiring user tokens when needed.
    pub async fn get_session(&self) -> Result<Option<GitHubSession>, GitHubError> {
        self.ensure_storage_loaded().await;
        let user_url = api_url("/user")?;
        let user = match self.authorized_get_json::<ApiUser>(user_url).await {
            Ok(page) => page.value,
            Err(error)
                if matches!(
                    error.code,
                    GitHubErrorCode::AuthenticationRequired
                        | GitHubErrorCode::AuthenticationExpired
                ) =>
            {
                return Ok(None);
            }
            Err(error) => return Err(error),
        };

        let state = self.state.lock().await;
        let credentials = match state.credentials.as_ref() {
            Some(credentials) => credentials,
            None => return Ok(None),
        };

        Ok(Some(GitHubSession {
            user: user.into(),
            expires_at: credentials.tokens.access_expires_at.map(seconds_to_millis),
            refresh_expires_at: credentials.tokens.refresh_expires_at.map(seconds_to_millis),
            persisted: credentials.persisted,
        }))
    }

    /// Lists repositories available through every installation visible to the user token.
    /// Repository and installation counts for the interface, reusing the ones
    /// already computed when they are recent enough. Anyone who needs the real
    /// list keeps using `list_repositories`, which also refreshes the cache.
    pub async fn repository_counts(&self) -> (usize, usize) {
        // If the clock cannot be read the cache must be ignored, not treated as
        // eternal: with `unwrap_or(0)` the difference would always be zero, and
        // therefore always "fresh". The same holds for a clock that goes back.
        if let Ok(now) = unix_seconds() {
            if let Some((repositories, installations, fetched_at)) =
                self.state.lock().await.repository_counts
            {
                if now >= fetched_at && now - fetched_at < COUNTS_CACHE_SECONDS {
                    return (repositories, installations);
                }
            }
        }

        self.list_repositories()
            .await
            .map(|list| (list.repositories.len(), list.installations.len()))
            .unwrap_or((0, 0))
    }

    pub async fn list_repositories(&self) -> Result<GitHubRepositoryList, GitHubError> {
        self.ensure_storage_loaded().await;

        let mut next = Some(api_paginated_url("/user/installations")?);
        let mut api_installations = Vec::new();
        let mut seen_installations = HashSet::new();
        let mut page_count = 0usize;

        while let Some(url) = next {
            page_count += 1;
            if page_count > MAX_PAGES {
                return Err(invalid_response(
                    "GitHub installation pagination did not terminate.",
                ));
            }
            let page = self.authorized_get_json::<ApiInstallationPage>(url).await?;
            for installation in page.value.installations {
                if seen_installations.insert(installation.id) {
                    api_installations.push(installation);
                }
            }
            next = page.next;
        }

        let mut installations = Vec::with_capacity(api_installations.len());
        let mut repositories = Vec::new();
        let mut seen_repositories = HashSet::new();

        for installation in api_installations {
            let installation_id = installation.id;
            let account_login = installation.account.login.clone();
            installations.push(GitHubInstallation {
                id: installation.id,
                account_id: installation.account.id,
                account_login: account_login.clone(),
                account_type: installation.account.kind,
                avatar_url: installation.account.avatar_url,
                repository_selection: installation.repository_selection,
            });

            let path = format!("/user/installations/{installation_id}/repositories");
            let mut repository_next = Some(api_paginated_url(&path)?);
            let mut repository_page_count = 0usize;
            while let Some(url) = repository_next {
                repository_page_count += 1;
                if repository_page_count > MAX_PAGES {
                    return Err(invalid_response(
                        "GitHub repository pagination did not terminate.",
                    ));
                }
                let page = self.authorized_get_json::<ApiRepositoryPage>(url).await?;
                for repository in page.value.repositories {
                    if seen_repositories.insert(repository.id) {
                        repositories.push(repository.into_public(installation_id, &account_login));
                    }
                }
                repository_next = page.next;
            }
        }

        installations.sort_by(|left, right| {
            left.account_login
                .to_lowercase()
                .cmp(&right.account_login.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });
        repositories.sort_by(|left, right| {
            left.full_name
                .to_lowercase()
                .cmp(&right.full_name.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });

        // The real listing also refreshes the counts cache: whoever wants only
        // the two numbers does not have to paginate again.
        let counts = (repositories.len(), installations.len());
        if let Ok(now) = unix_seconds() {
            self.state.lock().await.repository_counts = Some((counts.0, counts.1, now));
        }

        Ok(GitHubRepositoryList {
            installations,
            repositories,
        })
    }

    /// Creates a repository owned by the authenticated GitHub user.
    pub async fn create_repository(
        &self,
        request: GitHubCreateRepositoryRequest,
    ) -> Result<GitHubCreatedRepository, GitHubError> {
        let body = create_repository_body(request)?;
        let url = api_url("/user/repos")?;

        for attempt in 0..2 {
            let token = self
                .ensure_valid_token(attempt == 1)
                .await?
                .ok_or_else(GitHubError::authentication_required)?;

            let response = self
                .http()?
                .post(url.clone())
                .header(HeaderName::from_static(API_VERSION_HEADER), API_VERSION)
                .bearer_auth(&token.access_token)
                .json(&body)
                .send()
                .await
                .map_err(network_error)?;

            if response.status() == StatusCode::UNAUTHORIZED {
                if attempt == 0 {
                    continue;
                }
                self.invalidate_session().await;
                return Err(GitHubError::new(
                    GitHubErrorCode::AuthenticationExpired,
                    "The GitHub session is no longer valid.",
                    false,
                ));
            }

            if !response.status().is_success() {
                return Err(create_repository_error_response(response).await);
            }

            let repository = response.json::<ApiCreatedRepository>().await.map_err(|_| {
                invalid_response("GitHub created the repository but returned invalid data.")
            })?;
            return Ok(repository.into());
        }

        Err(GitHubError::authentication_required())
    }

    /// Deletes one repository after the caller has revalidated its current server-side access.
    pub async fn delete_repository(
        &self,
        request: GitHubDeleteRepositoryRequest,
    ) -> Result<GitHubDeleteRepositoryResult, GitHubError> {
        validate_delete_repository_request(&request)?;
        let url = delete_repository_url(&request.repository_full_name)?;

        let token = self
            .ensure_valid_token(false)
            .await?
            .ok_or_else(GitHubError::authentication_required)?;
        let http_request = build_delete_repository_request(self.http()?, url, &token.access_token)?;
        let response = self
            .http()?
            .execute(http_request)
            .await
            .map_err(network_error)?;

        if response.status() == StatusCode::UNAUTHORIZED {
            self.invalidate_session().await;
            return Err(
                delete_repository_status_error(response.status(), response.headers())
                    .unwrap_or_else(GitHubError::authentication_required),
            );
        }
        if delete_repository_succeeded(response.status()) {
            return Ok(GitHubDeleteRepositoryResult {
                repository_id: request.repository_id,
                repository_full_name: request.repository_full_name,
                deleted: true,
            });
        }
        if response.status().is_success() {
            return Err(invalid_response(
                "GitHub returned an unexpected status while deleting the repository.",
            ));
        }
        Err(delete_repository_error_response(response).await)
    }

    pub async fn logout(&self) -> Result<GitHubLogoutResult, GitHubError> {
        self.ensure_storage_loaded().await;
        let had_persisted_credential = {
            let mut state = self.state.lock().await;
            let persisted = state
                .credentials
                .as_ref()
                .is_some_and(|credentials| credentials.persisted);
            state.pending_login = None;
            state.credentials = None;
            state.storage_loaded = true;
            // The counts belong to the account that is leaving: without this,
            // signing in with another account within five minutes shows the
            // previous one's numbers. And it is not cosmetic —
            // `installationCount` decides whether to offer linking or the
            // installation guide.
            state.repository_counts = None;
            persisted
        };

        let persisted_credential_removed = delete_keyring_bundle().await;
        if had_persisted_credential && !persisted_credential_removed {
            return Err(GitHubError::new(
                GitHubErrorCode::StorageUnavailable,
                "The local session was closed, but the GitHub credentials could not be removed from the system keyring.",
                true,
            ));
        }

        Ok(GitHubLogoutResult {
            logged_out: true,
            persisted_credential_removed,
        })
    }

    /// Internal Git bridge. Do not register this method as a Tauri command.
    /// The token is handed only to the in-process, one-shot askpass broker.
    pub(crate) async fn token_for_git(&self) -> Result<Option<GitAccessToken>, GitHubError> {
        let token = self.ensure_valid_token(false).await?;
        token
            .map(|token| GitAccessToken::new(token.access_token))
            .transpose()
    }

    async fn ensure_storage_loaded(&self) {
        let mut state = self.state.lock().await;
        if state.storage_loaded {
            return;
        }

        let loaded = tokio::task::spawn_blocking(load_keyring_bundle_sync)
            .await
            .ok()
            .and_then(Result::ok)
            .flatten();
        state.storage_loaded = true;
        if state.credentials.is_none() {
            state.credentials = loaded.map(|tokens| Credentials {
                tokens,
                persisted: true,
            });
        }
    }

    async fn ensure_valid_token(
        &self,
        force_refresh: bool,
    ) -> Result<Option<TokenLease>, GitHubError> {
        self.ensure_storage_loaded().await;
        let now = unix_seconds()?;
        let mut state = self.state.lock().await;

        let Some(credentials) = state.credentials.as_ref() else {
            return Ok(None);
        };

        let refresh_needed = force_refresh || should_refresh(&credentials.tokens, now);
        if !refresh_needed {
            if token_is_expired(credentials.tokens.access_expires_at, now) {
                state.credentials = None;
                drop(state);
                let _ = delete_keyring_bundle().await;
                return Ok(None);
            }
            return Ok(Some(TokenLease::from(credentials)));
        }

        let refresh_token = credentials
            .tokens
            .refresh_token
            .as_ref()
            .filter(|token| !token.is_empty())
            .cloned();
        let refresh_expired = token_is_expired(credentials.tokens.refresh_expires_at, now);
        let Some(refresh_token) = refresh_token.filter(|_| !refresh_expired) else {
            state.credentials = None;
            drop(state);
            let _ = delete_keyring_bundle().await;
            return Ok(None);
        };

        let refreshed = match self.refresh_tokens(&refresh_token, now).await {
            Ok(tokens) => tokens,
            Err(error)
                if matches!(
                    error.code,
                    GitHubErrorCode::AuthenticationExpired
                        | GitHubErrorCode::AuthenticationRequired
                ) =>
            {
                state.credentials = None;
                drop(state);
                let _ = delete_keyring_bundle().await;
                return Ok(None);
            }
            Err(error) => return Err(error),
        };

        // Refresh tokens rotate. The new pair replaces the old pair as one unit.
        let persisted = persist_keyring_bundle(refreshed.clone()).await;
        if !persisted {
            let _ = delete_keyring_bundle().await;
        }
        state.credentials = Some(Credentials {
            tokens: refreshed,
            persisted,
        });
        Ok(state.credentials.as_ref().map(TokenLease::from))
    }

    async fn refresh_tokens(
        &self,
        refresh_token: &str,
        now: u64,
    ) -> Result<TokenBundle, GitHubError> {
        let response = self
            .http()?
            .post(self.oauth_token_url())
            .header(ACCEPT, "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("grant_type", REFRESH_GRANT_TYPE),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let envelope = response.json::<OAuthEnvelope>().await.map_err(|_| {
            invalid_response("GitHub did not return a valid OAuth refresh response.")
        })?;

        if let Some(error) = envelope.error.as_deref() {
            if matches!(
                error,
                "bad_refresh_token" | "expired_token" | "token_expired" | "access_denied"
            ) {
                return Err(GitHubError::new(
                    GitHubErrorCode::AuthenticationExpired,
                    "The GitHub session has expired. Sign in again.",
                    false,
                ));
            }
            return Err(oauth_error(
                Some(error),
                envelope.error_description.as_deref(),
                status,
            ));
        }
        if !status.is_success() {
            return Err(http_status_error(
                status,
                None,
                "The GitHub session refresh failed.",
            ));
        }

        token_bundle_from_oauth(envelope, now)
    }

    async fn authorized_get_json<T: DeserializeOwned>(
        &self,
        url: Url,
    ) -> Result<ResponsePage<T>, GitHubError> {
        ensure_allowed_api_url(&url)?;

        for attempt in 0..2 {
            let force_refresh = attempt == 1;
            let token = self
                .ensure_valid_token(force_refresh)
                .await?
                .ok_or_else(GitHubError::authentication_required)?;

            let response = self
                .http()?
                .get(url.clone())
                .header(HeaderName::from_static(API_VERSION_HEADER), API_VERSION)
                .bearer_auth(&token.access_token)
                .send()
                .await
                .map_err(network_error)?;

            if response.status() == StatusCode::UNAUTHORIZED {
                if attempt == 0 {
                    continue;
                }
                self.invalidate_session().await;
                return Err(GitHubError::new(
                    GitHubErrorCode::AuthenticationExpired,
                    "The GitHub session is no longer valid.",
                    false,
                ));
            }

            if !response.status().is_success() {
                return Err(rest_error_response(response).await);
            }

            let next = parse_next_link(response.headers())?;
            let value = response
                .json::<T>()
                .await
                .map_err(|_| invalid_response("GitHub returned invalid REST data."))?;
            return Ok(ResponsePage { value, next });
        }

        Err(GitHubError::authentication_required())
    }

    async fn invalidate_session(&self) {
        {
            let mut state = self.state.lock().await;
            state.credentials = None;
            state.storage_loaded = true;
            state.repository_counts = None;
        }
        let _ = delete_keyring_bundle().await;
    }
}

impl Default for GitHubClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Static HTTP configuration of the GitHub client. Kept apart from `new`
/// ora viene eseguita pigramente, alla prima richiesta.
fn build_http_client() -> Result<Client, GitHubError> {
    let mut default_headers = HeaderMap::new();
    default_headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );

    Client::builder()
        .user_agent(USER_AGENT_VALUE)
        .default_headers(default_headers)
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECONDS))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| {
            GitHubError::new(
                GitHubErrorCode::Internal,
                "The GitHub client could not be initialized.",
                false,
            )
        })
}

#[derive(Default)]
struct ClientState {
    pending_login: Option<PendingLogin>,
    credentials: Option<Credentials>,
    storage_loaded: bool,
    next_flow_id: u64,
    /// Last known repository and installation counts, with the moment they were
    /// computed.
    ///
    /// They only serve to show two numbers in the interface, but obtaining them
    /// used to paginate the entire repository list of every installation — on
    /// every start of the app, on every completed sign-in, and after every
    /// deletion or link. On an account with many installations that was a rate
    /// limit risk at every launch, for two counters.
    repository_counts: Option<(usize, usize, u64)>,
}

struct PendingLogin {
    flow_id: u64,
    device_code: String,
    expires_at: u64,
    interval_seconds: u64,
    next_poll_at: u64,
}

struct Credentials {
    tokens: TokenBundle,
    persisted: bool,
}

struct TokenLease {
    access_token: String,
}

impl From<&Credentials> for TokenLease {
    fn from(credentials: &Credentials) -> Self {
        Self {
            access_token: credentials.tokens.access_token.clone(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct TokenBundle {
    version: u8,
    access_token: String,
    access_expires_at: Option<u64>,
    refresh_token: Option<String>,
    refresh_expires_at: Option<u64>,
}

impl TokenBundle {
    fn is_valid_shape(&self) -> bool {
        self.version == TOKEN_STORAGE_VERSION
            && !self.access_token.trim().is_empty()
            && self.access_token.len() <= 8_192
            && !self
                .access_token
                .chars()
                .any(|character| character.is_control() || character.is_whitespace())
            && self.refresh_token.as_ref().is_none_or(|token| {
                !token.trim().is_empty()
                    && token.len() <= 8_192
                    && !token
                        .chars()
                        .any(|character| character.is_control() || character.is_whitespace())
            })
    }
}

struct ResponsePage<T> {
    value: T,
    next: Option<Url>,
}

#[derive(Deserialize)]
struct DeviceCodeEnvelope {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct OAuthEnvelope {
    access_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    refresh_token_expires_in: Option<u64>,
    interval: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Serialize)]
struct CreateRepositoryBody {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    private: bool,
    auto_init: bool,
}

#[derive(Deserialize)]
struct ApiCreatedRepository {
    id: u64,
    name: String,
    full_name: String,
    private: bool,
    html_url: String,
    clone_url: String,
    ssh_url: String,
    default_branch: Option<String>,
}

impl From<ApiCreatedRepository> for GitHubCreatedRepository {
    fn from(repository: ApiCreatedRepository) -> Self {
        Self {
            id: repository.id,
            name: repository.name,
            full_name: repository.full_name,
            private: repository.private,
            html_url: repository.html_url,
            clone_url: repository.clone_url,
            ssh_url: repository.ssh_url,
            default_branch: repository.default_branch,
        }
    }
}

#[derive(Deserialize)]
struct ApiErrorEnvelope {
    message: Option<String>,
}

#[derive(Deserialize)]
struct ApiUser {
    id: u64,
    login: String,
    name: Option<String>,
    avatar_url: String,
    html_url: String,
    bio: Option<String>,
    #[serde(default)]
    followers: u64,
    #[serde(default)]
    following: u64,
    #[serde(default)]
    public_repos: u64,
    total_private_repos: Option<u64>,
}

impl From<ApiUser> for GitHubUser {
    fn from(user: ApiUser) -> Self {
        Self {
            id: user.id,
            login: user.login,
            name: user.name,
            avatar_url: user.avatar_url,
            html_url: user.html_url,
            bio: user.bio,
            followers: user.followers,
            following: user.following,
            public_repos: user.public_repos,
            total_private_repos: user.total_private_repos,
        }
    }
}

#[derive(Deserialize)]
struct ApiInstallationPage {
    installations: Vec<ApiInstallation>,
}

#[derive(Deserialize)]
struct ApiInstallation {
    id: u64,
    account: ApiAccount,
    repository_selection: String,
}

#[derive(Deserialize)]
struct ApiAccount {
    id: u64,
    login: String,
    #[serde(rename = "type")]
    kind: String,
    avatar_url: String,
}

#[derive(Deserialize)]
struct ApiRepositoryPage {
    repositories: Vec<ApiRepository>,
}

#[derive(Deserialize)]
struct ApiRepository {
    id: u64,
    name: String,
    full_name: String,
    owner: Option<ApiRepositoryOwner>,
    private: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    disabled: bool,
    default_branch: Option<String>,
    html_url: String,
    clone_url: String,
    ssh_url: String,
    permissions: Option<ApiRepositoryPermissions>,
}

impl ApiRepository {
    fn into_public(
        self,
        installation_id: u64,
        installation_account_login: &str,
    ) -> GitHubRepository {
        let can_push = self
            .permissions
            .as_ref()
            .is_some_and(|permissions| permissions.push);
        GitHubRepository {
            id: self.id,
            installation_id,
            name: self.name,
            full_name: self.full_name,
            owner: self
                .owner
                .map(|owner| owner.login)
                .unwrap_or_else(|| installation_account_login.to_string()),
            private: self.private,
            archived: self.archived,
            disabled: self.disabled,
            default_branch: self.default_branch,
            html_url: self.html_url,
            clone_url: self.clone_url,
            ssh_url: self.ssh_url,
            can_push,
            permissions: self.permissions.map(Into::into),
        }
    }
}

#[derive(Deserialize)]
struct ApiRepositoryOwner {
    login: String,
}

#[derive(Deserialize)]
struct ApiRepositoryPermissions {
    #[serde(default)]
    admin: bool,
    #[serde(default)]
    maintain: bool,
    #[serde(default)]
    push: bool,
    #[serde(default)]
    triage: bool,
    #[serde(default)]
    pull: bool,
}

impl From<ApiRepositoryPermissions> for GitHubRepositoryPermissions {
    fn from(permissions: ApiRepositoryPermissions) -> Self {
        Self {
            admin: permissions.admin,
            maintain: permissions.maintain,
            push: permissions.push,
            triage: permissions.triage,
            pull: permissions.pull,
        }
    }
}

fn create_repository_body(
    request: GitHubCreateRepositoryRequest,
) -> Result<CreateRepositoryBody, GitHubError> {
    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err(GitHubError::new(
            GitHubErrorCode::InvalidRequest,
            "Enter a name for the GitHub repository.",
            false,
        ));
    }
    if name.chars().count() > MAX_REPOSITORY_NAME_CHARS {
        return Err(GitHubError::new(
            GitHubErrorCode::InvalidRequest,
            format!("The repository name cannot exceed {MAX_REPOSITORY_NAME_CHARS} characters."),
            false,
        ));
    }

    let description = request
        .description
        .map(|description| description.trim().to_string())
        .filter(|description| !description.is_empty());
    if description
        .as_ref()
        .is_some_and(|description| description.chars().count() > MAX_REPOSITORY_DESCRIPTION_CHARS)
    {
        return Err(GitHubError::new(
            GitHubErrorCode::InvalidRequest,
            format!("The description cannot exceed {MAX_REPOSITORY_DESCRIPTION_CHARS} characters."),
            false,
        ));
    }

    Ok(CreateRepositoryBody {
        name,
        description,
        private: request.private,
        auto_init: request.auto_init,
    })
}

pub(crate) fn validate_delete_repository_request(
    request: &GitHubDeleteRepositoryRequest,
) -> Result<(), GitHubError> {
    if request.confirmation != request.repository_full_name {
        return Err(GitHubError::new(
            GitHubErrorCode::InvalidRequest,
            "The confirmation does not exactly match the repository full name.",
            false,
        ));
    }
    if request.repository_id == 0 {
        return Err(GitHubError::new(
            GitHubErrorCode::InvalidRequest,
            "The GitHub repository ID is invalid.",
            false,
        ));
    }
    parse_repository_full_name(&request.repository_full_name)?;
    Ok(())
}

pub(crate) fn ensure_repository_can_be_deleted(
    repositories: &[GitHubRepository],
    request: &GitHubDeleteRepositoryRequest,
) -> Result<(), GitHubError> {
    validate_delete_repository_request(request)?;
    let repository = repositories
        .iter()
        .find(|repository| {
            repository.id == request.repository_id
                && repository.full_name == request.repository_full_name
        })
        .ok_or_else(|| {
            GitHubError::new(
                GitHubErrorCode::InvalidRequest,
                "The selected repository no longer matches the data available from GitHub.",
                false,
            )
        })?;
    if !repository
        .permissions
        .as_ref()
        .is_some_and(|permissions| permissions.admin)
    {
        return Err(GitHubError::new(
            GitHubErrorCode::Forbidden,
            "Deleting this GitHub repository requires the Administration permission.",
            false,
        ));
    }
    Ok(())
}

fn parse_repository_full_name(value: &str) -> Result<(&str, &str), GitHubError> {
    if value.is_empty()
        || value != value.trim()
        || value.chars().count() > MAX_REPOSITORY_FULL_NAME_CHARS
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(GitHubError::new(
            GitHubErrorCode::InvalidRequest,
            "The GitHub repository full name is invalid.",
            false,
        ));
    }
    let mut segments = value.split('/');
    let owner = segments.next().unwrap_or_default();
    let repository = segments.next().unwrap_or_default();
    if owner.is_empty()
        || repository.is_empty()
        || segments.next().is_some()
        || matches!(owner, "." | "..")
        || matches!(repository, "." | "..")
    {
        return Err(GitHubError::new(
            GitHubErrorCode::InvalidRequest,
            "The GitHub repository full name must use the owner/repository format.",
            false,
        ));
    }
    Ok((owner, repository))
}

fn delete_repository_url(repository_full_name: &str) -> Result<Url, GitHubError> {
    let (owner, repository) = parse_repository_full_name(repository_full_name)?;
    let mut url = api_url("/repos/")?;
    url.path_segments_mut()
        .map_err(|_| invalid_response("The repository API URL could not be built."))?
        .pop_if_empty()
        .push(owner)
        .push(repository);
    ensure_allowed_api_url(&url)?;
    Ok(url)
}

fn build_delete_repository_request(
    client: &Client,
    url: Url,
    access_token: &str,
) -> Result<reqwest::Request, GitHubError> {
    ensure_allowed_api_url(&url)?;
    client
        .delete(url)
        .header(HeaderName::from_static(API_VERSION_HEADER), API_VERSION)
        .bearer_auth(access_token)
        .build()
        .map_err(|_| {
            GitHubError::new(
                GitHubErrorCode::Internal,
                "The GitHub repository deletion request could not be prepared.",
                false,
            )
        })
}

fn required_nonempty(value: Option<String>, field: &str) -> Result<String, GitHubError> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid_response(&format!("The GitHub response does not contain {field}.")))
}

fn token_bundle_from_oauth(envelope: OAuthEnvelope, now: u64) -> Result<TokenBundle, GitHubError> {
    let access_token = required_nonempty(envelope.access_token, "access_token")?;
    let token_type = required_nonempty(envelope.token_type, "token_type")?;
    if !token_type.eq_ignore_ascii_case("bearer") {
        return Err(invalid_response(
            "GitHub returned an unsupported token type.",
        ));
    }

    let access_expires_at = envelope
        .expires_in
        .map(|seconds| now.saturating_add(seconds));
    let refresh_token = envelope
        .refresh_token
        .filter(|token| !token.trim().is_empty());
    let refresh_expires_at = match (&refresh_token, envelope.refresh_token_expires_in) {
        (Some(_), Some(seconds)) => Some(now.saturating_add(seconds)),
        _ => None,
    };

    Ok(TokenBundle {
        version: TOKEN_STORAGE_VERSION,
        access_token,
        access_expires_at,
        refresh_token,
        refresh_expires_at,
    })
}

fn should_refresh(tokens: &TokenBundle, now: u64) -> bool {
    tokens
        .access_expires_at
        .is_some_and(|expires_at| expires_at <= now.saturating_add(REFRESH_SKEW_SECONDS))
}

fn token_is_expired(expires_at: Option<u64>, now: u64) -> bool {
    expires_at.is_some_and(|expires_at| expires_at <= now)
}

fn unix_seconds() -> Result<u64, GitHubError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| {
            GitHubError::new(
                GitHubErrorCode::Internal,
                "The system clock is invalid.",
                false,
            )
        })
}

fn seconds_to_millis(seconds: u64) -> u64 {
    seconds.saturating_mul(1_000)
}

fn validate_verification_uri(value: &str) -> Result<String, GitHubError> {
    let url = Url::parse(value)
        .map_err(|_| invalid_response("GitHub returned an invalid verification URL."))?;
    let valid = url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none();
    if !valid {
        return Err(invalid_response(
            "GitHub returned an untrusted verification URL.",
        ));
    }
    Ok(url.to_string())
}

fn api_url(path: &str) -> Result<Url, GitHubError> {
    let url = Url::parse(&format!("{API_BASE_URL}{path}")).map_err(|_| {
        GitHubError::new(
            GitHubErrorCode::Internal,
            "The GitHub API URL could not be built.",
            false,
        )
    })?;
    ensure_allowed_api_url(&url)?;
    Ok(url)
}

fn api_paginated_url(path: &str) -> Result<Url, GitHubError> {
    let mut url = api_url(path)?;
    url.query_pairs_mut()
        .append_pair("per_page", "100")
        .append_pair("page", "1");
    Ok(url)
}

fn ensure_allowed_api_url(url: &Url) -> Result<(), GitHubError> {
    let allowed = url.scheme() == "https"
        && url.host_str() == Some("api.github.com")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none();
    if allowed {
        Ok(())
    } else {
        Err(invalid_response(
            "GitHub returned an untrusted pagination link.",
        ))
    }
}

fn parse_next_link(headers: &HeaderMap) -> Result<Option<Url>, GitHubError> {
    for header in headers.get_all(LINK).iter() {
        let value = header
            .to_str()
            .map_err(|_| invalid_response("The GitHub pagination header is invalid."))?;
        for item in value.split(',') {
            let mut parts = item.trim().split(';');
            let Some(target) = parts.next() else {
                continue;
            };
            let is_next = parts.any(|part| {
                let normalized = part.trim().replace(' ', "");
                normalized == "rel=\"next\"" || normalized == "rel=next"
            });
            if !is_next {
                continue;
            }

            let raw_url = target
                .trim()
                .strip_prefix('<')
                .and_then(|value| value.strip_suffix('>'))
                .ok_or_else(|| invalid_response("The link to the next GitHub page is invalid."))?;
            let url = Url::parse(raw_url)
                .map_err(|_| invalid_response("The link to the next GitHub page is invalid."))?;
            ensure_allowed_api_url(&url)?;
            return Ok(Some(url));
        }
    }
    Ok(None)
}

fn response_is_rate_limited(status: StatusCode, headers: &HeaderMap) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN
            && (headers.contains_key(RETRY_AFTER)
                || headers
                    .get("x-ratelimit-remaining")
                    .and_then(|value| value.to_str().ok())
                    == Some("0")))
}

async fn create_repository_error_response(response: Response) -> GitHubError {
    if response.status() == StatusCode::FORBIDDEN
        && !response_is_rate_limited(response.status(), response.headers())
    {
        return GitHubError::new(
            GitHubErrorCode::Forbidden,
            "GitHub denied repository creation. Verify that the GitHub App has Repository permissions > Administration: Read and write.",
            false,
        );
    }

    rest_error_response(response).await
}

fn delete_repository_status_error(status: StatusCode, headers: &HeaderMap) -> Option<GitHubError> {
    if response_is_rate_limited(status, headers) {
        return Some(
            GitHubError::new(
                GitHubErrorCode::RateLimited,
                "The GitHub rate limit was reached. Try again later.",
                true,
            )
            .with_retry_after(parse_retry_after(headers)),
        );
    }
    if status == StatusCode::UNAUTHORIZED {
        return Some(GitHubError::new(
            GitHubErrorCode::AuthenticationExpired,
            "The GitHub session is no longer valid. Sign in again and repeat the confirmation.",
            false,
        ));
    }
    (status == StatusCode::FORBIDDEN).then(|| {
        GitHubError::new(
            GitHubErrorCode::Forbidden,
            "GitHub denied repository deletion. Verify Repository permissions > Administration: Read and write and the organization policy.",
            false,
        )
    })
}

fn delete_repository_succeeded(status: StatusCode) -> bool {
    status == StatusCode::NO_CONTENT
}

async fn delete_repository_error_response(response: Response) -> GitHubError {
    if let Some(error) = delete_repository_status_error(response.status(), response.headers()) {
        return error;
    }
    rest_error_response(response).await
}

async fn rest_error_response(response: Response) -> GitHubError {
    let status = response.status();
    let retry_after = parse_retry_after(response.headers());
    let rate_limited = response_is_rate_limited(status, response.headers());
    let message = response
        .json::<ApiErrorEnvelope>()
        .await
        .ok()
        .and_then(|error| error.message);
    if rate_limited {
        return GitHubError::new(
            GitHubErrorCode::RateLimited,
            "The GitHub rate limit was reached. Try again later.",
            true,
        )
        .with_retry_after(retry_after);
    }
    http_status_error(
        status,
        retry_after,
        message
            .as_deref()
            .unwrap_or("The GitHub API request failed."),
    )
}

fn parse_retry_after(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
}

fn http_status_error(status: StatusCode, retry_after: Option<u64>, message: &str) -> GitHubError {
    match status {
        StatusCode::UNAUTHORIZED => GitHubError::new(
            GitHubErrorCode::AuthenticationExpired,
            "The GitHub session is no longer valid.",
            false,
        ),
        StatusCode::FORBIDDEN => GitHubError::new(GitHubErrorCode::Forbidden, message, false),
        StatusCode::NOT_FOUND => GitHubError::new(
            GitHubErrorCode::NotFound,
            "The requested GitHub resource is unavailable.",
            false,
        ),
        StatusCode::TOO_MANY_REQUESTS => GitHubError::new(
            GitHubErrorCode::RateLimited,
            "The GitHub rate limit was reached. Try again later.",
            true,
        )
        .with_retry_after(retry_after),
        status if status.is_server_error() => GitHubError::new(
            GitHubErrorCode::Network,
            "GitHub is temporarily unavailable.",
            true,
        ),
        _ => GitHubError::new(GitHubErrorCode::InvalidResponse, message, false),
    }
}

fn oauth_error(code: Option<&str>, _description: Option<&str>, status: StatusCode) -> GitHubError {
    let fallback = match code {
        Some("device_flow_disabled") => "Device Flow is not enabled for this GitHub App.",
        Some("incorrect_client_credentials") => "The GitHub App Client ID is invalid.",
        Some("unsupported_grant_type") => "The requested OAuth grant type is unsupported.",
        _ => "GitHub authentication failed.",
    };
    let error_code = match code {
        Some("access_denied") => GitHubErrorCode::AuthorizationDenied,
        Some("expired_token" | "token_expired" | "bad_refresh_token") => {
            GitHubErrorCode::AuthenticationExpired
        }
        _ if status.is_server_error() => GitHubErrorCode::Network,
        _ => GitHubErrorCode::InvalidDeviceFlow,
    };
    // OAuth descriptions are deliberately not surfaced: a provider error could echo
    // the device code or another credential. Known codes are mapped to safe text.
    GitHubError::new(error_code, fallback, status.is_server_error())
}

fn invalid_response(message: &str) -> GitHubError {
    GitHubError::new(GitHubErrorCode::InvalidResponse, message, false)
}

fn network_error(error: reqwest::Error) -> GitHubError {
    if error.is_timeout() {
        GitHubError::new(
            GitHubErrorCode::Timeout,
            "GitHub did not respond before the timeout.",
            true,
        )
    } else {
        GitHubError::new(
            GitHubErrorCode::Network,
            "GitHub could not be reached.",
            true,
        )
    }
}

fn sanitize_error_message(message: &str) -> String {
    const SECRET_PREFIXES: &[&str] = &["github_pat_", "ghu_", "ghr_", "gho_", "ghp_", "ghs_"];

    let mut sanitized = message.to_string();
    for prefix in SECRET_PREFIXES {
        sanitized = redact_prefixed_secret(&sanitized, prefix);
    }
    sanitized.chars().take(MAX_ERROR_MESSAGE_CHARS).collect()
}

fn redact_prefixed_secret(value: &str, prefix: &str) -> String {
    let mut remaining = value;
    let mut result = String::with_capacity(value.len());
    while let Some(index) = remaining.find(prefix) {
        result.push_str(&remaining[..index]);
        result.push_str("[REDACTED]");
        let secret = &remaining[index + prefix.len()..];
        let consumed = secret
            .char_indices()
            .take_while(|(_, character)| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
            })
            .map(|(index, character)| index + character.len_utf8())
            .last()
            .unwrap_or(0);
        remaining = &secret[consumed..];
    }
    result.push_str(remaining);
    result
}

fn load_keyring_bundle_sync() -> Result<Option<TokenBundle>, ()> {
    match read_keyring_service(KEYRING_SERVICE)? {
        Some(bundle) => Ok(Some(bundle)),
        // Nothing under the current name: an install from before the rename
        // still has its session under the old one. Read, never written — the
        // next `persist_keyring_bundle` stores it under the new service.
        None => read_keyring_service(LEGACY_KEYRING_SERVICE),
    }
}

fn read_keyring_service(service: &str) -> Result<Option<TokenBundle>, ()> {
    let entry = KeyringEntry::new(service, KEYRING_ACCOUNT).map_err(|_| ())?;
    let payload = match entry.get_password() {
        Ok(payload) => payload,
        Err(KeyringError::NoEntry) => return Ok(None),
        Err(_) => return Err(()),
    };
    let bundle = serde_json::from_str::<TokenBundle>(&payload).map_err(|_| ())?;
    if bundle.is_valid_shape() {
        Ok(Some(bundle))
    } else {
        Err(())
    }
}

fn persist_keyring_bundle_sync(tokens: &TokenBundle) -> bool {
    let Ok(payload) = serde_json::to_string(tokens) else {
        return false;
    };
    KeyringEntry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .and_then(|entry| entry.set_password(&payload))
        .is_ok()
}

fn delete_keyring_bundle_sync() -> bool {
    let Ok(entry) = KeyringEntry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) else {
        return false;
    };
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => true,
        Err(_) => false,
    }
}

async fn persist_keyring_bundle(tokens: TokenBundle) -> bool {
    tokio::task::spawn_blocking(move || persist_keyring_bundle_sync(&tokens))
        .await
        .unwrap_or(false)
}

async fn delete_keyring_bundle() -> bool {
    tokio::task::spawn_blocking(delete_keyring_bundle_sync)
        .await
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_agent_uses_the_current_product_name() {
        assert_eq!(
            USER_AGENT_VALUE,
            concat!("RubyRepo/", env!("CARGO_PKG_VERSION"))
        );
    }

    fn expiring_tokens(expires_at: u64) -> TokenBundle {
        TokenBundle {
            version: TOKEN_STORAGE_VERSION,
            access_token: "not-a-real-access-token".to_string(),
            access_expires_at: Some(expires_at),
            refresh_token: Some("not-a-real-refresh-token".to_string()),
            refresh_expires_at: Some(expires_at + 10_000),
        }
    }

    fn repository_with_admin(id: u64, full_name: &str, admin: bool) -> GitHubRepository {
        let (owner, name) = full_name.split_once('/').expect("fixture full name");
        GitHubRepository {
            id,
            installation_id: 10,
            name: name.to_string(),
            full_name: full_name.to_string(),
            owner: owner.to_string(),
            private: true,
            archived: false,
            disabled: false,
            default_branch: Some("main".to_string()),
            html_url: format!("https://github.com/{full_name}"),
            clone_url: format!("https://github.com/{full_name}.git"),
            ssh_url: format!("git@github.com:{full_name}.git"),
            can_push: admin,
            permissions: Some(GitHubRepositoryPermissions {
                admin,
                maintain: admin,
                push: admin,
                triage: false,
                pull: true,
            }),
        }
    }

    #[test]
    fn refreshes_inside_the_safety_window() {
        let now = 10_000;
        assert!(!should_refresh(
            &expiring_tokens(now + REFRESH_SKEW_SECONDS + 1),
            now
        ));
        assert!(should_refresh(
            &expiring_tokens(now + REFRESH_SKEW_SECONDS),
            now
        ));
    }

    #[test]
    fn expiration_boundary_is_inclusive() {
        assert!(!token_is_expired(Some(101), 100));
        assert!(token_is_expired(Some(100), 100));
        assert!(!token_is_expired(None, u64::MAX));
    }

    #[test]
    fn device_authorization_never_serializes_the_device_code() {
        let public = GitHubDeviceAuthorization {
            user_code: "ABCD-EFGH".to_string(),
            verification_uri: "https://github.com/login/device".to_string(),
            expires_at: 123_000,
            interval_seconds: 5,
        };
        let serialized = serde_json::to_string(&public).expect("serializable public response");
        assert!(serialized.contains("userCode"));
        assert!(!serialized.contains("deviceCode"));
        assert!(!serialized.contains("device_code"));
    }

    #[test]
    fn sanitizes_github_token_shapes() {
        let sanitized = sanitize_error_message(
            "bad ghu_access123 and ghr_refresh-456 plus github_pat_secret_789",
        );
        assert_eq!(sanitized, "bad [REDACTED] and [REDACTED] plus [REDACTED]");
    }

    #[test]
    fn git_access_token_is_redacted_and_rejects_control_or_whitespace() {
        let token = GitAccessToken::new("ghu_private_sentinel".to_string())
            .expect("construct valid internal token");
        let debug = format!("{token:?}");
        assert!(!debug.contains("ghu_private_sentinel"));
        assert!(debug.contains("REDACTED"));
        for invalid in ["", "ghu_bad token", "ghu_bad\ntoken", "ghu_bad\0token"] {
            assert!(GitAccessToken::new(invalid.to_string()).is_err());
        }
    }

    #[test]
    fn pagination_rejects_cross_origin_links() {
        let mut headers = HeaderMap::new();
        headers.insert(
            LINK,
            HeaderValue::from_static(
                "<https://attacker.invalid/user/installations?page=2>; rel=\"next\"",
            ),
        );
        let error = parse_next_link(&headers).expect_err("cross-origin link must fail");
        assert_eq!(error.code, GitHubErrorCode::InvalidResponse);
    }

    #[test]
    fn pagination_accepts_github_api_links() {
        let mut headers = HeaderMap::new();
        headers.insert(
            LINK,
            HeaderValue::from_static(
                "<https://api.github.com/user/installations?per_page=100&page=2>; rel=\"next\"",
            ),
        );
        let next = parse_next_link(&headers)
            .expect("valid header")
            .expect("next page");
        assert_eq!(next.host_str(), Some("api.github.com"));
        assert_eq!(
            next.query_pairs().find(|(key, _)| key == "page").unwrap().1,
            "2"
        );
    }

    #[test]
    fn create_repository_body_is_trimmed_and_contains_only_api_fields() {
        let request: GitHubCreateRepositoryRequest = serde_json::from_value(serde_json::json!({
            "name": "  example-repository  ",
            "description": "  An example  ",
            "private": true,
            "autoInit": false
        }))
        .expect("camelCase request");
        let body = create_repository_body(request).expect("valid request");
        let serialized = serde_json::to_value(body).expect("serializable API body");

        assert_eq!(
            serialized,
            serde_json::json!({
                "name": "example-repository",
                "description": "An example",
                "private": true,
                "auto_init": false
            })
        );
    }

    #[test]
    fn create_repository_omits_blank_description_and_rejects_invalid_lengths() {
        let body = create_repository_body(GitHubCreateRepositoryRequest {
            name: " repository ".to_string(),
            description: Some("   ".to_string()),
            private: false,
            auto_init: true,
        })
        .expect("blank descriptions are omitted");
        let serialized = serde_json::to_value(body).expect("serializable API body");
        assert!(serialized.get("description").is_none());

        let empty_name = create_repository_body(GitHubCreateRepositoryRequest {
            name: "   ".to_string(),
            description: None,
            private: false,
            auto_init: false,
        })
        .expect_err("blank name must fail");
        assert_eq!(empty_name.code, GitHubErrorCode::InvalidRequest);

        let long_name = create_repository_body(GitHubCreateRepositoryRequest {
            name: "x".repeat(MAX_REPOSITORY_NAME_CHARS + 1),
            description: None,
            private: false,
            auto_init: false,
        })
        .expect_err("long name must fail");
        assert_eq!(long_name.code, GitHubErrorCode::InvalidRequest);

        let long_description = create_repository_body(GitHubCreateRepositoryRequest {
            name: "repository".to_string(),
            description: Some("x".repeat(MAX_REPOSITORY_DESCRIPTION_CHARS + 1)),
            private: false,
            auto_init: false,
        })
        .expect_err("long description must fail");
        assert_eq!(long_description.code, GitHubErrorCode::InvalidRequest);
    }

    #[test]
    fn created_repository_uses_frontend_camel_case_without_credentials() {
        let repository = GitHubCreatedRepository {
            id: 42,
            name: "project".to_string(),
            full_name: "octocat/project".to_string(),
            private: true,
            html_url: "https://github.com/octocat/project".to_string(),
            clone_url: "https://github.com/octocat/project.git".to_string(),
            ssh_url: "git@github.com:octocat/project.git".to_string(),
            default_branch: Some("main".to_string()),
        };
        let serialized = serde_json::to_value(repository).expect("serializable response");

        assert_eq!(serialized["fullName"], "octocat/project");
        assert_eq!(serialized["defaultBranch"], "main");
        assert!(serialized.get("full_name").is_none());
        assert!(serialized.get("accessToken").is_none());
    }

    #[test]
    fn create_repository_endpoint_is_exact_and_rate_limits_take_precedence() {
        let url = api_url("/user/repos").expect("valid API URL");
        assert_eq!(url.as_str(), "https://api.github.com/user/repos");

        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_static("60"));
        assert!(response_is_rate_limited(StatusCode::FORBIDDEN, &headers));
        assert!(!response_is_rate_limited(
            StatusCode::FORBIDDEN,
            &HeaderMap::new()
        ));
    }

    #[test]
    fn delete_repository_contract_uses_camel_case_and_exact_confirmation() {
        let request: GitHubDeleteRepositoryRequest = serde_json::from_value(serde_json::json!({
            "repositoryId": 42,
            "repositoryFullName": "Example/Project",
            "confirmation": "Example/Project"
        }))
        .expect("deserialize camelCase delete request");
        assert_eq!(request.repository_id, 42);
        validate_delete_repository_request(&request).expect("exact confirmation is valid");

        let serialized = serde_json::to_value(GitHubDeleteRepositoryResult {
            repository_id: 42,
            repository_full_name: "Example/Project".to_string(),
            deleted: true,
        })
        .expect("serialize delete result");
        assert_eq!(serialized["repositoryId"], 42);
        assert_eq!(serialized["repositoryFullName"], "Example/Project");
        assert_eq!(serialized["deleted"], true);

        for confirmation in ["example/project", "Example/Project ", " Example/Project"] {
            let invalid = GitHubDeleteRepositoryRequest {
                repository_id: 42,
                repository_full_name: "Example/Project".to_string(),
                confirmation: confirmation.to_string(),
            };
            let error = validate_delete_repository_request(&invalid)
                .expect_err("confirmation must match byte-for-byte");
            assert_eq!(error.code, GitHubErrorCode::InvalidRequest);
        }
        let zero_id = GitHubDeleteRepositoryRequest {
            repository_id: 0,
            repository_full_name: "Example/Project".to_string(),
            confirmation: "Example/Project".to_string(),
        };
        assert_eq!(
            validate_delete_repository_request(&zero_id)
                .expect_err("zero repository id is invalid")
                .code,
            GitHubErrorCode::InvalidRequest
        );
    }

    #[test]
    fn delete_repository_request_is_exact_delete_without_body() {
        let url = delete_repository_url("Example/Project").expect("valid delete endpoint");
        assert_eq!(url.as_str(), "https://api.github.com/repos/Example/Project");
        let client = Client::builder().build().expect("build test HTTP client");
        let request = build_delete_repository_request(&client, url, "ghu_test_token")
            .expect("build delete request");
        assert_eq!(request.method(), reqwest::Method::DELETE);
        assert_eq!(
            request.url().as_str(),
            "https://api.github.com/repos/Example/Project"
        );
        assert!(request.body().is_none());
        assert_eq!(
            request
                .headers()
                .get(API_VERSION_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some(API_VERSION)
        );
        assert!(request
            .headers()
            .contains_key(reqwest::header::AUTHORIZATION));
    }

    #[test]
    fn delete_repository_requires_simultaneous_id_name_and_admin_match() {
        let request = GitHubDeleteRepositoryRequest {
            repository_id: 42,
            repository_full_name: "Example/Project".to_string(),
            confirmation: "Example/Project".to_string(),
        };
        ensure_repository_can_be_deleted(
            &[repository_with_admin(42, "Example/Project", true)],
            &request,
        )
        .expect("matching admin repository is deletable");

        for repositories in [
            vec![repository_with_admin(41, "Example/Project", true)],
            vec![repository_with_admin(42, "Example/Other", true)],
        ] {
            let error = ensure_repository_can_be_deleted(&repositories, &request)
                .expect_err("id and full name must match the same server entry");
            assert_eq!(error.code, GitHubErrorCode::InvalidRequest);
        }

        let error = ensure_repository_can_be_deleted(
            &[repository_with_admin(42, "Example/Project", false)],
            &request,
        )
        .expect_err("admin permission is mandatory");
        assert_eq!(error.code, GitHubErrorCode::Forbidden);

        let mut missing_permissions = repository_with_admin(42, "Example/Project", true);
        missing_permissions.permissions = None;
        assert_eq!(
            ensure_repository_can_be_deleted(&[missing_permissions], &request)
                .expect_err("missing permission data is not administrative access")
                .code,
            GitHubErrorCode::Forbidden
        );
    }

    #[test]
    fn delete_repository_accepts_only_204_and_maps_policy_or_rate_limit() {
        assert!(delete_repository_succeeded(StatusCode::NO_CONTENT));
        assert!(!delete_repository_succeeded(StatusCode::OK));
        assert!(!delete_repository_succeeded(StatusCode::ACCEPTED));

        let unauthorized =
            delete_repository_status_error(StatusCode::UNAUTHORIZED, &HeaderMap::new())
                .expect("401 ends the destructive operation without retry");
        assert_eq!(unauthorized.code, GitHubErrorCode::AuthenticationExpired);
        assert!(!unauthorized.retryable);
        assert!(unauthorized.message.contains("repeat the confirmation"));

        let forbidden = delete_repository_status_error(StatusCode::FORBIDDEN, &HeaderMap::new())
            .expect("403 has a specific deletion error");
        assert_eq!(forbidden.code, GitHubErrorCode::Forbidden);
        assert!(forbidden.message.contains("Administration"));
        assert!(forbidden.message.contains("policy"));

        let mut rate_headers = HeaderMap::new();
        rate_headers.insert("x-ratelimit-remaining", HeaderValue::from_static("0"));
        rate_headers.insert(RETRY_AFTER, HeaderValue::from_static("17"));
        let rate_limited = delete_repository_status_error(StatusCode::FORBIDDEN, &rate_headers)
            .expect("rate limit takes precedence over policy error");
        assert_eq!(rate_limited.code, GitHubErrorCode::RateLimited);
        assert_eq!(rate_limited.retry_after_seconds, Some(17));
        assert!(rate_limited.retryable);
        assert!(delete_repository_status_error(StatusCode::NOT_FOUND, &HeaderMap::new()).is_none());
    }

    mod http {
        use super::super::{GitHubClient, GitHubErrorCode, GitHubLoginPoll};
        use wiremock::matchers::{body_string_contains, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        /// Before these tests no check touched an HTTP request: the whole state
        /// machine of authentication — Device Flow, waiting, expiry — was
        /// covered only through its pure functions.
        ///
        /// The OAuth endpoints are redirected to the fake server through a seam
        /// available only under `cfg(test)`. The pinning of API calls to
        /// `api.github.com` stays intact: it is a defence against SSRF and is
        /// not touched for the convenience of testing.
        async fn server_with_device_code(body: &str) -> MockServer {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/login/device/code"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_raw(body.to_string(), "application/json"),
                )
                .mount(&server)
                .await;
            server
        }

        #[tokio::test]
        async fn begin_login_returns_the_code_the_user_must_type() {
            let server = server_with_device_code(
                r#"{"device_code":"segreto","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
            )
            .await;

            let client = GitHubClient::with_oauth_base(server.uri());
            let authorization = client.begin_login().await.expect("il flusso deve partire");

            assert_eq!(authorization.user_code, "ABCD-1234");
            assert_eq!(
                authorization.verification_uri,
                "https://github.com/login/device"
            );
            assert_eq!(authorization.interval_seconds, 5);
            assert!(authorization.expires_at > 0);
        }

        /// The device code is the secret that allows the sign-in to complete:
        /// it must appear in nothing the app can show or serialize.
        #[tokio::test]
        async fn the_device_code_never_leaves_the_backend() {
            let server = server_with_device_code(
                r#"{"device_code":"segreto-da-non-mostrare","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
            )
            .await;

            let client = GitHubClient::with_oauth_base(server.uri());
            let authorization = client.begin_login().await.expect("il flusso deve partire");
            let serialized = serde_json::to_string(&authorization).expect("serializzabile");

            assert!(
                !serialized.contains("segreto-da-non-mostrare"),
                "il device code non deve attraversare l'IPC: {serialized}"
            );
        }

        #[tokio::test]
        async fn a_server_error_becomes_a_typed_failure_not_a_panic() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/login/device/code"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = GitHubClient::with_oauth_base(server.uri());
            let error = client
                .begin_login()
                .await
                .expect_err("un 500 non deve passare per riuscita");
            assert!(!error.message.is_empty());
        }

        /// The interval GitHub states must be honoured without asking the
        /// server: asking sooner would trip the rate limit. With `interval` at
        /// five seconds the first call must come back pending **without** any
        /// request leaving.
        #[tokio::test]
        async fn the_polling_interval_is_honoured_without_hitting_the_server() {
            let server = server_with_device_code(
                r#"{"device_code":"segreto","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
            )
            .await;

            let client = GitHubClient::with_oauth_base(server.uri());
            client.begin_login().await.expect("il flusso deve partire");

            match client
                .poll_login()
                .await
                .expect("l'attesa non e' un errore")
            {
                GitHubLoginPoll::Pending {
                    retry_after_seconds,
                } => assert!(retry_after_seconds > 0),
                other => panic!("atteso Pending, ottenuto {other:?}"),
            }

            let requests = server
                .received_requests()
                .await
                .expect("richieste tracciate");
            assert_eq!(
                requests.len(),
                1,
                "solo la richiesta del device code: l'intervallo non e' ancora scaduto"
            );
        }

        /// The most frequent case of the Device Flow: the user has not
        /// confirmed yet. With `interval` at zero the request really goes out.
        #[tokio::test]
        async fn a_pending_authorization_asks_the_app_to_wait() {
            let server = server_with_device_code(
                r#"{"device_code":"segreto","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":0}"#,
            )
            .await;
            Mock::given(method("POST"))
                .and(path("/login/oauth/access_token"))
                .and(body_string_contains("device_code"))
                .respond_with(ResponseTemplate::new(200).set_body_raw(
                    r#"{"error":"authorization_pending"}"#.to_string(),
                    "application/json",
                ))
                .mount(&server)
                .await;

            let client = GitHubClient::with_oauth_base(server.uri());
            client.begin_login().await.expect("il flusso deve partire");
            // `begin_login` raises the interval to a minimum of one second:
            // without this wait the call would come back pending without asking
            // the server, and the test would pass for the wrong reason.
            std::thread::sleep(std::time::Duration::from_millis(1_100));

            match client
                .poll_login()
                .await
                .expect("l'attesa non e' un errore")
            {
                GitHubLoginPoll::Pending {
                    retry_after_seconds,
                } => assert!(retry_after_seconds > 0),
                other => panic!("atteso Pending, ottenuto {other:?}"),
            }

            let requests = server
                .received_requests()
                .await
                .expect("richieste tracciate");
            assert_eq!(requests.len(), 2, "il server deve essere stato interrogato");
        }

        /// An explicit refusal by the user must close the flow with a
        /// recognisable code, not with a generic error.
        #[tokio::test]
        async fn a_denied_authorization_is_reported_with_its_own_code() {
            let server = server_with_device_code(
                r#"{"device_code":"segreto","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":0}"#,
            )
            .await;
            Mock::given(method("POST"))
                .and(path("/login/oauth/access_token"))
                .respond_with(ResponseTemplate::new(200).set_body_raw(
                    r#"{"error":"access_denied"}"#.to_string(),
                    "application/json",
                ))
                .mount(&server)
                .await;

            let client = GitHubClient::with_oauth_base(server.uri());
            client.begin_login().await.expect("il flusso deve partire");
            std::thread::sleep(std::time::Duration::from_millis(1_100));

            let error = client
                .poll_login()
                .await
                .expect_err("un rifiuto deve essere un errore");
            assert!(matches!(error.code, GitHubErrorCode::AuthorizationDenied));
        }

        /// With no flow started there is nothing to poll: the command must not
        /// invent a request.
        #[tokio::test]
        async fn polling_without_a_pending_flow_is_refused() {
            let server = MockServer::start().await;
            let client = GitHubClient::with_oauth_base(server.uri());

            let error = client
                .poll_login()
                .await
                .expect_err("senza flusso pendente non si puo' interrogare");
            assert!(matches!(error.code, GitHubErrorCode::NoPendingLogin));
            assert_eq!(
                server.received_requests().await.map(|r| r.len()),
                Some(0),
                "non deve partire nessuna richiesta"
            );
        }
    }
}
