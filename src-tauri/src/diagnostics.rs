//! Minimal diagnostics: rotating file logs and a record of every panic.
//!
//! Up to 0.6.0 the app left no trace on disk at all. In release on Windows,
//! `windows_subsystem = "windows"` removes the console, so a panic or a failed
//! start disappeared with no message and no file: a fault in the field was
//! simply not diagnosable.
//!
//! The real logger comes from `tauri-plugin-log`, which however is only active
//! after the app has been built. The panic hook therefore also writes to a
//! separate file, reachable without a Tauri handle, so the startup window stays
//! covered too.
//!
//! Security note: Git's output and the body of GitHub responses are never
//! recorded here. The error messages that pass through this module have already
//! been cleaned by `github::sanitize_error_message`, and a panic payload is a
//! string formatted at the panic site, not the state of the process. The token
//! has no path that leads to this file.

use std::fs::OpenOptions;
use std::io::Write;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::plugin::TauriPlugin;
use tauri::Runtime;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

/// Must stay aligned with `identifier` in `tauri.conf.json`: it is the name of
/// the folder used both by the log plugin and by the panic fallback.
const BUNDLE_IDENTIFIER: &str = "com.rubyrepo.desktop";

/// The identifier the app carried before it was called RubyRepo. Only the data
/// folder still looks for it, and only when the new one holds nothing: the list
/// of folders the user picked lives there, and losing it would make the app
/// show the remembered workspace while refusing every scan of it.
const LEGACY_BUNDLE_IDENTIFIER: &str = "com.multirepomanager.desktop";
const LOG_FILE_NAME: &str = "rubyrepo";
const FATAL_FILE_NAME: &str = "fatal.log";
const MAX_LOG_FILE_BYTES: u128 = 2 * 1024 * 1024;
const KEPT_LOG_FILES: usize = 3;

/// The logging plugin: rotating files in the system log folder, plus stderr for
/// development. In release on Windows stderr has nowhere to go, but that is not
/// a problem: the file remains.
///
/// `clear_targets` is not optional: `Builder::new` already starts with its own
/// default targets and `target` adds to them instead of replacing them, so
/// without this call you get two log files and every line duplicated.
pub fn logging_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.to_string()),
        }))
        .target(Target::new(TargetKind::Stderr))
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEPT_LOG_FILES))
        .level(log::LevelFilter::Info)
        .build()
}

/// Installs a hook that records every panic before letting the default
/// behaviour continue. It must be installed by the main process only: the
/// askpass helper is a separate, very short-lived process, and must not contend
/// for the log file with its parent.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let report = panic_report(info);
        log::error!("{report}");
        write_fatal(&report);
        previous(info);
    }));
}

/// Last resort: writes to stderr and appends to the fault file, ignoring every
/// IO error. Needed on the paths where the logger may not be active yet — that
/// is, panics and a failure to build the app.
pub fn write_fatal(message: &str) {
    eprintln!("{message}");

    let Some(directory) = log_directory() else {
        return;
    };
    if std::fs::create_dir_all(&directory).is_err() {
        return;
    }
    let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join(FATAL_FILE_NAME))
    else {
        return;
    };
    let _ = writeln!(file, "[{}] {message}", unix_timestamp());
}

fn panic_report(info: &PanicHookInfo<'_>) -> String {
    let location = info
        .location()
        .map(|location| {
            format!(
                "{}:{}:{}",
                location.file(),
                location.line(),
                location.column()
            )
        })
        .unwrap_or_else(|| "posizione sconosciuta".to_string());

    let payload = info
        .payload()
        .downcast_ref::<&str>()
        .map(|message| (*message).to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "payload non testuale".to_string());

    format!("Panic in {location}: {payload}")
}

/// Seconds since the Unix epoch. Deliberately without extra dependencies: it
/// exists to order the entries, not to be read.
fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// The application data folder, the same one that holds the logs. Exposed
/// because the list of folders the user picked has to live there too.
pub fn application_directory() -> Option<PathBuf> {
    log_directory().and_then(|logs| logs.parent().map(Path::to_path_buf))
}

/// The data folder of the previous name, when it still exists.
///
/// Nothing is written here. It is read once, so that an install that predates
/// the rename keeps the folders its user had already chosen.
pub fn legacy_application_directory() -> Option<PathBuf> {
    directory_for(LEGACY_BUNDLE_IDENTIFIER).filter(|path| path.is_dir())
}

/// Recomputes the same paths `TargetKind::LogDir` uses inside the plugin, so
/// the fault file ends up next to the ordinary logs.
fn log_directory() -> Option<PathBuf> {
    directory_for(BUNDLE_IDENTIFIER).map(|base| base.join("logs"))
}

/// The application folder for a given identifier.
///
/// Takes the identifier as an argument rather than reading the constant so the
/// previous one can be resolved with the same rules: the platform layout is the
/// part that must not diverge between the two, and duplicating it would be the
/// way to let it.
fn directory_for(identifier: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join(identifier))
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS the logs live under `Library/Logs`, and `application_directory`
        // is its parent: the shape stays the one the plugin uses.
        std::env::var_os("HOME")
            .map(|home| PathBuf::from(home).join("Library").join("Logs"))
            .map(|base| base.join(identifier))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
            })
            .map(|base| base.join(identifier))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// The report is the only content that reaches the fault file: if it lost
    /// the message or the location, a panic would go back to being as mute as
    /// before. The payload of a `panic!` with a literal is a `&str`, that of a
    /// formatted `panic!` is a `String`: the report must hold both.
    #[test]
    fn panic_reports_carry_location_and_message() {
        let captured: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&captured);

        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if let Ok(mut reports) = sink.lock() {
                reports.push(panic_report(info));
            }
        }));
        let literal = std::panic::catch_unwind(|| panic!("guasto letterale"));
        let formatted = std::panic::catch_unwind(|| panic!("guasto {}", "formattato"));
        std::panic::set_hook(previous);

        assert!(literal.is_err() && formatted.is_err());

        let reports = captured.lock().expect("mutex del test").clone();
        assert_eq!(reports.len(), 2, "l'hook deve aver visto entrambi i panic");
        assert!(reports[0].contains("guasto letterale"), "{}", reports[0]);
        assert!(reports[1].contains("guasto formattato"), "{}", reports[1]);
        for report in &reports {
            assert!(
                report.contains("diagnostics.rs"),
                "il rapporto deve indicare il file di origine: {report}"
            );
        }
    }

    /// The panic fallback must not be able to write outside the application
    /// folder: if the environment exposes no home directory it stays `None`
    /// instead of falling back to an arbitrary path.
    #[test]
    fn the_log_directory_is_scoped_to_the_bundle_identifier() {
        if let Some(directory) = log_directory() {
            assert!(
                directory.to_string_lossy().contains(BUNDLE_IDENTIFIER),
                "il percorso dei log deve restare dentro l'identificatore del bundle: {}",
                directory.display()
            );
        }
    }

    #[test]
    fn timestamps_are_plausible_unix_seconds() {
        assert!(unix_timestamp() > 1_700_000_000);
    }
}
