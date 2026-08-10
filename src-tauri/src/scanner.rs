use std::collections::HashSet;
use std::path::{Path, PathBuf};

use walkdir::{DirEntry, WalkDir};

use crate::errors::AppError;
use crate::git::GitClient;
use crate::models::{RepositoryInfo, ScanResult};

const DEFAULT_MAX_DEPTH: u32 = 12;
const MAX_ALLOWED_DEPTH: u32 = 32;
/// Caps on the size of the result. Without them a wrong root -- `C:\\` or the
/// home directory -- produces a scan that grows without limit and is then
/// serialized in one go over the IPC. The warnings in particular were unbounded
/// while the interface shows only the first one.
const MAX_REPOSITORIES: usize = 2_000;
const MAX_WARNINGS: usize = 100;
const EXCLUDED_DIRECTORIES: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    ".next",
    ".cache",
    ".gradle",
    ".idea",
    ".vscode",
];

/// Appends a warning while there is room, keeping as the last element a line
/// stating how many were left out: an explicit count beats a list silently
/// cut short.
/// The depth the frontend asks for is not trustworthy: it has to be brought
/// back into a usable range before reaching the walk.
fn clamp_depth(max_depth: Option<u32>) -> u32 {
    max_depth
        .unwrap_or(DEFAULT_MAX_DEPTH)
        .clamp(1, MAX_ALLOWED_DEPTH)
}

fn push_warning(warnings: &mut Vec<String>, omitted: &mut usize, warning: String) {
    if warnings.len() < MAX_WARNINGS {
        warnings.push(warning);
    } else {
        *omitted += 1;
    }
}

/// Runs the scan, reporting each repository as it is found.
///
/// The total is not known in advance — the tree is being walked — so the
/// callback receives only how many have been found so far. This is the longest
/// operation in the app and it was the only one with no feedback at all: on a
/// large root the bar stood still for minutes.
pub fn scan_repositories(
    root_path: String,
    max_depth: Option<u32>,
    on_found: &dyn Fn(usize, &str),
) -> Result<ScanResult, AppError> {
    let root = PathBuf::from(&root_path).canonicalize().map_err(|error| {
        AppError::translated(
            "notFound",
            "scan.rootUnreadable",
            format!("'{root_path}' could not be opened: {error}"),
        )
        .with("path", root_path.clone())
        .with("reason", error.to_string())
    })?;
    if !root.is_dir() {
        return Err(AppError::translated(
            "invalidRequest",
            "scan.rootNotFolder",
            format!("The path is not a folder: {}", root.display()),
        )
        .with("path", root.display().to_string()));
    }

    let git = GitClient::discover()?;
    let depth = clamp_depth(max_depth);
    let mut repositories = Vec::new();
    let mut warnings = Vec::new();
    let mut omitted_warnings = 0_usize;
    let mut seen = HashSet::new();

    let walker = WalkDir::new(&root)
        .follow_links(false)
        .max_depth(depth as usize)
        .into_iter()
        .filter_entry(should_visit);

    for entry in walker {
        // The scan is the longest operation in the app: without this check the
        // stop button would halt the Git commands but not the walk of the tree,
        // which on a large root keeps going for minutes.
        if repositories.len() >= MAX_REPOSITORIES {
            push_warning(
                &mut warnings,
                &mut omitted_warnings,
                format!(
                    "Scansione fermata a {MAX_REPOSITORIES} repository: restringi la cartella di lavoro o riduci la profondita."
                ),
            );
            break;
        }

        if crate::git::cancel_requested() {
            push_warning(
                &mut warnings,
                &mut omitted_warnings,
                "Scansione interrotta su richiesta.".to_string(),
            );
            break;
        }

        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                push_warning(
                    &mut warnings,
                    &mut omitted_warnings,
                    format!("Cartella non leggibile: {error}"),
                );
                continue;
            }
        };

        if !entry.file_type().is_dir() || entry.file_name() == ".git" {
            continue;
        }
        if !entry.path().join(".git").exists() {
            continue;
        }

        let canonical = match entry.path().canonicalize() {
            Ok(path) => path,
            Err(error) => {
                push_warning(
                    &mut warnings,
                    &mut omitted_warnings,
                    format!(
                        "Impossibile risolvere '{}': {error}",
                        entry.path().display()
                    ),
                );
                continue;
            }
        };
        if !seen.insert(canonical.clone()) {
            continue;
        }

        match git.repository_info(&canonical) {
            Ok(info) => {
                on_found(repositories.len() + 1, &info.name);
                repositories.push(info);
            }
            Err(error) => push_warning(
                &mut warnings,
                &mut omitted_warnings,
                format!("{}: {error}", canonical.display()),
            ),
        }
    }

    repositories.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.path.cmp(&right.path))
    });

    if omitted_warnings > 0 {
        warnings.push(format!(
            "Altri {omitted_warnings} avvisi non sono stati riportati."
        ));
    }

    Ok(ScanResult {
        root_path: root.to_string_lossy().to_string(),
        repositories,
        warnings,
    })
}

pub fn refresh_repositories(repo_paths: Vec<String>) -> Result<Vec<RepositoryInfo>, AppError> {
    let git = GitClient::discover()?;

    // Una repository che non risponde più viene omessa invece di far fallire
    // l'intero aggiornamento: prima il `collect` su `Result` corto-circuitava
    // al primo errore, così una sola cartella rotta impediva di aggiornare
    // tutte le altre. L'interfaccia fonde per percorso, quindi le righe non
    // aggiornate conservano semplicemente lo stato precedente.
    Ok(repo_paths
        .iter()
        .take_while(|_| !crate::git::cancel_requested())
        .filter_map(|path| git.repository_info(Path::new(path)).ok())
        .collect())
}

fn should_visit(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }

    if entry.file_name() == ".git" {
        return false;
    }

    if !entry.file_type().is_dir() || entry.path().join(".git").exists() {
        return true;
    }

    let name = entry.file_name().to_string_lossy();
    !EXCLUDED_DIRECTORIES
        .iter()
        .any(|excluded| name == *excluded)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La profondita' arriva dal frontend e non e' affidabile: l'interfaccia
    /// propone da 2 a 8, ma una chiamata IPC diretta puo' chiedere qualsiasi
    /// numero. Zero renderebbe la scansione inutile, un valore enorme la
    /// renderebbe interminabile.
    #[test]
    fn the_requested_depth_is_clamped_to_a_usable_range() {
        assert_eq!(clamp_depth(None), DEFAULT_MAX_DEPTH);
        assert_eq!(clamp_depth(Some(0)), 1);
        assert_eq!(clamp_depth(Some(4)), 4);
        assert_eq!(clamp_depth(Some(1_000)), MAX_ALLOWED_DEPTH);
        assert_eq!(clamp_depth(Some(u32::MAX)), MAX_ALLOWED_DEPTH);
    }

    /// I warning erano illimitati mentre l'interfaccia ne mostra solo il primo:
    /// su un albero con migliaia di cartelle illeggibili era memoria e traffico
    /// IPC sprecati. Il conteggio finale evita che il troncamento sia muto.
    #[test]
    fn warnings_are_capped_and_the_remainder_is_counted() {
        let mut warnings = Vec::new();
        let mut omitted = 0_usize;

        for index in 0..(MAX_WARNINGS + 25) {
            push_warning(&mut warnings, &mut omitted, format!("avviso {index}"));
        }

        assert_eq!(warnings.len(), MAX_WARNINGS);
        assert_eq!(omitted, 25);
        assert_eq!(warnings[0], "avviso 0");
        assert_eq!(
            warnings[MAX_WARNINGS - 1],
            format!("avviso {}", MAX_WARNINGS - 1)
        );
    }

    #[test]
    fn the_excluded_directories_cover_the_usual_build_output() {
        for name in ["node_modules", "target", "dist", ".next", ".cache"] {
            assert!(
                EXCLUDED_DIRECTORIES.contains(&name),
                "{name} deve restare escluso dalla camminata"
            );
        }
        // `.git` non e' nell'elenco perche' viene gestito a parte: e' il
        // marcatore che identifica una repository, non una directory da saltare.
        assert!(!EXCLUDED_DIRECTORIES.contains(&".git"));
    }
}
