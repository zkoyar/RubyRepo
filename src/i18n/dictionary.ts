/// Every piece of text the application shows, in every language it speaks.
///
/// The shape is the point. `satisfies Record<string, Entry>` forces each entry
/// to carry all five languages: a missing translation is a compile error, not a
/// gap someone finds while using the app. `MessageId` is derived from the keys,
/// so a call site cannot ask for a message that does not exist either.
///
/// English is stored like any other language rather than being implied by the
/// key. Rewording the English text is then a single edit that leaves the other
/// four untouched — with the English sentence as the key, the same edit would
/// silently orphan them.
///
/// Placeholders are written `{name}` and filled from the parameters passed to
/// `t`. Translations never contain markup: layout belongs to the components.

export const LANGUAGES = ["en", "it", "fr", "es", "de"] as const;

export type Language = (typeof LANGUAGES)[number];

/// Each language names itself. Nobody looking for Deutsch is helped by seeing
/// "Tedesco", so these are deliberately not translated.
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  it: "Italiano",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
};

/// BCP-47 tags for `Intl`. Dates and numbers must follow the chosen language,
/// otherwise the interface speaks German and formats in Italian.
export const LOCALES: Record<Language, string> = {
  en: "en-GB",
  it: "it-IT",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
};

export const DEFAULT_LANGUAGE: Language = "en";

type Entry = Record<Language, string>;

const messages = {
  // ── Language selector ────────────────────────────────────────────────────
  "language.choose": {
    en: "Choose language",
    it: "Scegli la lingua",
    fr: "Choisir la langue",
    es: "Elegir idioma",
    de: "Sprache wählen",
  },
  "language.current": {
    en: "Language: {name}",
    it: "Lingua: {name}",
    fr: "Langue : {name}",
    es: "Idioma: {name}",
    de: "Sprache: {name}",
  },

  // ── Shared vocabulary ────────────────────────────────────────────────────
  "common.cancel": {
    en: "Cancel",
    it: "Annulla",
    fr: "Annuler",
    es: "Cancelar",
    de: "Abbrechen",
  },
  "common.close": {
    en: "Close",
    it: "Chiudi",
    fr: "Fermer",
    es: "Cerrar",
    de: "Schließen",
  },
  "common.refresh": {
    en: "Refresh",
    it: "Aggiorna",
    fr: "Actualiser",
    es: "Actualizar",
    de: "Aktualisieren",
  },
  "common.clearSearch": {
    en: "Clear search", it: "Cancella ricerca", fr: "Effacer la recherche",
    es: "Borrar la búsqueda", de: "Suche löschen",
  },
  "common.desktopOnly": {
    en: "This action needs the Tauri desktop app. Start it with `npm run tauri dev`.",
    it: "Questa azione richiede l’app desktop Tauri. Avviala con `npm run tauri dev`.",
    fr: "Cette action nécessite l’application de bureau Tauri. Lancez-la avec `npm run tauri dev`.",
    es: "Esta acción requiere la aplicación de escritorio Tauri. Iníciala con `npm run tauri dev`.",
    de: "Diese Aktion erfordert die Tauri-Desktop-App. Starte sie mit `npm run tauri dev`.",
  },

  // ── Git operations, as shown in the activity log ─────────────────────────
  "operation.fetch": {
    en: "Fetch",
    it: "Fetch",
    fr: "Fetch",
    es: "Fetch",
    de: "Fetch",
  },
  "operation.pull": {
    en: "Pull",
    it: "Pull",
    fr: "Pull",
    es: "Pull",
    de: "Pull",
  },
  "operation.push": {
    en: "Push",
    it: "Push",
    fr: "Push",
    es: "Push",
    de: "Push",
  },
  "operation.commit": {
    en: "Commit",
    it: "Commit",
    fr: "Commit",
    es: "Commit",
    de: "Commit",
  },
  "operation.stage": {
    en: "Stage files",
    it: "Stage file",
    fr: "Indexer des fichiers",
    es: "Preparar archivos",
    de: "Dateien vormerken",
  },
  "operation.unstage": {
    en: "Unstage files",
    it: "Unstage file",
    fr: "Désindexer des fichiers",
    es: "Quitar de preparación",
    de: "Vormerkung aufheben",
  },
  "operation.discard": {
    en: "Discard changes",
    it: "Annulla modifiche",
    fr: "Abandonner les modifications",
    es: "Descartar cambios",
    de: "Änderungen verwerfen",
  },
  "operation.link": {
    en: "Link to GitHub",
    it: "Collega a GitHub",
    fr: "Lier à GitHub",
    es: "Vincular con GitHub",
    de: "Mit GitHub verknüpfen",
  },
  "operation.unknown": {
    en: "Operation",
    it: "Operazione",
    fr: "Opération",
    es: "Operación",
    de: "Vorgang",
  },
  "operation.clone": {
    en: "Clone from GitHub",
    it: "Clona da GitHub",
    fr: "Cloner depuis GitHub",
    es: "Clonar desde GitHub",
    de: "Von GitHub klonen",
  },

  // ── Batch summaries ──────────────────────────────────────────────────────
  //
  // Four whole sentences, not fragments to join with a comma. The first draft
  // had `{parts}` plus three fragments: it looks more compact, but it imposes on
  // every language the word order of whoever wrote the code. It had never been
  // wired to `summaryMessage`, so changing it broke nothing.
  "batch.allDone": {
    en: "{done} operations completed.",
    it: "{done} operazioni completate.",
    fr: "{done} opérations terminées.",
    es: "{done} operaciones completadas.",
    de: "{done} Vorgänge abgeschlossen.",
  },
  "batch.doneAndFailed": {
    en: "{done} completed, {failed} failed. Check the activity list.",
    it: "{done} completate, {failed} non riuscite. Controlla le attività.",
    fr: "{done} terminées, {failed} en échec. Consultez la liste des activités.",
    es: "{done} completadas, {failed} fallidas. Revisa la lista de actividad.",
    de: "{done} abgeschlossen, {failed} fehlgeschlagen. Prüfen Sie die Aktivitätsliste.",
  },
  "batch.doneAndSkipped": {
    en: "{done} completed, {skipped} skipped. Check the activity list.",
    it: "{done} completate, {skipped} saltate. Controlla le attività.",
    fr: "{done} terminées, {skipped} ignorées. Consultez la liste des activités.",
    es: "{done} completadas, {skipped} omitidas. Revisa la lista de actividad.",
    de: "{done} abgeschlossen, {skipped} übersprungen. Prüfen Sie die Aktivitätsliste.",
  },
  "batch.doneFailedSkipped": {
    en: "{done} completed, {failed} failed, {skipped} skipped. Check the activity list.",
    it: "{done} completate, {failed} non riuscite, {skipped} saltate. Controlla le attività.",
    fr: "{done} terminées, {failed} en échec, {skipped} ignorées. Consultez la liste des activités.",
    es: "{done} completadas, {failed} fallidas, {skipped} omitidas. Revisa la lista de actividad.",
    de: "{done} abgeschlossen, {failed} fehlgeschlagen, {skipped} übersprungen. Prüfen Sie die Aktivitätsliste.",
  },
  // ── GitHub account button ────────────────────────────────────────────────
  "account.connect": {
    en: "Connect GitHub",
    it: "Connetti GitHub",
    fr: "Connecter GitHub",
    es: "Conectar GitHub",
    de: "GitHub verbinden",
  },
  "account.connectAria": {
    en: "Connect a GitHub account",
    it: "Connetti un account GitHub",
    fr: "Connecter un compte GitHub",
    es: "Conectar una cuenta de GitHub",
    de: "Ein GitHub-Konto verbinden",
  },
  "account.connectedAria": {
    en: "GitHub account: {name}",
    it: "Account GitHub: {name}",
    fr: "Compte GitHub : {name}",
    es: "Cuenta de GitHub: {name}",
    de: "GitHub-Konto: {name}",
  },
  "account.connected": {
    en: "GitHub connected",
    it: "GitHub connesso",
    fr: "GitHub connecté",
    es: "GitHub conectado",
    de: "GitHub verbunden",
  },
  "account.label": {
    en: "Account",
    it: "Account",
    fr: "Compte",
    es: "Cuenta",
    de: "Konto",
  },
  "account.checking": {
    en: "Checking…",
    it: "Verifica…",
    fr: "Vérification…",
    es: "Comprobando…",
    de: "Prüfung…",
  },

  // ── Activity log ─────────────────────────────────────────────────────────
  "activity.title": {
    en: "Activity",
    it: "Attività",
    fr: "Activité",
    es: "Actividad",
    de: "Aktivität",
  },
  "activity.session": {
    en: "Current session",
    it: "Sessione corrente",
    fr: "Session en cours",
    es: "Sesión actual",
    de: "Aktuelle Sitzung",
  },
  "activity.close": {
    en: "Close activity",
    it: "Chiudi attività",
    fr: "Fermer l’activité",
    es: "Cerrar actividad",
    de: "Aktivität schließen",
  },
  "activity.clear": {
    en: "Clear activity",
    it: "Svuota attività",
    fr: "Vider l’activité",
    es: "Vaciar actividad",
    de: "Aktivität leeren",
  },
  "activity.emptyTitle": {
    en: "No operations yet",
    it: "Nessuna operazione",
    fr: "Aucune opération",
    es: "Ninguna operación",
    de: "Keine Vorgänge",
  },
  "activity.emptyBody": {
    en: "Results of staging, commits and synchronisation will appear here.",
    it: "I risultati di stage, commit e sincronizzazione appariranno qui.",
    fr: "Les résultats de l’indexation, des commits et de la synchronisation apparaîtront ici.",
    es: "Los resultados de preparación, commits y sincronización aparecerán aquí.",
    de: "Ergebnisse von Vormerkungen, Commits und Synchronisierung erscheinen hier.",
  },
  "activity.succeeded": {
    en: "Operation completed",
    it: "Operazione completata",
    fr: "Opération terminée",
    es: "Operación completada",
    de: "Vorgang abgeschlossen",
  },
  "activity.failed": {
    en: "Operation failed",
    it: "Operazione non riuscita",
    fr: "Opération en échec",
    es: "Operación fallida",
    de: "Vorgang fehlgeschlagen",
  },
  "activity.gitDetails": {
    en: "Git output",
    it: "Dettagli Git",
    fr: "Sortie de Git",
    es: "Salida de Git",
    de: "Git-Ausgabe",
  },

  // ── Status badges ────────────────────────────────────────────────────────
  "badge.conflicts": {
    en: "Conflicts {count}",
    it: "Conflitti {count}",
    fr: "Conflits {count}",
    es: "Conflictos {count}",
    de: "Konflikte {count}",
  },
  "badge.changes": {
    en: "Changes {count}",
    it: "Modifiche {count}",
    fr: "Modifications {count}",
    es: "Cambios {count}",
    de: "Änderungen {count}",
  },
  "badge.ahead": {
    en: "ahead",
    it: "ahead",
    fr: "en avance",
    es: "por delante",
    de: "voraus",
  },
  "badge.behind": {
    en: "behind",
    it: "behind",
    fr: "en retard",
    es: "por detrás",
    de: "zurück",
  },
  "badge.localOnly": {
    en: "Local",
    it: "Locale",
    fr: "Local",
    es: "Local",
    de: "Lokal",
  },
  "badge.noRemote": {
    en: "No remote",
    it: "Nessun remote",
    fr: "Aucun dépôt distant",
    es: "Sin remoto",
    de: "Kein Remote",
  },
  "badge.noUpstreamShort": {
    en: "No upstream",
    it: "No upstream",
    fr: "Sans upstream",
    es: "Sin upstream",
    de: "Kein Upstream",
  },
  "badge.noUpstream": {
    en: "Upstream missing",
    it: "Upstream assente",
    fr: "Upstream absent",
    es: "Upstream ausente",
    de: "Upstream fehlt",
  },
  "badge.clean": {
    en: "Clean",
    it: "Pulita",
    fr: "Propre",
    es: "Limpia",
    de: "Sauber",
  },

  // ── Discard confirmation ─────────────────────────────────────────────────
  // The confirmation word is translated with everything else: asking an Italian
  // user to type an English word to protect their own files would be a barrier,
  // not a safeguard.
  "discard.confirmWord": {
    en: "DISCARD",
    it: "ANNULLA",
    fr: "ANNULER",
    es: "DESCARTAR",
    de: "VERWERFEN",
  },
  "discard.irreversible": {
    en: "Irreversible operation",
    it: "Operazione irreversibile",
    fr: "Opération irréversible",
    es: "Operación irreversible",
    de: "Unumkehrbarer Vorgang",
  },
  "discard.titleOne": {
    en: "Discard the change?",
    it: "Annullare la modifica?",
    fr: "Abandonner la modification ?",
    es: "¿Descartar el cambio?",
    de: "Änderung verwerfen?",
  },
  "discard.titleMany": {
    en: "Discard {count} changes?",
    it: "Annullare {count} modifiche?",
    fr: "Abandonner {count} modifications ?",
    es: "¿Descartar {count} cambios?",
    de: "{count} Änderungen verwerfen?",
  },
  "discard.closeAria": {
    en: "Close confirmation",
    it: "Chiudi conferma",
    fr: "Fermer la confirmation",
    es: "Cerrar confirmación",
    de: "Bestätigung schließen",
  },
  "discard.lead": {
    en: "The selected changes in {repository} will be lost.",
    it: "Le modifiche selezionate in {repository} andranno perse.",
    fr: "Les modifications sélectionnées dans {repository} seront perdues.",
    es: "Los cambios seleccionados en {repository} se perderán.",
    de: "Die ausgewählten Änderungen in {repository} gehen verloren.",
  },
  "discard.untracked": {
    en: "The selected new files will be deleted from disk. RubyRepo cannot undo this.",
    it: "I file nuovi selezionati verranno eliminati dal disco. Questa azione non può essere annullata da RubyRepo.",
    fr: "Les nouveaux fichiers sélectionnés seront supprimés du disque. RubyRepo ne peut pas annuler cette action.",
    es: "Los archivos nuevos seleccionados se eliminarán del disco. RubyRepo no puede deshacerlo.",
    de: "Die ausgewählten neuen Dateien werden von der Festplatte gelöscht. RubyRepo kann das nicht rückgängig machen.",
  },
  "discard.tracked": {
    en: "Unsaved content will be restored to the staged version. RubyRepo cannot undo this.",
    it: "Il contenuto non salvato verrà ripristinato alla versione indicizzata. Questa azione non può essere annullata da RubyRepo.",
    fr: "Le contenu non enregistré sera restauré à la version indexée. RubyRepo ne peut pas annuler cette action.",
    es: "El contenido no guardado se restaurará a la versión preparada. RubyRepo no puede deshacerlo.",
    de: "Nicht gespeicherte Inhalte werden auf die vorgemerkte Fassung zurückgesetzt. RubyRepo kann das nicht rückgängig machen.",
  },
  "discard.fileListAria": {
    en: "Files that will be changed",
    it: "File che verranno modificati",
    fr: "Fichiers qui seront modifiés",
    es: "Archivos que se modificarán",
    de: "Dateien, die geändert werden",
  },
  "discard.more": {
    en: "and {count} more files…",
    it: "e altri {count} file…",
    fr: "et {count} autres fichiers…",
    es: "y {count} archivos más…",
    de: "und {count} weitere Dateien…",
  },
  "discard.typeToConfirm": {
    en: "Type {word} to confirm",
    it: "Digita {word} per confermare",
    fr: "Saisissez {word} pour confirmer",
    es: "Escribe {word} para confirmar",
    de: "Tippe {word} zum Bestätigen",
  },

  // ── Repository table ─────────────────────────────────────────────────────
  "table.group.github": {
    en: "GitHub", it: "GitHub", fr: "GitHub", es: "GitHub", de: "GitHub",
  },
  "table.group.otherRemote": {
    en: "Other remotes",
    it: "Altri remote",
    fr: "Autres dépôts distants",
    es: "Otros remotos",
    de: "Andere Remotes",
  },
  "table.group.local": {
    en: "Local only",
    it: "Solo locali",
    fr: "Locaux uniquement",
    es: "Solo locales",
    de: "Nur lokal",
  },
  "table.header.repository": {
    en: "Repository", it: "Repository", fr: "Dépôt", es: "Repositorio", de: "Repository",
  },
  "table.header.branch": {
    en: "Branch", it: "Branch", fr: "Branche", es: "Rama", de: "Branch",
  },
  "table.header.status": {
    en: "Status", it: "Stato", fr: "État", es: "Estado", de: "Status",
  },
  "table.header.lastCheck": {
    en: "Last check",
    it: "Ultimo controllo",
    fr: "Dernier contrôle",
    es: "Última comprobación",
    de: "Letzte Prüfung",
  },
  "table.header.actions": {
    en: "Actions", it: "Azioni", fr: "Actions", es: "Acciones", de: "Aktionen",
  },
  "table.selectAll": {
    en: "Select every visible repository",
    it: "Seleziona tutte le repository visibili",
    fr: "Sélectionner tous les dépôts visibles",
    es: "Seleccionar todos los repositorios visibles",
    de: "Alle sichtbaren Repositorys auswählen",
  },
  "table.selectGroup": {
    en: "Select group",
    it: "Seleziona gruppo",
    fr: "Sélectionner le groupe",
    es: "Seleccionar grupo",
    de: "Gruppe auswählen",
  },
  "table.deselectGroup": {
    en: "Deselect group",
    it: "Deseleziona gruppo",
    fr: "Désélectionner le groupe",
    es: "Deseleccionar grupo",
    de: "Gruppenauswahl aufheben",
  },
  "table.linkAria": {
    en: "Link {repository} to a GitHub repository",
    it: "Collega {repository} a una repository GitHub",
    fr: "Lier {repository} à un dépôt GitHub",
    es: "Vincular {repository} con un repositorio de GitHub",
    de: "{repository} mit einem GitHub-Repository verknüpfen",
  },
  "table.linkTitle": {
    en: "Link to GitHub",
    it: "Collega a GitHub",
    fr: "Lier à GitHub",
    es: "Vincular con GitHub",
    de: "Mit GitHub verknüpfen",
  },
  "table.detailsAria": {
    en: "Open details for {repository}",
    it: "Apri dettagli di {repository}",
    fr: "Ouvrir les détails de {repository}",
    es: "Abrir detalles de {repository}",
    de: "Details zu {repository} öffnen",
  },
  "table.checkedAt": {
    en: "Checked {time}",
    it: "Controllata {time}",
    fr: "Vérifié à {time}",
    es: "Comprobado a las {time}",
    de: "Geprüft um {time}",
  },
  "table.checkedUnknown": {
    en: "Check time unknown",
    it: "Controllo sconosciuto",
    fr: "Heure de contrôle inconnue",
    es: "Hora de comprobación desconocida",
    de: "Prüfzeit unbekannt",
  },
  "branch.detached": {
    en: "Detached HEAD",
    it: "HEAD scollegato",
    fr: "HEAD détaché",
    es: "HEAD desacoplado",
    de: "Abgetrennter HEAD",
  },
  "branch.unknown": {
    en: "Unknown branch",
    it: "Branch sconosciuto",
    fr: "Branche inconnue",
    es: "Rama desconocida",
    de: "Unbekannter Branch",
  },

  // ── Commit dialog ────────────────────────────────────────────────────────
  "commit.title": {
    en: "Create commit", it: "Crea commit", fr: "Créer un commit",
    es: "Crear commit", de: "Commit erstellen",
  },
  "commit.subtitle": {
    en: "Each repository produces its own commit, using only staged files.",
    it: "Ogni repository produrrà un commit indipendente usando soltanto i file staged.",
    fr: "Chaque dépôt produit son propre commit, en n’utilisant que les fichiers indexés.",
    es: "Cada repositorio produce su propio commit, usando solo los archivos preparados.",
    de: "Jedes Repository erzeugt einen eigenen Commit, nur aus vorgemerkten Dateien.",
  },
  "commit.stagedOnly": {
    en: "The commit includes only what is already staged.",
    it: "Il commit include solo ciò che è già staged.",
    fr: "Le commit n’inclut que ce qui est déjà indexé.",
    es: "El commit incluye solo lo que ya está preparado.",
    de: "Der Commit enthält nur bereits Vorgemerktes.",
  },
  "commit.stagedOnlyBody": {
    en: "Unstaged changes and new files stay out, unless you choose Stage all below.",
    it: "Le modifiche non staged e i file nuovi restano esclusi, salvo scelta esplicita di Stage all qui sotto.",
    fr: "Les modifications non indexées et les nouveaux fichiers restent exclus, sauf si vous choisissez Stage all ci-dessous.",
    es: "Los cambios sin preparar y los archivos nuevos quedan fuera, salvo que elijas Stage all abajo.",
    de: "Nicht vorgemerkte Änderungen und neue Dateien bleiben außen vor, außer du wählst unten Stage all.",
  },
  "commit.sharedToggle": {
    en: "Use the same message for all",
    it: "Usa lo stesso messaggio per tutte",
    fr: "Utiliser le même message pour tous",
    es: "Usar el mismo mensaje para todos",
    de: "Für alle dieselbe Nachricht verwenden",
  },
  "commit.sharedToggleHint": {
    en: "The message applies only to the included repositories.",
    it: "Il messaggio sarà applicato solo alle repository incluse.",
    fr: "Le message ne s’applique qu’aux dépôts inclus.",
    es: "El mensaje se aplica solo a los repositorios incluidos.",
    de: "Die Nachricht gilt nur für die einbezogenen Repositorys.",
  },
  "commit.sharedMessage": {
    en: "Shared message", it: "Messaggio condiviso", fr: "Message partagé",
    es: "Mensaje compartido", de: "Gemeinsame Nachricht",
  },
  "commit.sharedPlaceholder": {
    en: "Describe this set of changes",
    it: "Descrivi questa serie di modifiche",
    fr: "Décrivez cet ensemble de modifications",
    es: "Describe este conjunto de cambios",
    de: "Beschreibe diese Änderungen",
  },
  "commit.message": {
    en: "Commit message", it: "Messaggio commit", fr: "Message de commit",
    es: "Mensaje del commit", de: "Commit-Nachricht",
  },
  "commit.messagePlaceholder": {
    en: "Message for {repository}",
    it: "Messaggio per {repository}",
    fr: "Message pour {repository}",
    es: "Mensaje para {repository}",
    de: "Nachricht für {repository}",
  },
  "commit.stageAll": {
    en: "Run Stage all before committing",
    it: "Esegui Stage all prima del commit",
    fr: "Exécuter Stage all avant le commit",
    es: "Ejecutar Stage all antes del commit",
    de: "Vor dem Commit Stage all ausführen",
  },
  "commit.stageAllHint": {
    en: "An explicit choice: it also includes modified, deleted and new files that are not staged.",
    it: "Scelta esplicita: include anche file modificati, eliminati e nuovi che non sono staged.",
    fr: "Choix explicite : inclut aussi les fichiers modifiés, supprimés et nouveaux non indexés.",
    es: "Elección explícita: incluye también archivos modificados, eliminados y nuevos sin preparar.",
    de: "Bewusste Wahl: schließt auch geänderte, gelöschte und neue Dateien ein, die nicht vorgemerkt sind.",
  },
  "commit.excluded": {
    en: "{count} repositories excluded",
    it: "{count} repository escluse",
    fr: "{count} dépôts exclus",
    es: "{count} repositorios excluidos",
    de: "{count} Repositorys ausgeschlossen",
  },
  "commit.excluded.conflicts": {
    en: "Resolve the conflicts first",
    it: "Risolvi prima i conflitti",
    fr: "Résolvez d’abord les conflits",
    es: "Resuelve antes los conflictos",
    de: "Zuerst die Konflikte lösen",
  },
  "commit.excluded.nothing": {
    en: "Nothing to record",
    it: "Nessuna modifica da registrare",
    fr: "Rien à enregistrer",
    es: "Nada que registrar",
    de: "Nichts aufzuzeichnen",
  },
  "commit.acknowledge": {
    en: "I have checked the changes to include",
    it: "Confermo di aver verificato le modifiche da includere",
    fr: "J’ai vérifié les modifications à inclure",
    es: "He revisado los cambios a incluir",
    de: "Ich habe die einzuschließenden Änderungen geprüft",
  },
  "commit.acknowledgeHint": {
    en: "Unstaged and selected new files will enter the commit.",
    it: "I file non staged e quelli nuovi selezionati entreranno nel commit.",
    fr: "Les fichiers non indexés et les nouveaux fichiers sélectionnés entreront dans le commit.",
    es: "Los archivos sin preparar y los nuevos seleccionados entrarán en el commit.",
    de: "Nicht vorgemerkte und ausgewählte neue Dateien kommen in den Commit.",
  },
  "commit.summary": {
    en: "{count} commits in {count} repositories",
    it: "{count} commit in {count} repository",
    fr: "{count} commits dans {count} dépôts",
    es: "{count} commits en {count} repositorios",
    de: "{count} Commits in {count} Repositorys",
  },
  "commit.running": {
    en: "Committing…", it: "Commit in corso…", fr: "Commit en cours…",
    es: "Creando commit…", de: "Commit läuft…",
  },

  // ── Sync dialog ──────────────────────────────────────────────────────────
  "sync.pushTitle": {
    en: "Send commits", it: "Invia commit", fr: "Envoyer les commits",
    es: "Enviar commits", de: "Commits senden",
  },
  "sync.pullTitle": {
    en: "Fetch changes", it: "Scarica modifiche", fr: "Récupérer les modifications",
    es: "Descargar cambios", de: "Änderungen holen",
  },
  "sync.pushLead": {
    en: "The remote state has been checked. Review destination and commits: the first push sets the upstream, and force push is never used.",
    it: "Lo stato remoto è stato verificato. Controlla destinazione e commit: il primo push configura l’upstream e il force push non viene mai usato.",
    fr: "L’état distant a été vérifié. Vérifiez la destination et les commits : le premier push configure l’upstream, et le force push n’est jamais utilisé.",
    es: "Se ha comprobado el estado remoto. Revisa destino y commits: el primer push configura el upstream y nunca se usa force push.",
    de: "Der Remote-Zustand wurde geprüft. Prüfe Ziel und Commits: Der erste Push richtet den Upstream ein, und Force-Push wird nie verwendet.",
  },
  "sync.pullLead": {
    en: "The remote state has been checked. Pull needs a clean working tree; for diverged branches choose merge or rebase.",
    it: "Lo stato remoto è stato verificato. Il pull richiede una copia di lavoro pulita; per i branch divergenti scegli merge o rebase.",
    fr: "L’état distant a été vérifié. Le pull exige une copie de travail propre ; pour les branches divergentes, choisissez merge ou rebase.",
    es: "Se ha comprobado el estado remoto. El pull necesita una copia de trabajo limpia; para ramas divergentes elige merge o rebase.",
    de: "Der Remote-Zustand wurde geprüft. Pull braucht einen sauberen Arbeitsbaum; für divergierte Branches wähle Merge oder Rebase.",
  },
  "sync.strategy": {
    en: "How to integrate", it: "Come integrare", fr: "Mode d’intégration",
    es: "Cómo integrar", de: "Art der Integration",
  },
  "sync.strategy.fastForward": {
    en: "Fast-forward", it: "Fast-forward", fr: "Fast-forward",
    es: "Fast-forward", de: "Fast-forward",
  },
  "sync.strategy.fastForwardHint": {
    en: "Moves forward only when there is nothing to reconcile.",
    it: "Avanza solo se non c’è niente da riconciliare.",
    fr: "N’avance que s’il n’y a rien à réconcilier.",
    es: "Avanza solo si no hay nada que reconciliar.",
    de: "Geht nur weiter, wenn nichts abzugleichen ist.",
  },
  "sync.strategy.merge": {
    en: "Merge", it: "Merge", fr: "Merge", es: "Merge", de: "Merge",
  },
  "sync.strategy.mergeHint": {
    en: "Joins the two histories with a merge commit.",
    it: "Unisce le due storie con un commit di merge.",
    fr: "Réunit les deux historiques avec un commit de merge.",
    es: "Une las dos historias con un commit de merge.",
    de: "Verbindet beide Historien mit einem Merge-Commit.",
  },
  "sync.strategy.rebase": {
    en: "Rebase", it: "Rebase", fr: "Rebase", es: "Rebase", de: "Rebase",
  },
  "sync.strategy.rebaseHint": {
    en: "Replays local commits on top of the remote.",
    it: "Riapplica i commit locali sopra il remote.",
    fr: "Rejoue les commits locaux au-dessus du dépôt distant.",
    es: "Reaplica los commits locales sobre el remoto.",
    de: "Spielt lokale Commits über dem Remote erneut ab.",
  },
  "sync.ready": {
    en: "Ready · {count}", it: "Pronte · {count}", fr: "Prêts · {count}",
    es: "Listos · {count}", de: "Bereit · {count}",
  },
  "sync.blocked": {
    en: "Excluded · {count}", it: "Escluse · {count}", fr: "Exclus · {count}",
    es: "Excluidos · {count}", de: "Ausgeschlossen · {count}",
  },
  "sync.commitCount": {
    en: "{count} commits", it: "{count} commit", fr: "{count} commits",
    es: "{count} commits", de: "{count} Commits",
  },
  "sync.firstPush": {
    en: "First push · sets upstream",
    it: "Primo push · configura upstream",
    fr: "Premier push · configure l’upstream",
    es: "Primer push · configura el upstream",
    de: "Erster Push · richtet Upstream ein",
  },
  "sync.pushWarning": {
    en: "The app cannot undo a push.",
    it: "Il push non può essere annullato dall’app.",
    fr: "L’application ne peut pas annuler un push.",
    es: "La aplicación no puede deshacer un push.",
    de: "Die App kann einen Push nicht rückgängig machen.",
  },
  "sync.pushWarningBody": {
    en: "Repositories are processed separately and every result is recorded.",
    it: "Le repository saranno elaborate separatamente e ogni risultato verrà registrato.",
    fr: "Les dépôts sont traités séparément et chaque résultat est enregistré.",
    es: "Los repositorios se procesan por separado y cada resultado queda registrado.",
    de: "Repositorys werden einzeln verarbeitet und jedes Ergebnis wird festgehalten.",
  },
  "sync.firstPushOne": {
    en: " The repository without an upstream will have its destination set on the first push.",
    it: " Per la repository senza upstream verrà configurata la destinazione al primo push.",
    fr: " Le dépôt sans upstream verra sa destination configurée au premier push.",
    es: " Al repositorio sin upstream se le configurará el destino en el primer push.",
    de: " Beim Repository ohne Upstream wird das Ziel beim ersten Push gesetzt.",
  },
  "sync.firstPushMany": {
    en: " {count} repositories without an upstream will have their destination set on the first push.",
    it: " Per {count} repository senza upstream verrà configurata la destinazione al primo push.",
    fr: " {count} dépôts sans upstream verront leur destination configurée au premier push.",
    es: " A {count} repositorios sin upstream se les configurará el destino en el primer push.",
    de: " Bei {count} Repositorys ohne Upstream wird das Ziel beim ersten Push gesetzt.",
  },
  "sync.noneEligible": {
    en: "No eligible repository",
    it: "Nessuna repository compatibile",
    fr: "Aucun dépôt éligible",
    es: "Ningún repositorio apto",
    de: "Kein geeignetes Repository",
  },
  "sync.willProcess": {
    en: "{count} repositories will be processed",
    it: "{count} repository verranno elaborate",
    fr: "{count} dépôts seront traités",
    es: "Se procesarán {count} repositorios",
    de: "{count} Repositorys werden verarbeitet",
  },
  "sync.running": {
    en: "Working…", it: "Operazione in corso…", fr: "Opération en cours…",
    es: "Operación en curso…", de: "Vorgang läuft…",
  },
  "sync.confirmPush": {
    en: "Confirm push", it: "Conferma push", fr: "Confirmer le push",
    es: "Confirmar push", de: "Push bestätigen",
  },
  "sync.confirmPull": {
    en: "Confirm pull", it: "Conferma pull", fr: "Confirmer le pull",
    es: "Confirmar pull", de: "Pull bestätigen",
  },

  // ── Why a repository cannot take part ────────────────────────────────────
  "blocked.conflicts": {
    en: "Unresolved conflicts", it: "Conflitti non risolti", fr: "Conflits non résolus",
    es: "Conflictos sin resolver", de: "Ungelöste Konflikte",
  },
  "blocked.noRemote": {
    en: "No remote configured", it: "Nessun remote configurato",
    fr: "Aucun dépôt distant configuré", es: "Sin remoto configurado",
    de: "Kein Remote konfiguriert",
  },
  "blocked.noBranch": {
    en: "Local branch unavailable", it: "Branch locale non disponibile",
    fr: "Branche locale indisponible", es: "Rama local no disponible",
    de: "Lokaler Branch nicht verfügbar",
  },
  "blocked.noCommit": {
    en: "Create at least one commit before the first push",
    it: "Crea almeno un commit prima del primo push",
    fr: "Créez au moins un commit avant le premier push",
    es: "Crea al menos un commit antes del primer push",
    de: "Erstelle mindestens einen Commit vor dem ersten Push",
  },
  "blocked.diverged": {
    en: "Diverged branch", it: "Branch divergente", fr: "Branche divergente",
    es: "Rama divergente", de: "Divergierter Branch",
  },
  "blocked.remoteAhead": {
    en: "The remote branch is ahead", it: "Il branch remoto è più avanti",
    fr: "La branche distante est en avance", es: "La rama remota está por delante",
    de: "Der Remote-Branch ist voraus",
  },
  "blocked.nothingToSend": {
    en: "Nothing to send", it: "Nessun commit da inviare", fr: "Rien à envoyer",
    es: "Nada que enviar", de: "Nichts zu senden",
  },
  "blocked.noUpstream": {
    en: "Upstream not configured", it: "Upstream non configurato",
    fr: "Upstream non configuré", es: "Upstream no configurado",
    de: "Upstream nicht konfiguriert",
  },
  "blocked.dirty": {
    en: "Working tree has local changes", it: "Working tree con modifiche locali",
    fr: "Copie de travail avec modifications locales",
    es: "Copia de trabajo con cambios locales",
    de: "Arbeitsbaum mit lokalen Änderungen",
  },
  "blocked.upToDate": {
    en: "Already up to date", it: "Repository già aggiornata", fr: "Déjà à jour",
    es: "Ya actualizado", de: "Bereits aktuell",
  },
  "blocked.divergedChooseStrategy": {
    en: "Diverged branch: choose merge or rebase",
    it: "Branch divergente: scegli merge o rebase",
    fr: "Branche divergente : choisissez merge ou rebase",
    es: "Rama divergente: elige merge o rebase",
    de: "Divergierter Branch: wähle Merge oder Rebase",
  },
  "blocked.localCommits": {
    en: "Local commits are present", it: "Sono presenti commit locali",
    fr: "Des commits locaux sont présents", es: "Hay commits locales",
    de: "Es gibt lokale Commits",
  },

  // ── Repository tools ─────────────────────────────────────────────────────
  "tools.eyebrow": {
    en: "TOOLS", it: "STRUMENTI", fr: "OUTILS", es: "HERRAMIENTAS", de: "WERKZEUGE",
  },
  "tools.aria": {
    en: "Repository tools", it: "Strumenti repository", fr: "Outils du dépôt",
    es: "Herramientas del repositorio", de: "Repository-Werkzeuge",
  },
  "tools.tab.history": {
    en: "History", it: "Storia", fr: "Historique", es: "Historial", de: "Verlauf",
  },
  "tools.tab.remotes": {
    en: "Remotes", it: "Remote", fr: "Dépôts distants", es: "Remotos", de: "Remotes",
  },
  "tools.tab.stashes": {
    en: "Stash", it: "Stash", fr: "Remise", es: "Stash", de: "Stash",
  },
  "tools.tab.conflicts": {
    en: "Conflicts", it: "Conflitti", fr: "Conflits", es: "Conflictos", de: "Konflikte",
  },
  "tools.loading": {
    en: "Reading…", it: "Lettura in corso…", fr: "Lecture…", es: "Leyendo…", de: "Wird gelesen…",
  },
  "tools.readOnly": {
    en: "Read only", it: "Sola lettura", fr: "Lecture seule", es: "Solo lectura", de: "Nur lesen",
  },
  "tools.scopeAria": {
    en: "What to show of the history", it: "Cosa mostrare della storia",
    fr: "Ce qu’il faut montrer de l’historique", es: "Qué mostrar del historial",
    de: "Was vom Verlauf gezeigt wird",
  },
  "tools.recent": {
    en: "Latest commits", it: "Ultimi commit", fr: "Derniers commits",
    es: "Últimos commits", de: "Letzte Commits",
  },
  "tools.outgoing": {
    en: "To send", it: "Da inviare", fr: "À envoyer", es: "Por enviar", de: "Zu senden",
  },
  "tools.noUpstream": {
    en: "The branch has no upstream: there is no “to send” to compute.",
    it: "Il branch non ha un upstream: non c’è un “da inviare” da calcolare.",
    fr: "La branche n’a pas d’upstream : il n’y a pas d’« à envoyer » à calculer.",
    es: "La rama no tiene upstream: no hay un «por enviar» que calcular.",
    de: "Der Branch hat keinen Upstream: Es gibt kein „zu senden“ zu berechnen.",
  },
  "tools.nothingToSend": {
    en: "Nothing to send.", it: "Niente da inviare.", fr: "Rien à envoyer.",
    es: "Nada que enviar.", de: "Nichts zu senden.",
  },
  "tools.noCommits": {
    en: "No commits.", it: "Nessun commit.", fr: "Aucun commit.",
    es: "Ningún commit.", de: "Keine Commits.",
  },
  "tools.truncated": {
    en: "Showing the first 200 commits.", it: "Mostrati i primi 200 commit.",
    fr: "Les 200 premiers commits sont affichés.", es: "Se muestran los primeros 200 commits.",
    de: "Die ersten 200 Commits werden gezeigt.",
  },
  "tools.noRemotes": {
    en: "No remote configured.", it: "Nessun remote configurato.",
    fr: "Aucun dépôt distant configuré.", es: "Ningún remoto configurado.",
    de: "Kein Remote konfiguriert.",
  },
  "tools.edit": {
    en: "Edit", it: "Modifica", fr: "Modifier", es: "Editar", de: "Bearbeiten",
  },
  "tools.remoteName": {
    en: "Name", it: "Nome", fr: "Nom", es: "Nombre", de: "Name",
  },
  "tools.remoteNameAria": {
    en: "Remote name", it: "Nome del remote", fr: "Nom du dépôt distant",
    es: "Nombre del remoto", de: "Name des Remotes",
  },
  "tools.remoteUrl": {
    en: "URL", it: "URL", fr: "URL", es: "URL", de: "URL",
  },
  "tools.remoteUrlAria": {
    en: "Remote URL", it: "URL del remote", fr: "URL du dépôt distant",
    es: "URL del remoto", de: "URL des Remotes",
  },
  "tools.remoteReplacementHint": {
    en: "Enter the complete replacement URL. Stored credentials, query parameters and additional URLs are not prefilled.",
    it: "Inserisci l’URL completo di sostituzione. Credenziali, parametri di query e URL aggiuntivi memorizzati non vengono precompilati.",
    fr: "Saisissez l’URL de remplacement complet. Les identifiants, paramètres de requête et URL supplémentaires enregistrés ne sont pas préremplis.",
    es: "Introduce la URL de sustitución completa. Las credenciales, los parámetros de consulta y las URL adicionales guardados no se rellenan previamente.",
    de: "Gib die vollständige Ersatz-URL ein. Gespeicherte Zugangsdaten, Abfrageparameter und zusätzliche URLs werden nicht vorausgefüllt.",
  },
  "tools.cancelRemoteEdit": {
    en: "Cancel edit", it: "Annulla modifica", fr: "Annuler la modification",
    es: "Cancelar edición", de: "Bearbeitung abbrechen",
  },
  "tools.saveRemote": {
    en: "Save remote", it: "Salva remote", fr: "Enregistrer le dépôt distant",
    es: "Guardar remoto", de: "Remote speichern",
  },
  "tools.remoteSaved": {
    en: "Remote {name} configured.", it: "Remote {name} configurato.",
    fr: "Dépôt distant {name} configuré.", es: "Remoto {name} configurado.",
    de: "Remote {name} konfiguriert.",
  },
  "tools.remoteRemoved": {
    en: "Remote {name} removed.", it: "Remote {name} rimosso.",
    fr: "Dépôt distant {name} supprimé.", es: "Remoto {name} eliminado.",
    de: "Remote {name} entfernt.",
  },
  "tools.noStashes": {
    en: "Nothing set aside.", it: "Nessuna modifica messa da parte.",
    fr: "Rien de mis de côté.", es: "Nada guardado aparte.",
    de: "Nichts beiseitegelegt.",
  },
  "tools.stashApply": {
    en: "Apply", it: "Applica", fr: "Appliquer", es: "Aplicar", de: "Anwenden",
  },
  "tools.stashApplyTitle": {
    en: "Reapply and keep the entry in the stack",
    it: "Riapplica e lascia la voce nella pila",
    fr: "Réappliquer en gardant l’entrée dans la pile",
    es: "Reaplicar y mantener la entrada en la pila",
    de: "Erneut anwenden und Eintrag im Stapel lassen",
  },
  "tools.stashPop": {
    en: "Restore", it: "Riprendi", fr: "Reprendre", es: "Recuperar", de: "Zurückholen",
  },
  "tools.stashPopTitle": {
    en: "Reapply and remove from the stack",
    it: "Riapplica e togli dalla pila",
    fr: "Réappliquer et retirer de la pile",
    es: "Reaplicar y quitar de la pila",
    de: "Erneut anwenden und aus dem Stapel entfernen",
  },
  "tools.stashDropTitle": {
    en: "Delete without reapplying", it: "Elimina senza riapplicare",
    fr: "Supprimer sans réappliquer", es: "Eliminar sin reaplicar",
    de: "Löschen ohne erneut anzuwenden",
  },
  "tools.stashApplied": {
    en: "Changes reapplied; the entry stays in the stack.",
    it: "Modifiche riapplicate, la voce resta nella pila.",
    fr: "Modifications réappliquées ; l’entrée reste dans la pile.",
    es: "Cambios reaplicados; la entrada permanece en la pila.",
    de: "Änderungen erneut angewendet; der Eintrag bleibt im Stapel.",
  },
  "tools.stashPopped": {
    en: "Changes reapplied and the entry removed.",
    it: "Modifiche riapplicate e voce rimossa.",
    fr: "Modifications réappliquées et entrée retirée.",
    es: "Cambios reaplicados y entrada eliminada.",
    de: "Änderungen erneut angewendet und Eintrag entfernt.",
  },
  "tools.stashDropped": {
    en: "Entry deleted without reapplying it.",
    it: "Voce eliminata senza riapplicarla.",
    fr: "Entrée supprimée sans être réappliquée.",
    es: "Entrada eliminada sin reaplicarla.",
    de: "Eintrag gelöscht, ohne ihn anzuwenden.",
  },
  "tools.stashMessage": {
    en: "Message", it: "Messaggio", fr: "Message", es: "Mensaje", de: "Nachricht",
  },
  "tools.stashMessageAria": {
    en: "Stash message", it: "Messaggio dello stash", fr: "Message de la remise",
    es: "Mensaje del stash", de: "Stash-Nachricht",
  },
  "tools.stashPlaceholder": {
    en: "What you were working on", it: "A cosa stavi lavorando",
    fr: "Ce sur quoi vous travailliez", es: "En qué estabas trabajando",
    de: "Woran du gearbeitet hast",
  },
  "tools.stashUntracked": {
    en: "Include untracked files", it: "Includi i file non tracciati",
    fr: "Inclure les fichiers non suivis", es: "Incluir archivos sin seguimiento",
    de: "Unversionierte Dateien einbeziehen",
  },
  "tools.stashCreate": {
    en: "Set aside", it: "Metti da parte", fr: "Mettre de côté",
    es: "Guardar aparte", de: "Beiseitelegen",
  },
  "tools.stashCreated": {
    en: "Changes set aside.", it: "Modifiche messe da parte.",
    fr: "Modifications mises de côté.", es: "Cambios guardados aparte.",
    de: "Änderungen beiseitegelegt.",
  },
  "tools.noPending": {
    en: "Nothing left half-done.", it: "Nessuna operazione lasciata a metà.",
    fr: "Rien laissé à moitié fait.", es: "Nada dejado a medias.",
    de: "Nichts halb erledigt.",
  },
  "tools.pending": {
    en: "{operation} in progress.", it: "{operation} in corso.",
    fr: "{operation} en cours.", es: "{operation} en curso.",
    de: "{operation} läuft.",
  },
  "tools.pendingResolve": {
    en: " Resolve the listed files and stage them, then continue.",
    it: " Risolvi i file elencati e mettili in stage, poi continua.",
    fr: " Résolvez les fichiers listés et indexez-les, puis continuez.",
    es: " Resuelve los archivos listados y prepáralos, luego continúa.",
    de: " Löse die aufgeführten Dateien, merke sie vor und fahre dann fort.",
  },
  "tools.pendingReady": {
    en: " No files are in conflict any more: you can continue.",
    it: " Non ci sono più file in conflitto: puoi continuare.",
    fr: " Plus aucun fichier n’est en conflit : vous pouvez continuer.",
    es: " Ya no hay archivos en conflicto: puedes continuar.",
    de: " Keine Datei ist mehr in Konflikt: Du kannst fortfahren.",
  },
  "tools.abort": {
    en: "Abort everything", it: "Annulla tutto", fr: "Tout annuler",
    es: "Cancelar todo", de: "Alles abbrechen",
  },
  "tools.aborted": {
    en: "Operation aborted: the repository is back as it was.",
    it: "Operazione annullata: la repository è tornata com’era.",
    fr: "Opération annulée : le dépôt est revenu à son état initial.",
    es: "Operación cancelada: el repositorio ha vuelto a su estado previo.",
    de: "Vorgang abgebrochen: Das Repository ist wieder wie zuvor.",
  },
  "tools.continue": {
    en: "Continue", it: "Continua", fr: "Continuer", es: "Continuar", de: "Fortfahren",
  },
  "tools.continued": {
    en: "Operation completed.", it: "Operazione completata.",
    fr: "Opération terminée.", es: "Operación completada.", de: "Vorgang abgeschlossen.",
  },
  "tools.stillConflicted": {
    en: "There are still files in conflict", it: "Ci sono ancora file in conflitto",
    fr: "Des fichiers sont encore en conflit", es: "Todavía hay archivos en conflicto",
    de: "Es sind noch Dateien in Konflikt",
  },
  "tools.scopeNote": {
    en: "Every action touches this repository only.",
    it: "Ogni azione tocca solo questa repository.",
    fr: "Chaque action ne concerne que ce dépôt.",
    es: "Cada acción afecta solo a este repositorio.",
    de: "Jede Aktion betrifft nur dieses Repository.",
  },

  // ── Backend errors ───────────────────────────────────────────────────────
  // The backend names these; the identifiers must stay in step with the
  // `AppError::translated` calls in the Rust side.
  "error.folderNotChosen": {
    en: "The folder was not picked in the dialog: choose it again.",
    it: "La cartella non è stata scelta dal dialog: ripeti la selezione.",
    fr: "Le dossier n’a pas été choisi dans la boîte de dialogue : sélectionnez-le à nouveau.",
    es: "La carpeta no se eligió en el diálogo: vuelve a seleccionarla.",
    de: "Der Ordner wurde nicht im Dialog ausgewählt: Wähle ihn erneut.",
  },
  "error.unauthorizedRepository": {
    en: "Repository not authorised. Scan again: {path}",
    it: "Repository non autorizzata. Esegui nuovamente la scansione: {path}",
    fr: "Dépôt non autorisé. Relancez l’analyse : {path}",
    es: "Repositorio no autorizado. Vuelve a escanear: {path}",
    de: "Repository nicht autorisiert. Erneut scannen: {path}",
  },

  // ── Sidebar filters ──────────────────────────────────────────────────────
  "filter.all": {
    en: "All", it: "Tutte", fr: "Tous", es: "Todos", de: "Alle",
  },
  "filter.dirty": {
    en: "Changed", it: "Modificate", fr: "Modifiés", es: "Modificados", de: "Geändert",
  },
  "filter.ahead": {
    en: "To send", it: "Da inviare", fr: "À envoyer", es: "Por enviar", de: "Zu senden",
  },
  "filter.behind": {
    en: "To update", it: "Da aggiornare", fr: "À mettre à jour",
    es: "Por actualizar", de: "Zu aktualisieren",
  },
  "filter.conflict": {
    en: "In conflict", it: "In conflitto", fr: "En conflit",
    es: "En conflicto", de: "In Konflikt",
  },
  "filter.github": {
    en: "On GitHub", it: "Su GitHub", fr: "Sur GitHub", es: "En GitHub", de: "Auf GitHub",
  },
  "filter.otherRemote": {
    en: "Other remotes", it: "Altri remote", fr: "Autres dépôts distants",
    es: "Otros remotos", de: "Andere Remotes",
  },
  "filter.noRemote": {
    en: "No remote", it: "Senza remote", fr: "Sans dépôt distant",
    es: "Sin remoto", de: "Ohne Remote",
  },
  "filter.view": {
    en: "View", it: "Vista", fr: "Vue", es: "Vista", de: "Ansicht",
  },

  // ── Top bar and workspace header ─────────────────────────────────────────
  "app.workspaceFolder": {
    en: "Working folder", it: "Cartella di lavoro", fr: "Dossier de travail",
    es: "Carpeta de trabajo", de: "Arbeitsordner",
  },
  "app.chooseFolder": {
    en: "Choose a folder", it: "Scegli una cartella", fr: "Choisir un dossier",
    es: "Elige una carpeta", de: "Ordner wählen",
  },
  "app.changeFolder": {
    en: "Change working folder", it: "Cambia cartella di lavoro",
    fr: "Changer de dossier de travail", es: "Cambiar carpeta de trabajo",
    de: "Arbeitsordner wechseln",
  },
  "app.desktopOnlyShort": {
    en: "Available in the desktop app", it: "Disponibile nell’app desktop",
    fr: "Disponible dans l’application de bureau", es: "Disponible en la aplicación de escritorio",
    de: "In der Desktop-App verfügbar",
  },
  "app.depth": {
    en: "Depth", it: "Profondità", fr: "Profondeur", es: "Profundidad", de: "Tiefe",
  },
  "app.depthAria": {
    en: "Maximum scan depth", it: "Profondità massima di scansione",
    fr: "Profondeur maximale d’analyse", es: "Profundidad máxima de escaneo",
    de: "Maximale Scan-Tiefe",
  },
  "app.depthRescan": {
    en: "Change depth and scan again", it: "Cambia profondità e riscansiona la cartella",
    fr: "Changer la profondeur et relancer l’analyse",
    es: "Cambiar la profundidad y volver a escanear",
    de: "Tiefe ändern und erneut scannen",
  },
  "app.depthNext": {
    en: "Depth of the next scan", it: "Profondità della prossima scansione",
    fr: "Profondeur de la prochaine analyse", es: "Profundidad del próximo escaneo",
    de: "Tiefe des nächsten Scans",
  },
  "app.searchPlaceholder": {
    en: "Search name, path or branch…", it: "Cerca nome, percorso o branch…",
    fr: "Rechercher un nom, un chemin ou une branche…",
    es: "Busca nombre, ruta o rama…", de: "Name, Pfad oder Branch suchen…",
  },
  "app.scan": {
    en: "Scan", it: "Scansiona", fr: "Analyser", es: "Escanear", de: "Scannen",
  },
  "app.clone": {
    en: "Clone", it: "Clona", fr: "Cloner", es: "Clonar", de: "Klonen",
  },
  "app.cloneTitle": {
    en: "Clone a GitHub repository into the workspace",
    it: "Clona una repository GitHub nel workspace",
    fr: "Cloner un dépôt GitHub dans l’espace de travail",
    es: "Clonar un repositorio de GitHub en el espacio de trabajo",
    de: "Ein GitHub-Repository in den Arbeitsbereich klonen",
  },
  "app.connectFirst": {
    en: "Connect your GitHub account first", it: "Collega prima il tuo account GitHub",
    fr: "Connectez d’abord votre compte GitHub", es: "Conecta antes tu cuenta de GitHub",
    de: "Verbinde zuerst dein GitHub-Konto",
  },

  // ── Notifications ────────────────────────────────────────────────────────
  "notify.foundOne": {
    en: "Found 1 repository.", it: "Trovata 1 repository.", fr: "1 dépôt trouvé.",
    es: "1 repositorio encontrado.", de: "1 Repository gefunden.",
  },
  "notify.foundMany": {
    en: "Found {count} repositories.", it: "Trovate {count} repository.",
    fr: "{count} dépôts trouvés.", es: "{count} repositorios encontrados.",
    de: "{count} Repositorys gefunden.",
  },
  "notify.refreshed": {
    en: "Repository state updated.", it: "Stato delle repository aggiornato.",
    fr: "État des dépôts mis à jour.", es: "Estado de los repositorios actualizado.",
    de: "Repository-Zustand aktualisiert.",
  },
  "notify.cancelRequested": {
    en: "Stop requested: the operation ends as soon as it can.",
    it: "Interruzione richiesta: l’operazione si ferma appena possibile.",
    fr: "Arrêt demandé : l’opération s’arrête dès que possible.",
    es: "Interrupción solicitada: la operación se detendrá en cuanto pueda.",
    de: "Abbruch angefordert: Der Vorgang endet, sobald es geht.",
  },
  "notify.signInToLink": {
    en: "Sign in to GitHub to link the folder to a repository.",
    it: "Accedi a GitHub per collegare la cartella a una repository.",
    fr: "Connectez-vous à GitHub pour lier le dossier à un dépôt.",
    es: "Inicia sesión en GitHub para vincular la carpeta con un repositorio.",
    de: "Melde dich bei GitHub an, um den Ordner mit einem Repository zu verknüpfen.",
  },
  "notify.signInToClone": {
    en: "Sign in to GitHub to clone a repository.",
    it: "Accedi a GitHub per clonare una repository.",
    fr: "Connectez-vous à GitHub pour cloner un dépôt.",
    es: "Inicia sesión en GitHub para clonar un repositorio.",
    de: "Melde dich bei GitHub an, um ein Repository zu klonen.",
  },
  "notify.installApp": {
    en: "Install the GitHub App on at least one repository to link it.",
    it: "Installa la GitHub App su almeno una repository per poterla collegare.",
    fr: "Installez la GitHub App sur au moins un dépôt pour pouvoir le lier.",
    es: "Instala la GitHub App en al menos un repositorio para poder vincularlo.",
    de: "Installiere die GitHub App auf mindestens einem Repository, um es zu verknüpfen.",
  },
  "notify.noWritable": {
    en: "No GitHub repository with write access to link.",
    it: "Nessuna repository GitHub con accesso in scrittura da collegare.",
    fr: "Aucun dépôt GitHub avec accès en écriture à lier.",
    es: "Ningún repositorio de GitHub con acceso de escritura para vincular.",
    de: "Kein GitHub-Repository mit Schreibzugriff zum Verknüpfen.",
  },
  "notify.noneToClone": {
    en: "No GitHub repository available to clone.",
    it: "Nessuna repository GitHub disponibile da clonare.",
    fr: "Aucun dépôt GitHub disponible à cloner.",
    es: "Ningún repositorio de GitHub disponible para clonar.",
    de: "Kein GitHub-Repository zum Klonen verfügbar.",
  },
  "notify.noRemoteSelected": {
    en: "No selected repository has a remote configured.",
    it: "Nessuna repository selezionata ha un remote configurato.",
    fr: "Aucun dépôt sélectionné n’a de dépôt distant configuré.",
    es: "Ningún repositorio seleccionado tiene un remoto configurado.",
    de: "Kein ausgewähltes Repository hat ein Remote konfiguriert.",
  },
  "notify.skippedNoRemote": {
    en: "Skipped: no remote configured.",
    it: "Operazione saltata: nessun remote configurato.",
    fr: "Ignoré : aucun dépôt distant configuré.",
    es: "Omitido: ningún remoto configurado.",
    de: "Übersprungen: kein Remote konfiguriert.",
  },
  "notify.fileOperationFailed": {
    en: "The file operation failed.", it: "Operazione sui file non riuscita.",
    fr: "L’opération sur les fichiers a échoué.", es: "La operación sobre los archivos falló.",
    de: "Der Dateivorgang ist fehlgeschlagen.",
  },

  // ── Repository inspector ─────────────────────────────────────────────────
  "inspector.aria": {
    en: "Repository details", it: "Dettagli repository", fr: "Détails du dépôt",
    es: "Detalles del repositorio", de: "Repository-Details",
  },
  "inspector.close": {
    en: "Close details panel", it: "Chiudi pannello dettagli",
    fr: "Fermer le panneau de détails", es: "Cerrar el panel de detalles",
    de: "Detailbereich schließen",
  },
  "inspector.emptyTitle": {
    en: "Select a repository", it: "Seleziona una repository",
    fr: "Sélectionnez un dépôt", es: "Selecciona un repositorio",
    de: "Wähle ein Repository",
  },
  "inspector.emptyBody": {
    en: "Open a row to see changed files, diffs and Git details.",
    it: "Apri una riga per vedere file modificati, diff e dettagli Git.",
    fr: "Ouvrez une ligne pour voir les fichiers modifiés, les diffs et les détails Git.",
    es: "Abre una fila para ver archivos modificados, diffs y detalles de Git.",
    de: "Öffne eine Zeile, um geänderte Dateien, Diffs und Git-Details zu sehen.",
  },
  "inspector.tab.changes": {
    en: "Changes", it: "Modifiche", fr: "Modifications", es: "Cambios", de: "Änderungen",
  },
  "inspector.tab.diff": {
    en: "Diff", it: "Diff", fr: "Diff", es: "Diff", de: "Diff",
  },
  "inspector.tab.details": {
    en: "Details", it: "Dettagli", fr: "Détails", es: "Detalles", de: "Details",
  },
  "inspector.upstream": {
    en: "Upstream", it: "Upstream", fr: "Upstream", es: "Upstream", de: "Upstream",
  },
  "inspector.remote": {
    en: "Remote", it: "Remote", fr: "Dépôt distant", es: "Remoto", de: "Remote",
  },
  "inspector.remoteUrl": {
    en: "Remote URL", it: "URL remote", fr: "URL du dépôt distant",
    es: "URL del remoto", de: "Remote-URL",
  },
  "inspector.lastCommit": {
    en: "Last commit", it: "Ultimo commit", fr: "Dernier commit",
    es: "Último commit", de: "Letzter Commit",
  },
  "inspector.notConfigured": {
    en: "Not configured", it: "Non configurato", fr: "Non configuré",
    es: "Sin configurar", de: "Nicht konfiguriert",
  },
  "inspector.unavailable": {
    en: "Not available", it: "Non disponibile", fr: "Non disponible",
    es: "No disponible", de: "Nicht verfügbar",
  },
  "inspector.cleanTree": {
    en: "Working tree clean", it: "Working tree pulita", fr: "Copie de travail propre",
    es: "Copia de trabajo limpia", de: "Arbeitsbaum sauber",
  },
  "inspector.noChangedFiles": {
    en: "There are no changed files.", it: "Non ci sono file modificati.",
    fr: "Aucun fichier modifié.", es: "No hay archivos modificados.",
    de: "Keine geänderten Dateien.",
  },
  "inspector.noDiff": {
    en: "No difference in this section.", it: "Nessuna differenza in questa sezione.",
    fr: "Aucune différence dans cette section.", es: "Ninguna diferencia en esta sección.",
    de: "Kein Unterschied in diesem Abschnitt.",
  },
  "inspector.diffType": {
    en: "Diff type", it: "Tipo di diff", fr: "Type de diff",
    es: "Tipo de diff", de: "Diff-Art",
  },
  "inspector.diffPreview": {
    en: "Git diff preview", it: "Anteprima diff Git", fr: "Aperçu du diff Git",
    es: "Vista previa del diff de Git", de: "Git-Diff-Vorschau",
  },
  "inspector.readFailed": {
    en: "Details could not be read", it: "Impossibile leggere i dettagli",
    fr: "Impossible de lire les détails", es: "No se han podido leer los detalles",
    de: "Details konnten nicht gelesen werden",
  },
  "inspector.closeError": {
    en: "Dismiss error", it: "Chiudi errore", fr: "Fermer l’erreur",
    es: "Cerrar el error", de: "Fehler schließen",
  },
  "inspector.group.staged": {
    en: "Staged", it: "Staged", fr: "Indexés", es: "Preparados", de: "Vorgemerkt",
  },
  "inspector.group.unstaged": {
    en: "Not staged", it: "Non staged", fr: "Non indexés",
    es: "Sin preparar", de: "Nicht vorgemerkt",
  },
  "inspector.group.untracked": {
    en: "New files", it: "File nuovi", fr: "Nouveaux fichiers",
    es: "Archivos nuevos", de: "Neue Dateien",
  },
  "inspector.group.conflict": {
    en: "Conflicts", it: "Conflitti", fr: "Conflits", es: "Conflictos", de: "Konflikte",
  },
  "inspector.stageSelected": {
    en: "Stage selected", it: "Stage selezionati", fr: "Indexer la sélection",
    es: "Preparar seleccionados", de: "Auswahl vormerken",
  },
  "inspector.unstageSelected": {
    en: "Unstage selected", it: "Unstage selezionati", fr: "Désindexer la sélection",
    es: "Quitar seleccionados", de: "Auswahl aus Vormerkung nehmen",
  },
  "inspector.discardSelected": {
    en: "Discard selected changes", it: "Annulla modifiche selezionate",
    fr: "Abandonner les modifications sélectionnées",
    es: "Descartar los cambios seleccionados",
    de: "Ausgewählte Änderungen verwerfen",
  },
  "inspector.resolveManually": {
    en: "Resolve manually", it: "Risolvi manualmente", fr: "Résoudre manuellement",
    es: "Resolver manualmente", de: "Manuell lösen",
  },
  "inspector.conflictsNotActionable": {
    en: "Conflicts cannot be acted on from this view",
    it: "I conflitti non sono azionabili da questa vista",
    fr: "Les conflits ne peuvent pas être traités depuis cette vue",
    es: "Los conflictos no se pueden gestionar desde esta vista",
    de: "Konflikte lassen sich in dieser Ansicht nicht bearbeiten",
  },
  "inspector.operationFailed": {
    en: "The operation failed. Open Activity for the Git details.",
    it: "L’operazione non è riuscita. Apri Attività per consultare il dettaglio Git.",
    fr: "L’opération a échoué. Ouvrez Activité pour le détail Git.",
    es: "La operación falló. Abre Actividad para ver el detalle de Git.",
    de: "Der Vorgang ist fehlgeschlagen. Öffne Aktivität für die Git-Details.",
  },
  "inspector.selectAllIn": {
    en: "Select every file in {group}",
    it: "Seleziona tutti i file in {group}",
    fr: "Sélectionner tous les fichiers dans {group}",
    es: "Seleccionar todos los archivos en {group}",
    de: "Alle Dateien in {group} auswählen",
  },
  "file.modified": {
    en: "Modified", it: "Modificato", fr: "Modifié", es: "Modificado", de: "Geändert",
  },
  "file.added": {
    en: "Added", it: "Aggiunto", fr: "Ajouté", es: "Añadido", de: "Hinzugefügt",
  },
  "file.deleted": {
    en: "Deleted", it: "Eliminato", fr: "Supprimé", es: "Eliminado", de: "Gelöscht",
  },
  "file.renamed": {
    en: "Renamed", it: "Rinominato", fr: "Renommé", es: "Renombrado", de: "Umbenannt",
  },
  "file.new": {
    en: "New", it: "Nuovo", fr: "Nouveau", es: "Nuevo", de: "Neu",
  },
  "file.conflict": {
    en: "Conflict", it: "Conflitto", fr: "Conflit", es: "Conflicto", de: "Konflikt",
  },

  // ── Branch dialog ────────────────────────────────────────────────────────
  "branchDialog.eyebrow": {
    en: "BRANCH", it: "BRANCH", fr: "BRANCHE", es: "RAMA", de: "BRANCH",
  },
  "branchDialog.current": {
    en: "Current: {name}", it: "Attuale: {name}", fr: "Actuelle : {name}",
    es: "Actual: {name}", de: "Aktuell: {name}",
  },
  "branchDialog.detached": {
    en: "Detached HEAD: choose a branch to reattach.",
    it: "HEAD scollegato: scegli un branch per riagganciarti.",
    fr: "HEAD détaché : choisissez une branche pour vous rattacher.",
    es: "HEAD desacoplado: elige una rama para volver a engancharte.",
    de: "Abgetrennter HEAD: Wähle einen Branch zum Wiederanhängen.",
  },
  "branchDialog.searchPlaceholder": {
    en: "Search branches…", it: "Cerca branch…", fr: "Rechercher des branches…",
    es: "Buscar ramas…", de: "Branches suchen…",
  },
  "branchDialog.searchAria": {
    en: "Search among the branches", it: "Cerca fra i branch",
    fr: "Rechercher parmi les branches", es: "Buscar entre las ramas",
    de: "Unter den Branches suchen",
  },
  "branchDialog.loading": {
    en: "Reading branches…", it: "Lettura dei branch…", fr: "Lecture des branches…",
    es: "Leyendo las ramas…", de: "Branches werden gelesen…",
  },
  "branchDialog.none": {
    en: "No branches.", it: "Nessun branch.", fr: "Aucune branche.",
    es: "Ninguna rama.", de: "Keine Branches.",
  },
  "branchDialog.noMatch": {
    en: "No branch matches.", it: "Nessun branch corrisponde.",
    fr: "Aucune branche ne correspond.", es: "Ninguna rama coincide.",
    de: "Kein Branch passt.",
  },
  "branchDialog.noCommit": {
    en: "No commit", it: "Nessun commit", fr: "Aucun commit",
    es: "Ningún commit", de: "Kein Commit",
  },
  "branchDialog.alreadyHere": {
    en: "You are already here", it: "Sei già qui", fr: "Vous y êtes déjà",
    es: "Ya estás aquí", de: "Du bist schon hier",
  },
  "branchDialog.switchTo": {
    en: "Switch to {name}", it: "Passa a {name}", fr: "Basculer sur {name}",
    es: "Cambiar a {name}", de: "Zu {name} wechseln",
  },
  "branchDialog.remoteOnly": {
    en: "Remote only", it: "Solo remoto", fr: "Distant uniquement",
    es: "Solo remoto", de: "Nur remote",
  },
  "branchDialog.newBranch": {
    en: "New branch", it: "Nuovo branch", fr: "Nouvelle branche",
    es: "Nueva rama", de: "Neuer Branch",
  },
  "branchDialog.newPlaceholder": {
    en: "e.g. work/new-feature", it: "es. lavoro/nuova-funzione",
    fr: "ex. travail/nouvelle-fonction", es: "p. ej. trabajo/nueva-funcion",
    de: "z. B. arbeit/neue-funktion",
  },
  "branchDialog.newAria": {
    en: "Name of the new branch", it: "Nome del nuovo branch",
    fr: "Nom de la nouvelle branche", es: "Nombre de la nueva rama",
    de: "Name des neuen Branches",
  },
  "branchDialog.createStay": {
    en: "Create and stay", it: "Crea e resta", fr: "Créer et rester",
    es: "Crear y quedarse", de: "Erstellen und bleiben",
  },
  "branchDialog.createStayTitle": {
    en: "Create the branch without moving the working copy",
    it: "Crea il branch senza spostare la copia di lavoro",
    fr: "Créer la branche sans déplacer la copie de travail",
    es: "Crear la rama sin mover la copia de trabajo",
    de: "Branch erstellen, ohne die Arbeitskopie zu bewegen",
  },
  "branchDialog.createGo": {
    en: "Create and switch", it: "Crea e vai", fr: "Créer et basculer",
    es: "Crear e ir", de: "Erstellen und wechseln",
  },
  "branchDialog.footer": {
    en: "Switching branch never deletes unsaved work.",
    it: "Un cambio di branch non elimina mai lavoro non salvato.",
    fr: "Changer de branche ne supprime jamais un travail non enregistré.",
    es: "Cambiar de rama nunca elimina trabajo sin guardar.",
    de: "Ein Branch-Wechsel löscht nie ungespeicherte Arbeit.",
  },
  "branchDialog.switched": {
    en: "You are now on {name}.", it: "Ora sei su {name}.",
    fr: "Vous êtes maintenant sur {name}.", es: "Ahora estás en {name}.",
    de: "Du bist jetzt auf {name}.",
  },
  "branchDialog.trackingCreated": {
    en: "Created local branch {name} tracking {upstream}.",
    it: "Creato il branch locale {name} che segue {upstream}.",
    fr: "Branche locale {name} créée, suivant {upstream}.",
    es: "Creada la rama local {name} que sigue a {upstream}.",
    de: "Lokaler Branch {name} erstellt, der {upstream} folgt.",
  },
  "branchDialog.created": {
    en: "Created {name}; you stayed where you were.",
    it: "Creato {name}, sei rimasto dov’eri.",
    fr: "{name} créée ; vous êtes resté où vous étiez.",
    es: "Creada {name}; te has quedado donde estabas.",
    de: "{name} erstellt; du bist geblieben, wo du warst.",
  },
  "branchDialog.createdAndSwitched": {
    en: "Created {name} and switched to it.",
    it: "Creato {name} e ora sei lì.",
    fr: "{name} créée et vous y êtes.",
    es: "Creada {name} y ahora estás allí.",
    de: "{name} erstellt und dorthin gewechselt.",
  },
  "branchDialog.trackUnknown": {
    en: "the remote", it: "il remote", fr: "le dépôt distant",
    es: "el remoto", de: "das Remote",
  },
  "branchDialog.track.ahead": {
    en: "To send", it: "Da inviare", fr: "À envoyer", es: "Por enviar", de: "Zu senden",
  },
  "branchDialog.track.behind": {
    en: "To update", it: "Da aggiornare", fr: "À mettre à jour",
    es: "Por actualizar", de: "Zu aktualisieren",
  },
  "branchDialog.track.diverged": {
    en: "Diverged", it: "Divergente", fr: "Divergente", es: "Divergente", de: "Divergiert",
  },
  "branchDialog.track.gone": {
    en: "Upstream gone", it: "Upstream sparito", fr: "Upstream disparu",
    es: "Upstream desaparecido", de: "Upstream verschwunden",
  },

  // ── Clone dialog ─────────────────────────────────────────────────────────
  "clone.eyebrow": {
    en: "GITHUB + LOCAL WORKSPACE", it: "GITHUB + WORKSPACE LOCALE",
    fr: "GITHUB + ESPACE DE TRAVAIL LOCAL", es: "GITHUB + ESPACIO DE TRABAJO LOCAL",
    de: "GITHUB + LOKALER ARBEITSBEREICH",
  },
  "clone.title": {
    en: "Clone from GitHub", it: "Clona da GitHub", fr: "Cloner depuis GitHub",
    es: "Clonar desde GitHub", de: "Von GitHub klonen",
  },
  "clone.subtitle": {
    en: "Choose a repository and where to create the local copy.",
    it: "Scegli una repository e dove crearne la copia locale.",
    fr: "Choisissez un dépôt et où créer la copie locale.",
    es: "Elige un repositorio y dónde crear la copia local.",
    de: "Wähle ein Repository und wo die lokale Kopie entstehen soll.",
  },
  "clone.step1": {
    en: "Destination folder", it: "Cartella di destinazione",
    fr: "Dossier de destination", es: "Carpeta de destino", de: "Zielordner",
  },
  "clone.step1Hint": {
    en: "A subfolder will be created inside it.",
    it: "Verrà creata una sottocartella al suo interno.",
    fr: "Un sous-dossier y sera créé.",
    es: "Se creará una subcarpeta en su interior.",
    de: "Darin wird ein Unterordner angelegt.",
  },
  "clone.parentFolder": {
    en: "Container folder", it: "Cartella contenitore", fr: "Dossier conteneur",
    es: "Carpeta contenedora", de: "Übergeordneter Ordner",
  },
  "clone.pickFolder": {
    en: "Choose a folder…", it: "Scegli una cartella…", fr: "Choisir un dossier…",
    es: "Elige una carpeta…", de: "Ordner wählen…",
  },
  "clone.browse": {
    en: "Browse", it: "Sfoglia", fr: "Parcourir", es: "Examinar", de: "Durchsuchen",
  },
  "clone.pickFolderError": {
    en: "Select a destination folder.", it: "Seleziona una cartella di destinazione.",
    fr: "Sélectionnez un dossier de destination.", es: "Selecciona una carpeta de destino.",
    de: "Wähle einen Zielordner.",
  },
  "clone.folderName": {
    en: "Folder name", it: "Nome della cartella", fr: "Nom du dossier",
    es: "Nombre de la carpeta", de: "Ordnername",
  },
  "clone.folderNameAria": {
    en: "Name of the folder to create", it: "Nome della cartella da creare",
    fr: "Nom du dossier à créer", es: "Nombre de la carpeta a crear",
    de: "Name des zu erstellenden Ordners",
  },
  "clone.folderNameDefault": {
    en: "same as the repository", it: "come la repository",
    fr: "comme le dépôt", es: "igual que el repositorio", de: "wie das Repository",
  },
  "clone.step2": {
    en: "GitHub repository", it: "Repository GitHub", fr: "Dépôt GitHub",
    es: "Repositorio de GitHub", de: "GitHub-Repository",
  },
  "clone.step2Hint": {
    en: "Read access is enough to clone.", it: "Per clonare basta l’accesso in lettura.",
    fr: "Un accès en lecture suffit pour cloner.", es: "Basta con acceso de lectura para clonar.",
    de: "Für das Klonen genügt Lesezugriff.",
  },
  "clone.searchPlaceholder": {
    en: "Search repositories…", it: "Cerca repository…", fr: "Rechercher des dépôts…",
    es: "Buscar repositorios…", de: "Repositorys suchen…",
  },
  "clone.searchAria": {
    en: "Search among GitHub repositories", it: "Cerca fra le repository GitHub",
    fr: "Rechercher parmi les dépôts GitHub", es: "Buscar entre los repositorios de GitHub",
    de: "Unter den GitHub-Repositorys suchen",
  },
  "clone.listAria": {
    en: "GitHub repositories to clone", it: "Repository GitHub da clonare",
    fr: "Dépôts GitHub à cloner", es: "Repositorios de GitHub para clonar",
    de: "Zu klonende GitHub-Repositorys",
  },
  "clone.noneAvailable": {
    en: "No repository available.", it: "Nessuna repository disponibile.",
    fr: "Aucun dépôt disponible.", es: "Ningún repositorio disponible.",
    de: "Kein Repository verfügbar.",
  },
  "clone.noMatch": {
    en: "No repository matches the search.", it: "Nessuna repository corrisponde alla ricerca.",
    fr: "Aucun dépôt ne correspond à la recherche.",
    es: "Ningún repositorio coincide con la búsqueda.",
    de: "Kein Repository passt zur Suche.",
  },
  "clone.pickRepositoryError": {
    en: "Select a repository to clone.", it: "Seleziona una repository da clonare.",
    fr: "Sélectionnez un dépôt à cloner.", es: "Selecciona un repositorio para clonar.",
    de: "Wähle ein Repository zum Klonen.",
  },
  "clone.private": {
    en: "Private", it: "Privata", fr: "Privé", es: "Privado", de: "Privat",
  },
  "clone.public": {
    en: "Public", it: "Pubblica", fr: "Public", es: "Público", de: "Öffentlich",
  },
  "clone.alreadyLocal": {
    en: "Already local", it: "Già locale", fr: "Déjà en local",
    es: "Ya está en local", de: "Bereits lokal",
  },
  "clone.summaryAria": {
    en: "Clone summary", it: "Riepilogo clone", fr: "Résumé du clonage",
    es: "Resumen del clonado", de: "Zusammenfassung des Klonens",
  },
  "clone.expected": {
    en: "Expected copy", it: "Copia prevista", fr: "Copie prévue",
    es: "Copia prevista", de: "Erwartete Kopie",
  },
  "clone.pickRepository": {
    en: "Repository to choose", it: "Repository da scegliere",
    fr: "Dépôt à choisir", es: "Repositorio por elegir", de: "Repository zu wählen",
  },
  "clone.destination": {
    en: "Destination", it: "Destinazione", fr: "Destination",
    es: "Destino", de: "Ziel",
  },
  "clone.folder": {
    en: "Folder", it: "Cartella", fr: "Dossier", es: "Carpeta", de: "Ordner",
  },
  "clone.remote": {
    en: "Remote", it: "Remote", fr: "Dépôt distant", es: "Remoto", de: "Remote",
  },
  "clone.noAutomation": {
    en: "Nothing happens to the contents.", it: "Nessun automatismo sui contenuti.",
    fr: "Aucune action automatique sur le contenu.",
    es: "Ningún automatismo sobre el contenido.",
    de: "Keine Automatik am Inhalt.",
  },
  "clone.noAutomationBody": {
    en: "The repository is downloaded and origin is configured: no commit and no push.",
    it: "Viene scaricata la repository e configurato origin: nessun commit e nessun push.",
    fr: "Le dépôt est téléchargé et origin configuré : aucun commit ni push.",
    es: "Se descarga el repositorio y se configura origin: ningún commit ni push.",
    de: "Das Repository wird geladen und origin eingerichtet: kein Commit, kein Push.",
  },
  "clone.secondCopy": {
    en: "This repository is already in the workspace: you are creating a second copy.",
    it: "Questa repository è già presente nel workspace: stai creando una seconda copia.",
    fr: "Ce dépôt est déjà dans l’espace de travail : vous créez une deuxième copie.",
    es: "Este repositorio ya está en el espacio de trabajo: estás creando una segunda copia.",
    de: "Dieses Repository ist schon im Arbeitsbereich: Du erstellst eine zweite Kopie.",
  },
  "clone.footer": {
    en: "The download starts only on confirmation.",
    it: "Lo scaricamento parte solo con la conferma.",
    fr: "Le téléchargement ne démarre qu’après confirmation.",
    es: "La descarga empieza solo con la confirmación.",
    de: "Der Download startet erst nach Bestätigung.",
  },
  "clone.confirm": {
    en: "Clone repository", it: "Clona repository", fr: "Cloner le dépôt",
    es: "Clonar repositorio", de: "Repository klonen",
  },
  "clone.running": {
    en: "Cloning…", it: "Clonazione…", fr: "Clonage…", es: "Clonando…", de: "Klonen…",
  },
  "clone.doneEyebrow": {
    en: "CLONE COMPLETE", it: "CLONE COMPLETATO", fr: "CLONAGE TERMINÉ",
    es: "CLONADO COMPLETADO", de: "KLONEN ABGESCHLOSSEN",
  },
  "clone.doneTitle": {
    en: "Local copy ready", it: "Copia locale pronta", fr: "Copie locale prête",
    es: "Copia local lista", de: "Lokale Kopie bereit",
  },
  "clone.doneAria": {
    en: "Local copy created", it: "Copia locale creata", fr: "Copie locale créée",
    es: "Copia local creada", de: "Lokale Kopie erstellt",
  },
  "clone.doneBody": {
    en: "The remote {remote} now points at {url}.",
    it: "Il remote {remote} punta ora a {url}.",
    fr: "Le dépôt distant {remote} pointe maintenant vers {url}.",
    es: "El remoto {remote} apunta ahora a {url}.",
    de: "Das Remote {remote} zeigt jetzt auf {url}.",
  },
  "clone.doneFooter": {
    en: "Added to the workspace", it: "Aggiunta al workspace",
    fr: "Ajouté à l’espace de travail", es: "Añadido al espacio de trabajo",
    de: "Zum Arbeitsbereich hinzugefügt",
  },

  // ── Delete repository dialog ─────────────────────────────────────────────
  "delete.title": {
    en: "Delete the repository from GitHub?",
    it: "Eliminare la repository da GitHub?",
    fr: "Supprimer le dépôt de GitHub ?",
    es: "¿Eliminar el repositorio de GitHub?",
    de: "Repository von GitHub löschen?",
  },
  "delete.closeConfirm": {
    en: "Close deletion confirmation", it: "Chiudi conferma eliminazione",
    fr: "Fermer la confirmation de suppression", es: "Cerrar la confirmación de eliminación",
    de: "Löschbestätigung schließen",
  },
  "delete.closeResult": {
    en: "Close deletion result", it: "Chiudi esito eliminazione",
    fr: "Fermer le résultat de la suppression", es: "Cerrar el resultado de la eliminación",
    de: "Löschergebnis schließen",
  },
  "delete.confirm": {
    en: "Delete permanently", it: "Elimina definitivamente",
    fr: "Supprimer définitivement", es: "Eliminar definitivamente",
    de: "Endgültig löschen",
  },
  "delete.running": {
    en: "Deleting…", it: "Eliminazione…", fr: "Suppression…",
    es: "Eliminando…", de: "Löschen…",
  },
  "delete.localIntact": {
    en: "The local folder found will stay untouched",
    it: "La cartella locale rilevata resterà intatta",
    fr: "Le dossier local détecté restera intact",
    es: "La carpeta local detectada quedará intacta",
    de: "Der gefundene lokale Ordner bleibt unberührt",
  },
  "delete.localStillIntact": {
    en: "The local folder is still untouched",
    it: "La cartella locale è ancora intatta",
    fr: "Le dossier local est toujours intact",
    es: "La carpeta local sigue intacta",
    de: "Der lokale Ordner ist weiterhin unberührt",
  },
  "delete.noLocalChanged": {
    en: "No local file was changed", it: "Nessun file locale è stato modificato",
    fr: "Aucun fichier local n’a été modifié", es: "No se modificó ningún archivo local",
    de: "Keine lokale Datei wurde geändert",
  },
  "delete.noLocalWillChange": {
    en: "No local file, origin remote or branch will be changed.",
    it: "Nessun file locale, remote origin o branch verrà modificato.",
    fr: "Aucun fichier local, dépôt distant origin ou branche ne sera modifié.",
    es: "No se modificará ningún archivo local, remoto origin ni rama.",
    de: "Keine lokale Datei, kein origin-Remote und kein Branch wird geändert.",
  },
  "delete.noFolderDeleted": {
    en: "No local folder will be deleted.", it: "Nessuna cartella locale verrà eliminata.",
    fr: "Aucun dossier local ne sera supprimé.", es: "No se eliminará ninguna carpeta local.",
    de: "Kein lokaler Ordner wird gelöscht.",
  },
  "delete.doneEyebrow": {
    en: "Deletion complete", it: "Eliminazione completata",
    fr: "Suppression terminée", es: "Eliminación completada", de: "Löschen abgeschlossen",
  },
  "delete.doneTitle": {
    en: "Repository deleted from GitHub", it: "Repository eliminata da GitHub",
    fr: "Dépôt supprimé de GitHub", es: "Repositorio eliminado de GitHub",
    de: "Repository von GitHub gelöscht",
  },
  "delete.doneBody": {
    en: "The remote repository is no longer in the GitHub list.",
    it: "La repository remota non è più presente nell’elenco GitHub.",
    fr: "Le dépôt distant n’est plus dans la liste GitHub.",
    es: "El repositorio remoto ya no está en la lista de GitHub.",
    de: "Das Remote-Repository steht nicht mehr in der GitHub-Liste.",
  },
  "delete.accountStays": {
    en: "The GitHub account stays connected.", it: "L’account GitHub resta connesso.",
    fr: "Le compte GitHub reste connecté.", es: "La cuenta de GitHub sigue conectada.",
    de: "Das GitHub-Konto bleibt verbunden.",
  },
  "delete.failed": {
    en: "Deletion failed", it: "Eliminazione non riuscita",
    fr: "Échec de la suppression", es: "La eliminación falló", de: "Löschen fehlgeschlagen",
  },

  // ── Create repository dialog ─────────────────────────────────────────────
  "create.title": {
    en: "New repository", it: "Nuova repository", fr: "Nouveau dépôt",
    es: "Nuevo repositorio", de: "Neues Repository",
  },
  "create.subtitle": {
    en: "Set visibility and initial content before confirming.",
    it: "Definisci visibilità e contenuto iniziale prima della conferma.",
    fr: "Définissez la visibilité et le contenu initial avant de confirmer.",
    es: "Define la visibilidad y el contenido inicial antes de confirmar.",
    de: "Lege Sichtbarkeit und Anfangsinhalt vor der Bestätigung fest.",
  },
  "create.close": {
    en: "Close repository creation", it: "Chiudi creazione repository",
    fr: "Fermer la création du dépôt", es: "Cerrar la creación del repositorio",
    de: "Repository-Erstellung schließen",
  },
  "create.closeSummary": {
    en: "Close summary", it: "Chiudi riepilogo", fr: "Fermer le résumé",
    es: "Cerrar el resumen", de: "Zusammenfassung schließen",
  },
  "create.name": {
    en: "Repository name", it: "Nome repository", fr: "Nom du dépôt",
    es: "Nombre del repositorio", de: "Repository-Name",
  },
  "create.nameTooLong": {
    en: "The name can be at most 100 characters.",
    it: "Il nome può contenere al massimo 100 caratteri.",
    fr: "Le nom peut contenir au maximum 100 caractères.",
    es: "El nombre puede tener como máximo 100 caracteres.",
    de: "Der Name darf höchstens 100 Zeichen haben.",
  },
  "create.nameRequired": {
    en: "Enter a name for the repository.",
    it: "Inserisci un nome per la repository.",
    fr: "Saisissez un nom pour le dépôt.",
    es: "Introduce un nombre para el repositorio.",
    de: "Gib einen Namen für das Repository ein.",
  },
  "create.nameReserved": {
    en: "Choose a name other than a dot or a double dot.",
    it: "Scegli un nome diverso da punto o doppio punto.",
    fr: "Choisissez un nom autre qu’un point ou deux points.",
    es: "Elige un nombre distinto de punto o doble punto.",
    de: "Wähle einen Namen, der nicht Punkt oder Doppelpunkt ist.",
  },
  "create.nameCharacters": {
    en: "Use only letters, numbers, dot, hyphen and underscore, without spaces.",
    it: "Usa solo lettere, numeri, punto, trattino e underscore, senza spazi.",
    fr: "N’utilisez que lettres, chiffres, point, tiret et tiret bas, sans espaces.",
    es: "Usa solo letras, números, punto, guion y guion bajo, sin espacios.",
    de: "Verwende nur Buchstaben, Ziffern, Punkt, Bindestrich und Unterstrich, ohne Leerzeichen.",
  },
  "create.included": {
    en: "Included", it: "Inclusa", fr: "Incluse", es: "Incluida", de: "Enthalten",
  },
  "create.confirmPrivate": {
    en: "Create private repository", it: "Crea repository privata",
    fr: "Créer un dépôt privé", es: "Crear repositorio privado",
    de: "Privates Repository erstellen",
  },
  "create.confirmPublic": {
    en: "Create public repository", it: "Crea repository pubblica",
    fr: "Créer un dépôt public", es: "Crear repositorio público",
    de: "Öffentliches Repository erstellen",
  },
  "create.description": {
    en: "Description", it: "Descrizione", fr: "Description",
    es: "Descripción", de: "Beschreibung",
  },
  "create.descriptionTooLong": {
    en: "The description can be at most 350 characters.",
    it: "La descrizione può contenere al massimo 350 caratteri.",
    fr: "La description peut contenir au maximum 350 caractères.",
    es: "La descripción puede tener como máximo 350 caracteres.",
    de: "Die Beschreibung darf höchstens 350 Zeichen haben.",
  },
  "create.visibility": {
    en: "Visibility", it: "Visibilità", fr: "Visibilité",
    es: "Visibilidad", de: "Sichtbarkeit",
  },
  "create.private": {
    en: "Private", it: "Privata", fr: "Privé", es: "Privado", de: "Privat",
  },
  "create.privateHint": {
    en: "Only visible to authorised users.", it: "Accessibile solo a utenti autorizzati.",
    fr: "Accessible seulement aux utilisateurs autorisés.",
    es: "Accesible solo para usuarios autorizados.",
    de: "Nur für berechtigte Nutzer sichtbar.",
  },
  "create.public": {
    en: "Public", it: "Pubblica", fr: "Public", es: "Público", de: "Öffentlich",
  },
  "create.publicHint": {
    en: "Visible to anyone on GitHub.", it: "Visibile a chiunque su GitHub.",
    fr: "Visible par tout le monde sur GitHub.", es: "Visible para cualquiera en GitHub.",
    de: "Für alle auf GitHub sichtbar.",
  },
  "create.content": {
    en: "Content", it: "Contenuto", fr: "Contenu", es: "Contenido", de: "Inhalt",
  },
  "create.readme": {
    en: "Create an initial README", it: "Crea un README iniziale",
    fr: "Créer un README initial", es: "Crear un README inicial",
    de: "Ein erstes README anlegen",
  },
  "create.readmeHint": {
    en: "Off by default: an empty repository is ideal for linking an existing local project.",
    it: "Disattivato per default: una repository vuota è ideale per collegare un progetto locale esistente.",
    fr: "Désactivé par défaut : un dépôt vide est idéal pour lier un projet local existant.",
    es: "Desactivado por defecto: un repositorio vacío es ideal para vincular un proyecto local existente.",
    de: "Standardmäßig aus: Ein leeres Repository eignet sich ideal, um ein bestehendes lokales Projekt zu verknüpfen.",
  },
  "create.willCreate": {
    en: "Will be created", it: "Verrà creata", fr: "Sera créé",
    es: "Se creará", de: "Wird erstellt",
  },
  "create.none": {
    en: "None", it: "Nessuna", fr: "Aucune", es: "Ninguna", de: "Keine",
  },
  "create.footer": {
    en: "The request starts only on final confirmation.",
    it: "La richiesta partirà soltanto con la conferma finale.",
    fr: "La requête ne part qu’après confirmation finale.",
    es: "La solicitud parte solo con la confirmación final.",
    de: "Die Anfrage startet erst nach der letzten Bestätigung.",
  },
  "create.running": {
    en: "Creating…", it: "Creazione…", fr: "Création…", es: "Creando…", de: "Erstellen…",
  },
  "create.failed": {
    en: "Creation failed", it: "Creazione non riuscita", fr: "Échec de la création",
    es: "La creación falló", de: "Erstellen fehlgeschlagen",
  },
  "create.doneEyebrow": {
    en: "Operation complete", it: "Operazione completata", fr: "Opération terminée",
    es: "Operación completada", de: "Vorgang abgeschlossen",
  },
  "create.doneTitle": {
    en: "Repository created", it: "Repository creata", fr: "Dépôt créé",
    es: "Repositorio creado", de: "Repository erstellt",
  },
  "create.doneEmpty": {
    en: "The repository is empty and ready to be linked to an existing local project.",
    it: "La repository è vuota e pronta per essere collegata a un progetto locale esistente.",
    fr: "Le dépôt est vide et prêt à être lié à un projet local existant.",
    es: "El repositorio está vacío y listo para vincularse a un proyecto local existente.",
    de: "Das Repository ist leer und bereit, mit einem bestehenden lokalen Projekt verknüpft zu werden.",
  },
  "create.doneNoClone": {
    en: "No clone or local remote has been configured.",
    it: "Nessun clone o remote locale è stato configurato.",
    fr: "Aucun clone ni dépôt distant local n’a été configuré.",
    es: "No se ha configurado ningún clon ni remoto local.",
    de: "Es wurde kein Klon und kein lokales Remote eingerichtet.",
  },
  "create.permissionNeeded": {
    en: "GitHub App permission required", it: "Permesso GitHub App richiesto",
    fr: "Autorisation de la GitHub App requise", es: "Se requiere permiso de la GitHub App",
    de: "GitHub-App-Berechtigung erforderlich",
  },
  "create.permissionBody": {
    en: "Check the Administration permission of the GitHub App, or use the github.com/new link.",
    it: "Verifica il permesso Administration della GitHub App oppure usa il link github.com/new.",
    fr: "Vérifiez l’autorisation Administration de la GitHub App, ou utilisez le lien github.com/new.",
    es: "Comprueba el permiso Administration de la GitHub App o usa el enlace github.com/new.",
    de: "Prüfe die Administration-Berechtigung der GitHub App oder nutze den Link github.com/new.",
  },
  "create.openFailed": {
    en: "GitHub could not be opened", it: "Impossibile aprire GitHub",
    fr: "Impossible d’ouvrir GitHub", es: "No se ha podido abrir GitHub",
    de: "GitHub konnte nicht geöffnet werden",
  },

  // ── Link folder dialog ───────────────────────────────────────────────────
  "link.eyebrow": {
    en: "LOCAL WORKSPACE + GITHUB", it: "Workspace locale + GitHub",
    fr: "ESPACE DE TRAVAIL LOCAL + GITHUB", es: "ESPACIO DE TRABAJO LOCAL + GITHUB",
    de: "LOKALER ARBEITSBEREICH + GITHUB",
  },
  "link.title": {
    en: "Link folder to GitHub", it: "Collega cartella a GitHub",
    fr: "Lier un dossier à GitHub", es: "Vincular carpeta con GitHub",
    de: "Ordner mit GitHub verknüpfen",
  },
  "link.subtitle": {
    en: "Choose a local folder and a repository you can write to.",
    it: "Scegli una cartella locale e una repository sulla quale hai accesso in scrittura.",
    fr: "Choisissez un dossier local et un dépôt sur lequel vous avez accès en écriture.",
    es: "Elige una carpeta local y un repositorio en el que tengas acceso de escritura.",
    de: "Wähle einen lokalen Ordner und ein Repository mit Schreibzugriff.",
  },
  "link.close": {
    en: "Close repository linking", it: "Chiudi collegamento repository",
    fr: "Fermer la liaison du dépôt", es: "Cerrar la vinculación del repositorio",
    de: "Repository-Verknüpfung schließen",
  },
  "link.closeSummary": {
    en: "Close summary", it: "Chiudi riepilogo", fr: "Fermer le résumé",
    es: "Cerrar el resumen", de: "Zusammenfassung schließen",
  },
  "link.step1": {
    en: "Local folder", it: "Cartella locale", fr: "Dossier local",
    es: "Carpeta local", de: "Lokaler Ordner",
  },
  "link.step1Hint": {
    en: "It can be an existing Git project or a folder to initialise.",
    it: "Può essere un progetto Git esistente oppure una cartella da inizializzare.",
    fr: "Il peut s’agir d’un projet Git existant ou d’un dossier à initialiser.",
    es: "Puede ser un proyecto Git existente o una carpeta por inicializar.",
    de: "Es kann ein bestehendes Git-Projekt oder ein zu initialisierender Ordner sein.",
  },
  "link.folder": {
    en: "Folder to link", it: "Cartella da collegare", fr: "Dossier à lier",
    es: "Carpeta a vincular", de: "Zu verknüpfender Ordner",
  },
  "link.pickFolderError": {
    en: "Select a local folder.", it: "Seleziona una cartella locale.",
    fr: "Sélectionnez un dossier local.", es: "Selecciona una carpeta local.",
    de: "Wähle einen lokalen Ordner.",
  },
  "link.step2Hint": {
    en: "Only repositories the GitHub App can push to are shown.",
    it: "Sono mostrate solo le repository per cui la GitHub App consente il push.",
    fr: "Seuls les dépôts sur lesquels la GitHub App autorise le push sont affichés.",
    es: "Solo se muestran los repositorios en los que la GitHub App permite hacer push.",
    de: "Es werden nur Repositorys gezeigt, auf die die GitHub App pushen darf.",
  },
  "link.searchPlaceholder": {
    en: "Search writable repositories…", it: "Cerca repository scrivibile…",
    fr: "Rechercher un dépôt accessible en écriture…",
    es: "Buscar repositorio con escritura…", de: "Beschreibbares Repository suchen…",
  },
  "link.searchAria": {
    en: "Search writable GitHub repositories", it: "Cerca repository GitHub scrivibile",
    fr: "Rechercher des dépôts GitHub accessibles en écriture",
    es: "Buscar repositorios de GitHub con escritura",
    de: "Beschreibbare GitHub-Repositorys suchen",
  },
  "link.noWritable": {
    en: "No repository with write access.", it: "Nessuna repository con accesso in scrittura.",
    fr: "Aucun dépôt avec accès en écriture.", es: "Ningún repositorio con acceso de escritura.",
    de: "Kein Repository mit Schreibzugriff.",
  },
  "link.pickRepositoryError": {
    en: "Select a GitHub repository.", it: "Seleziona una repository GitHub.",
    fr: "Sélectionnez un dépôt GitHub.", es: "Selecciona un repositorio de GitHub.",
    de: "Wähle ein GitHub-Repository.",
  },
  "link.expected": {
    en: "Planned link", it: "Collegamento previsto", fr: "Liaison prévue",
    es: "Vinculación prevista", de: "Geplante Verknüpfung",
  },
  "link.gitActions": {
    en: "Git actions", it: "Azioni Git", fr: "Actions Git",
    es: "Acciones de Git", de: "Git-Aktionen",
  },
  "link.gitActionsValue": {
    en: "Init if needed + remote", it: "Init se serve + remote",
    fr: "Init si nécessaire + dépôt distant", es: "Init si hace falta + remoto",
    de: "Init falls nötig + Remote",
  },
  "link.alreadyInWorkspace": {
    en: "This remote repository is already in the workspace. You can still link the chosen folder.",
    it: "Questa repository remota è già presente nel workspace. Puoi comunque collegare la cartella scelta.",
    fr: "Ce dépôt distant est déjà dans l’espace de travail. Vous pouvez tout de même lier le dossier choisi.",
    es: "Este repositorio remoto ya está en el espacio de trabajo. Aun así puedes vincular la carpeta elegida.",
    de: "Dieses Remote-Repository ist schon im Arbeitsbereich. Du kannst den gewählten Ordner trotzdem verknüpfen.",
  },
  "link.noAutomationBody": {
    en: "No commit will be created and no push will be run.",
    it: "Non verranno creati commit e non verrà eseguito alcun push.",
    fr: "Aucun commit ne sera créé et aucun push ne sera exécuté.",
    es: "No se crearán commits ni se ejecutará ningún push.",
    de: "Es wird kein Commit erstellt und kein Push ausgeführt.",
  },
  "link.footer": {
    en: "The operation starts only on final confirmation.",
    it: "L’operazione partirà solo con la conferma finale.",
    fr: "L’opération ne démarre qu’après confirmation finale.",
    es: "La operación empieza solo con la confirmación final.",
    de: "Der Vorgang startet erst nach der letzten Bestätigung.",
  },
  "link.confirm": {
    en: "Link folder", it: "Collega cartella", fr: "Lier le dossier",
    es: "Vincular carpeta", de: "Ordner verknüpfen",
  },
  "link.running": {
    en: "Linking…", it: "Collegamento…", fr: "Liaison…",
    es: "Vinculando…", de: "Verknüpfen…",
  },
  "link.failed": {
    en: "Linking failed", it: "Collegamento non riuscito", fr: "Échec de la liaison",
    es: "La vinculación falló", de: "Verknüpfen fehlgeschlagen",
  },
  "link.originConflict": {
    en: "The origin remote is already configured differently",
    it: "Il remote origin è già configurato diversamente",
    fr: "Le dépôt distant origin est déjà configuré différemment",
    es: "El remoto origin ya está configurado de otra manera",
    de: "Das origin-Remote ist bereits anders konfiguriert",
  },
  "link.originConflictBody": {
    en: "Check the existing remote in the folder and try again after resolving the conflict.",
    it: "Controlla il remote esistente nella cartella e riprova dopo aver risolto il conflitto.",
    fr: "Vérifiez le dépôt distant existant dans le dossier et réessayez après avoir résolu le conflit.",
    es: "Comprueba el remoto existente en la carpeta y vuelve a intentarlo tras resolver el conflicto.",
    de: "Prüfe das vorhandene Remote im Ordner und versuche es nach dem Lösen des Konflikts erneut.",
  },
  "link.doneEyebrow": {
    en: "Link complete", it: "Collegamento completato", fr: "Liaison terminée",
    es: "Vinculación completada", de: "Verknüpfung abgeschlossen",
  },
  "link.doneTitle": {
    en: "Folder ready", it: "Cartella pronta", fr: "Dossier prêt",
    es: "Carpeta lista", de: "Ordner bereit",
  },
  "link.alreadyLinked": {
    en: "Already linked", it: "Già collegata", fr: "Déjà liée",
    es: "Ya vinculada", de: "Bereits verknüpft",
  },
  "link.gitInitialised": {
    en: "Git initialised", it: "Git inizializzato", fr: "Git initialisé",
    es: "Git inicializado", de: "Git initialisiert",
  },
  "link.noCommitOrPush": {
    en: "No commit or push was run", it: "Nessun commit o push eseguito",
    fr: "Aucun commit ni push exécuté", es: "No se ejecutó ningún commit ni push",
    de: "Kein Commit und kein Push ausgeführt",
  },
  "link.doneBody": {
    en: "The folder was added to the workspace and selected. You decide when to create the first commit and send it.",
    it: "La cartella è stata aggiunta al workspace e selezionata. Decidi tu quando creare il primo commit e inviarlo.",
    fr: "Le dossier a été ajouté à l’espace de travail et sélectionné. Vous décidez quand créer le premier commit et l’envoyer.",
    es: "La carpeta se añadió al espacio de trabajo y quedó seleccionada. Tú decides cuándo crear el primer commit y enviarlo.",
    de: "Der Ordner wurde dem Arbeitsbereich hinzugefügt und ausgewählt. Du entscheidest, wann der erste Commit entsteht und gesendet wird.",
  },
  "link.stayOnGitHub": {
    en: "Stay on GitHub", it: "Resta su GitHub", fr: "Rester sur GitHub",
    es: "Quedarse en GitHub", de: "Auf GitHub bleiben",
  },

  // Backend, second group: the errors the commands raise on their own.
  "error.internalState": {
    en: "Internal state is unavailable.", it: "Lo stato interno non è disponibile.",
    fr: "L’état interne n’est pas disponible.", es: "El estado interno no está disponible.",
    de: "Der interne Zustand ist nicht verfügbar.",
  },
  "error.noRepositoryPath": {
    en: "No repository path given.", it: "Nessun percorso di repository indicato.",
    fr: "Aucun chemin de dépôt indiqué.", es: "No se ha indicado ninguna ruta de repositorio.",
    de: "Kein Repository-Pfad angegeben.",
  },
  "error.remoteUrlRequired": {
    en: "A URL is needed to configure the remote.",
    it: "Serve un URL per configurare il remote.",
    fr: "Une URL est nécessaire pour configurer le dépôt distant.",
    es: "Se necesita una URL para configurar el remoto.",
    de: "Für die Remote-Konfiguration wird eine URL benötigt.",
  },
  "error.repositoryNotAccessible": {
    en: "The GitHub repository is not reachable through the current installations.",
    it: "La repository GitHub non è accessibile tramite le installazioni correnti.",
    fr: "Le dépôt GitHub n’est pas accessible via les installations actuelles.",
    es: "El repositorio de GitHub no es accesible con las instalaciones actuales.",
    de: "Das GitHub-Repository ist über die aktuellen Installationen nicht erreichbar.",
  },
  "error.repositoryNotWritable": {
    en: "The GitHub repository is not writable, or it is archived or disabled.",
    it: "La repository GitHub non è scrivibile oppure è archiviata o disabilitata.",
    fr: "Le dépôt GitHub n’est pas accessible en écriture, ou il est archivé ou désactivé.",
    es: "El repositorio de GitHub no admite escritura, o está archivado o deshabilitado.",
    de: "Das GitHub-Repository ist nicht beschreibbar oder es ist archiviert bzw. deaktiviert.",
  },
  "error.cloneUrlMismatch": {
    en: "The clone URL does not match the one GitHub returned for the repository.",
    it: "L’URL clone non corrisponde a quello restituito da GitHub per la repository.",
    fr: "L’URL de clonage ne correspond pas à celle renvoyée par GitHub pour le dépôt.",
    es: "La URL de clonado no coincide con la que GitHub devolvió para el repositorio.",
    de: "Die Klon-URL stimmt nicht mit der von GitHub gelieferten überein.",
  },
  "error.invalidPath": {
    en: "Invalid path ‘{path}’: {reason}", it: "Percorso non valido ‘{path}’: {reason}",
    fr: "Chemin invalide « {path} » : {reason}", es: "Ruta no válida «{path}»: {reason}",
    de: "Ungültiger Pfad „{path}“: {reason}",
  },
  "error.folderUnreadable": {
    en: "The folder could not be opened: {reason}",
    it: "Impossibile aprire la cartella: {reason}",
    fr: "Impossible d’ouvrir le dossier : {reason}",
    es: "No se ha podido abrir la carpeta: {reason}",
    de: "Der Ordner konnte nicht geöffnet werden: {reason}",
  },
  "error.repositoryPathNotText": {
    en: "The repository path cannot be represented as text: {path}",
    it: "Il percorso della repository non è rappresentabile come testo: {path}",
    fr: "Le chemin du dépôt ne peut pas être représenté sous forme de texte : {path}",
    es: "La ruta del repositorio no se puede representar como texto: {path}",
    de: "Der Repository-Pfad lässt sich nicht als Text darstellen: {path}",
  },
  "error.folderPathNotText": {
    en: "The folder path cannot be represented as text: {path}",
    it: "Il percorso della cartella non è rappresentabile come testo: {path}",
    fr: "Le chemin du dossier ne peut pas être représenté sous forme de texte : {path}",
    es: "La ruta de la carpeta no se puede representar como texto: {path}",
    de: "Der Ordnerpfad lässt sich nicht als Text darstellen: {path}",
  },
  "error.operationInterrupted": {
    en: "The internal operation was interrupted: {reason}",
    it: "Operazione interna interrotta: {reason}",
    fr: "L’opération interne a été interrompue : {reason}",
    es: "La operación interna se ha interrumpido: {reason}",
    de: "Der interne Vorgang wurde unterbrochen: {reason}",
  },
  // The outcome of a link, built in the frontend rather than by the backend:
  // the three cases are already known here, from the result's own fields.
  "link.resultAlreadyLinked": {
    en: "The folder was already linked to the selected GitHub repository.",
    it: "La cartella era già collegata alla repository GitHub selezionata.",
    fr: "Le dossier était déjà lié au dépôt GitHub sélectionné.",
    es: "La carpeta ya estaba enlazada con el repositorio de GitHub seleccionado.",
    de: "Der Ordner war bereits mit dem gewählten GitHub-Repository verknüpft.",
  },
  "link.resultInitialised": {
    en: "Git repository initialised and GitHub remote configured.",
    it: "Repository Git inizializzata e remote GitHub configurato.",
    fr: "Dépôt Git initialisé et dépôt distant GitHub configuré.",
    es: "Repositorio Git inicializado y remoto de GitHub configurado.",
    de: "Git-Repository initialisiert und GitHub-Remote konfiguriert.",
  },
  "link.resultConfigured": {
    en: "GitHub remote configured on the local repository.",
    it: "Remote GitHub configurato sulla repository locale.",
    fr: "Dépôt distant GitHub configuré sur le dépôt local.",
    es: "Remoto de GitHub configurado en el repositorio local.",
    de: "GitHub-Remote im lokalen Repository konfiguriert.",
  },
  "link.remoteConfiguredAs": {
    en: "Remote configured as {name}", it: "Remote configurato come {name}",
    fr: "Dépôt distant configuré comme {name}", es: "Remoto configurado como {name}",
    de: "Remote als {name} konfiguriert",
  },

  // The dashboard: banners, toolbar and the empty states.
  "app.browserBannerTitle": {
    en: "Browser preview.", it: "Anteprima browser.", fr: "Aperçu navigateur.",
    es: "Vista previa del navegador.", de: "Browser-Vorschau.",
  },
  "app.browserBannerBody": {
    en: "You are looking at demo data; scanning, Git commands and GitHub sign-in are disabled. Run",
    it: "Stai visualizzando dati dimostrativi; scansione, comandi Git e accesso GitHub sono disattivati. Avvia",
    fr: "Vous consultez des données de démonstration ; l’analyse, les commandes Git et la connexion GitHub sont désactivées. Lancez",
    es: "Estás viendo datos de demostración; el análisis, los comandos de Git y el acceso a GitHub están desactivados. Ejecuta",
    de: "Sie sehen Demodaten; Scan, Git-Befehle und GitHub-Anmeldung sind deaktiviert. Führen Sie",
  },
  "app.browserBannerTail": {
    en: "to work with the local repositories.",
    it: "per usare le repository locali.",
    fr: "pour utiliser les dépôts locaux.",
    es: "para usar los repositorios locales.",
    de: "aus, um die lokalen Repositorys zu verwenden.",
  },
  "app.scanWarningsTitle": {
    en: "Scan finished with {count} warnings",
    it: "Scansione completata con {count} avvisi",
    fr: "Analyse terminée avec {count} avertissements",
    es: "Análisis terminado con {count} avisos",
    de: "Scan mit {count} Warnungen abgeschlossen",
  },
  "app.scanWarningsMore": {
    en: "{count} more", it: "Altri {count}", fr: "{count} de plus",
    es: "{count} más", de: "{count} weitere",
  },
  "app.hideWarnings": {
    en: "Hide the warnings", it: "Nascondi avvisi", fr: "Masquer les avertissements",
    es: "Ocultar los avisos", de: "Warnungen ausblenden",
  },
  "app.searchRepositories": {
    en: "Search repositories", it: "Cerca repository", fr: "Rechercher des dépôts",
    es: "Buscar repositorios", de: "Repositorys suchen",
  },
  "app.cancelRunningTitle": {
    en: "Stops the running operation and skips the repositories not processed yet",
    it: "Interrompe l’operazione in corso e salta le repository non ancora elaborate",
    fr: "Arrête l’opération en cours et ignore les dépôts pas encore traités",
    es: "Detiene la operación en curso y omite los repositorios aún no procesados",
    de: "Bricht den laufenden Vorgang ab und überspringt noch nicht verarbeitete Repositorys",
  },
  "app.cancelling": {
    en: "Stopping…", it: "Interruzione…", fr: "Arrêt…", es: "Deteniendo…", de: "Wird abgebrochen…",
  },
  "app.cancelRunning": {
    en: "Stop", it: "Interrompi", fr: "Arrêter", es: "Detener", de: "Abbrechen",
  },
  "app.emptyTitle": {
    en: "No repository in the workspace", it: "Nessuna repository nel workspace",
    fr: "Aucun dépôt dans l’espace de travail", es: "Ningún repositorio en el espacio de trabajo",
    de: "Kein Repository im Arbeitsbereich",
  },
  "app.emptyBody": {
    en: "Choose a folder: we will look for Git repositories in its subfolders.",
    it: "Scegli una cartella: cercheremo le repository Git nelle sue sottocartelle.",
    fr: "Choisissez un dossier : nous chercherons les dépôts Git dans ses sous-dossiers.",
    es: "Elige una carpeta: buscaremos repositorios Git en sus subcarpetas.",
    de: "Wählen Sie einen Ordner: Wir suchen in seinen Unterordnern nach Git-Repositorys.",
  },
  "app.noResultsTitle": {
    en: "No result", it: "Nessun risultato", fr: "Aucun résultat",
    es: "Ningún resultado", de: "Kein Ergebnis",
  },
  "app.noResultsBody": {
    en: "Try changing the search or the filter.",
    it: "Prova a cambiare ricerca o filtro.",
    fr: "Essayez de changer la recherche ou le filtre.",
    es: "Prueba a cambiar la búsqueda o el filtro.",
    de: "Ändern Sie die Suche oder den Filter.",
  },
  "app.syncTitle": {
    en: "Runs a check fetch first", it: "Esegue prima un fetch di controllo",
    fr: "Effectue d’abord un fetch de contrôle", es: "Ejecuta antes un fetch de comprobación",
    de: "Führt zuerst einen Kontroll-Fetch aus",
  },
  "app.checking": {
    en: "Checking…", it: "Verifica…", fr: "Vérification…",
    es: "Comprobando…", de: "Wird geprüft…",
  },
  "app.closeToast": {
    en: "Close the notification", it: "Chiudi notifica", fr: "Fermer la notification",
    es: "Cerrar la notificación", de: "Benachrichtigung schließen",
  },

  "activity.outputTruncated": {
    en: "… output truncated …", it: "… output troncato …",
    fr: "… sortie tronquée …", es: "… salida truncada …",
    de: "… Ausgabe gekürzt …",
  },

  // Refusals raised while linking a folder to a GitHub repository. Linking may
  // run `git init`, so each refusal says what was found and what was left alone.
  "link.originConflictError": {
    en: "The repository already has a different origin remote. No configuration was changed.",
    it: "La repository contiene già un remote origin diverso. Nessuna configurazione è stata modificata.",
    fr: "Le dépôt a déjà un dépôt distant origin différent. Aucune configuration n’a été modifiée.",
    es: "El repositorio ya tiene un remoto origin distinto. No se ha modificado ninguna configuración.",
    de: "Das Repository hat bereits ein anderes origin-Remote. Es wurde keine Konfiguration geändert.",
  },
  "link.folderUnreadable": {
    en: "The folder ‘{path}’ could not be opened: {reason}",
    it: "Impossibile aprire la cartella ‘{path}’: {reason}",
    fr: "Impossible d’ouvrir le dossier « {path} » : {reason}",
    es: "No se ha podido abrir la carpeta «{path}»: {reason}",
    de: "Der Ordner „{path}“ konnte nicht geöffnet werden: {reason}",
  },
  "link.notAFolder": {
    en: "The chosen path is not a folder: {path}",
    it: "Il percorso selezionato non è una cartella: {path}",
    fr: "Le chemin choisi n’est pas un dossier : {path}",
    es: "La ruta elegida no es una carpeta: {path}",
    de: "Der gewählte Pfad ist kein Ordner: {path}",
  },
  "link.rootNotAllowed": {
    en: "The root of the filesystem or of the volume cannot be linked as a repository.",
    it: "La radice del filesystem o del volume non può essere collegata come repository.",
    fr: "La racine du système de fichiers ou du volume ne peut pas être liée comme dépôt.",
    es: "La raíz del sistema de archivos o del volumen no se puede enlazar como repositorio.",
    de: "Die Wurzel des Dateisystems oder des Volumes kann nicht als Repository verknüpft werden.",
  },
  "link.metadataUnreadable": {
    en: "The Git metadata of the folder could not be checked: {reason}",
    it: "Impossibile verificare i metadati Git della cartella: {reason}",
    fr: "Impossible de vérifier les métadonnées Git du dossier : {reason}",
    es: "No se han podido comprobar los metadatos de Git de la carpeta: {reason}",
    de: "Die Git-Metadaten des Ordners konnten nicht geprüft werden: {reason}",
  },
  "link.onlyPlainGitDirectory": {
    en: "Linking supports only repositories with a plain local .git directory; worktrees, submodules, symlinks and junctions are excluded.",
    it: "Il collegamento supporta solo repository con una directory .git locale normale; worktree, submodule, symlink e junction sono esclusi.",
    fr: "La liaison ne prend en charge que les dépôts avec un répertoire .git local ordinaire ; worktrees, sous-modules, liens symboliques et jonctions sont exclus.",
    es: "El enlace solo admite repositorios con un directorio .git local normal; worktrees, submódulos, enlaces simbólicos y uniones quedan excluidos.",
    de: "Die Verknüpfung unterstützt nur Repositorys mit einem einfachen lokalen .git-Verzeichnis; Worktrees, Submodule, Symlinks und Junctions sind ausgeschlossen.",
  },
  "link.belongsToParent": {
    en: "The chosen folder already belongs to the parent repository ‘{repository}’. Select the repository root.",
    it: "La cartella selezionata appartiene già alla repository padre ‘{repository}’. Seleziona la root della repository.",
    fr: "Le dossier choisi appartient déjà au dépôt parent « {repository} ». Sélectionnez la racine du dépôt.",
    es: "La carpeta elegida ya pertenece al repositorio padre «{repository}». Selecciona la raíz del repositorio.",
    de: "Der gewählte Ordner gehört bereits zum übergeordneten Repository „{repository}“. Wählen Sie die Repository-Wurzel.",
  },
  "link.brokenGitMetadata": {
    en: "The folder already has .git metadata, but it is not a valid Git repository: {path}",
    it: "La cartella contiene già metadati .git, ma non è una repository Git valida: {path}",
    fr: "Le dossier contient déjà des métadonnées .git, mais ce n’est pas un dépôt Git valide : {path}",
    es: "La carpeta ya contiene metadatos .git, pero no es un repositorio Git válido: {path}",
    de: "Der Ordner enthält bereits .git-Metadaten, ist aber kein gültiges Git-Repository: {path}",
  },
  "link.insideRepository": {
    en: "The chosen folder is inside the repository ‘{repository}’. Creating a nested repository was blocked.",
    it: "La cartella selezionata è interna alla repository ‘{repository}’. La creazione di una repository annidata è stata bloccata.",
    fr: "Le dossier choisi se trouve dans le dépôt « {repository} ». La création d’un dépôt imbriqué a été bloquée.",
    es: "La carpeta elegida está dentro del repositorio «{repository}». Se ha bloqueado la creación de un repositorio anidado.",
    de: "Der gewählte Ordner liegt im Repository „{repository}“. Das Anlegen eines verschachtelten Repositorys wurde blockiert.",
  },
  "link.initNoVerifiableMetadata": {
    en: "Git init did not create verifiable .git metadata: {reason}",
    it: "Git init non ha creato metadati .git verificabili: {reason}",
    fr: "Git init n’a pas créé de métadonnées .git vérifiables : {reason}",
    es: "Git init no ha creado metadatos .git verificables: {reason}",
    de: "Git init hat keine überprüfbaren .git-Metadaten erzeugt: {reason}",
  },
  "link.initUnsafeMetadata": {
    en: "Git init created .git metadata that is not local or not safe; linking was stopped.",
    it: "Git init ha creato metadati .git non locali o non sicuri; il collegamento è stato interrotto.",
    fr: "Git init a créé des métadonnées .git non locales ou non sûres ; la liaison a été interrompue.",
    es: "Git init ha creado metadatos .git no locales o no seguros; el enlace se ha interrumpido.",
    de: "Git init hat nicht lokale oder unsichere .git-Metadaten erzeugt; die Verknüpfung wurde abgebrochen.",
  },
  "link.initNoRepository": {
    en: "Git init finished without creating a valid repository.",
    it: "Git init è terminato senza creare una repository valida.",
    fr: "Git init s’est terminé sans créer de dépôt valide.",
    es: "Git init ha terminado sin crear un repositorio válido.",
    de: "Git init endete, ohne ein gültiges Repository zu erstellen.",
  },
  "link.initUnexpectedLocation": {
    en: "Git initialised a repository in an unexpected location: {path}",
    it: "Git ha inizializzato una repository in una posizione inattesa: {path}",
    fr: "Git a initialisé un dépôt à un emplacement inattendu : {path}",
    es: "Git ha inicializado un repositorio en una ubicación inesperada: {path}",
    de: "Git hat ein Repository an einer unerwarteten Stelle initialisiert: {path}",
  },
  "link.remoteFailed": {
    en: "The origin remote could not be added: {reason}",
    it: "Impossibile aggiungere il remote origin: {reason}",
    fr: "Impossible d’ajouter le dépôt distant origin : {reason}",
    es: "No se ha podido añadir el remoto origin: {reason}",
    de: "Das origin-Remote konnte nicht hinzugefügt werden: {reason}",
  },
  "link.remoteFailedRolledBack": {
    en: "The origin remote could not be added: {reason}. The Git initialisation was undone.",
    it: "Impossibile aggiungere il remote origin: {reason}. L’inizializzazione Git è stata annullata.",
    fr: "Impossible d’ajouter le dépôt distant origin : {reason}. L’initialisation Git a été annulée.",
    es: "No se ha podido añadir el remoto origin: {reason}. La inicialización de Git se ha deshecho.",
    de: "Das origin-Remote konnte nicht hinzugefügt werden: {reason}. Die Git-Initialisierung wurde rückgängig gemacht.",
  },
  "link.remoteFailedNotRolledBack": {
    en: "The origin remote could not be added: {reason}. The freshly created .git folder was left in place because the rollback was not verifiably safe.",
    it: "Impossibile aggiungere il remote origin: {reason}. La cartella .git appena creata non è stata rimossa perché il rollback non era verificabilmente sicuro.",
    fr: "Impossible d’ajouter le dépôt distant origin : {reason}. Le dossier .git tout juste créé a été laissé en place car l’annulation n’était pas vérifiablement sûre.",
    es: "No se ha podido añadir el remoto origin: {reason}. La carpeta .git recién creada se ha dejado tal cual porque la reversión no era verificablemente segura.",
    de: "Das origin-Remote konnte nicht hinzugefügt werden: {reason}. Der eben erstellte .git-Ordner blieb bestehen, weil das Zurückrollen nicht nachweislich sicher war.",
  },
  "link.remoteFailedRollbackFailed": {
    en: "The origin remote could not be added: {reason}. Git had already been initialised and the safe rollback failed: {rollbackReason}",
    it: "Impossibile aggiungere il remote origin: {reason}. Git era già stato inizializzato e il rollback sicuro non è riuscito: {rollbackReason}",
    fr: "Impossible d’ajouter le dépôt distant origin : {reason}. Git avait déjà été initialisé et l’annulation sûre a échoué : {rollbackReason}",
    es: "No se ha podido añadir el remoto origin: {reason}. Git ya se había inicializado y la reversión segura ha fallado: {rollbackReason}",
    de: "Das origin-Remote konnte nicht hinzugefügt werden: {reason}. Git war bereits initialisiert und das sichere Zurückrollen schlug fehl: {rollbackReason}",
  },

  // Refusals raised while validating a file selection. The last four used to be
  // one sentence with a swappable fragment — which forces every language into
  // the word order of the original. They are four whole sentences now.
  "files.selectAtLeastOne": {
    en: "Select at least one file.", it: "Seleziona almeno un file.",
    fr: "Sélectionnez au moins un fichier.", es: "Selecciona al menos un archivo.",
    de: "Wählen Sie mindestens eine Datei aus.",
  },
  "files.tooMany": {
    en: "Too many files were selected. Work in groups of at most {limit}.",
    it: "Sono stati selezionati troppi file. Procedi con gruppi di massimo {limit}.",
    fr: "Trop de fichiers sélectionnés. Procédez par groupes de {limit} au maximum.",
    es: "Se han seleccionado demasiados archivos. Ve en grupos de {limit} como máximo.",
    de: "Zu viele Dateien ausgewählt. Arbeiten Sie in Gruppen von höchstens {limit}.",
  },
  "files.invalidPathInSelection": {
    en: "The selection contains an invalid path.",
    it: "La selezione contiene un percorso non valido.",
    fr: "La sélection contient un chemin invalide.",
    es: "La selección contiene una ruta no válida.",
    de: "Die Auswahl enthält einen ungültigen Pfad.",
  },
  "files.duplicateSelection": {
    en: "The file ‘{file}’ was selected more than once.",
    it: "Il file ‘{file}’ è stato selezionato più volte.",
    fr: "Le fichier « {file} » a été sélectionné plusieurs fois.",
    es: "El archivo «{file}» se ha seleccionado más de una vez.",
    de: "Die Datei „{file}“ wurde mehrfach ausgewählt.",
  },
  "files.selectionTooLarge": {
    en: "The selection exceeds the limit of the Git command. Select fewer files and try again.",
    it: "La selezione supera il limite del comando Git. Seleziona meno file e riprova.",
    fr: "La sélection dépasse la limite de la commande Git. Sélectionnez moins de fichiers et réessayez.",
    es: "La selección supera el límite del comando de Git. Selecciona menos archivos y vuelve a intentarlo.",
    de: "Die Auswahl überschreitet das Limit des Git-Befehls. Wählen Sie weniger Dateien und versuchen Sie es erneut.",
  },
  "files.noLongerChanged": {
    en: "The file ‘{file}’ is no longer reported as changed. Refresh the repository and try again.",
    it: "Il file ‘{file}’ non risulta più modificato. Aggiorna la repository e riprova.",
    fr: "Le fichier « {file} » n’apparaît plus comme modifié. Actualisez le dépôt et réessayez.",
    es: "El archivo «{file}» ya no aparece como modificado. Actualiza el repositorio y vuelve a intentarlo.",
    de: "Die Datei „{file}“ gilt nicht mehr als geändert. Aktualisieren Sie das Repository und versuchen Sie es erneut.",
  },
  "files.nothingToStage": {
    en: "The file ‘{file}’ has no changes that can be staged.",
    it: "Il file ‘{file}’ non contiene modifiche preparabili.",
    fr: "Le fichier « {file} » n’a aucune modification indexable.",
    es: "El archivo «{file}» no tiene cambios que se puedan preparar.",
    de: "Die Datei „{file}“ hat keine vormerkbaren Änderungen.",
  },
  "files.notStaged": {
    en: "The file ‘{file}’ is not staged.", it: "Il file ‘{file}’ non è presente nello staging.",
    fr: "Le fichier « {file} » n’est pas indexé.", es: "El archivo «{file}» no está preparado.",
    de: "Die Datei „{file}“ ist nicht vorgemerkt.",
  },
  "files.nothingToDiscard": {
    en: "The file ‘{file}’ has no unstaged changes to discard.",
    it: "Il file ‘{file}’ non contiene modifiche non staged annullabili.",
    fr: "Le fichier « {file} » n’a aucune modification non indexée à annuler.",
    es: "El archivo «{file}» no tiene cambios sin preparar que descartar.",
    de: "Die Datei „{file}“ hat keine nicht vorgemerkten Änderungen zum Verwerfen.",
  },
  "files.notValidForOperation": {
    en: "The file ‘{file}’ is not valid for this operation.",
    it: "Il file ‘{file}’ non è valido per questa operazione.",
    fr: "Le fichier « {file} » n’est pas valide pour cette opération.",
    es: "El archivo «{file}» no es válido para esta operación.",
    de: "Die Datei „{file}“ ist für diesen Vorgang nicht gültig.",
  },

  // Discarding a new file deletes it from disk with no Git history to fall back
  // on, so every refusal here says exactly what was not deleted, and why.
  "discard.unsafeNewFilePath": {
    en: "The path of the new file is not safe and was not deleted: ‘{path}’.",
    it: "Il percorso del file nuovo non è sicuro e non è stato eliminato: ‘{path}’.",
    fr: "Le chemin du nouveau fichier n’est pas sûr et n’a pas été supprimé : « {path} ».",
    es: "La ruta del archivo nuevo no es segura y no se ha eliminado: «{path}».",
    de: "Der Pfad der neuen Datei ist nicht sicher und wurde nicht gelöscht: „{path}“.",
  },
  "discard.noValidParent": {
    en: "The path ‘{path}’ has no valid folder.",
    it: "Il percorso ‘{path}’ non ha una cartella valida.",
    fr: "Le chemin « {path} » n’a pas de dossier valide.",
    es: "La ruta «{path}» no tiene una carpeta válida.",
    de: "Der Pfad „{path}“ hat keinen gültigen Ordner.",
  },
  "discard.parentUnreadable": {
    en: "The folder of the new file ‘{path}’ is not accessible: {reason}",
    it: "La cartella del file nuovo ‘{path}’ non è accessibile: {reason}",
    fr: "Le dossier du nouveau fichier « {path} » n’est pas accessible : {reason}",
    es: "La carpeta del archivo nuevo «{path}» no es accesible: {reason}",
    de: "Der Ordner der neuen Datei „{path}“ ist nicht zugänglich: {reason}",
  },
  "discard.outsideRepository": {
    en: "The new file ‘{path}’ points outside the repository and was not deleted.",
    it: "Il file nuovo ‘{path}’ punta fuori dalla repository e non è stato eliminato.",
    fr: "Le nouveau fichier « {path} » pointe hors du dépôt et n’a pas été supprimé.",
    es: "El archivo nuevo «{path}» apunta fuera del repositorio y no se ha eliminado.",
    de: "Die neue Datei „{path}“ zeigt außerhalb des Repositorys und wurde nicht gelöscht.",
  },
  "discard.fileGone": {
    en: "The new file ‘{path}’ is no longer accessible: {reason}",
    it: "Il file nuovo ‘{path}’ non è più accessibile: {reason}",
    fr: "Le nouveau fichier « {path} » n’est plus accessible : {reason}",
    es: "El archivo nuevo «{path}» ya no es accesible: {reason}",
    de: "Die neue Datei „{path}“ ist nicht mehr zugänglich: {reason}",
  },
  "discard.untrackedDirectory": {
    en: "The untracked folder ‘{path}’ was not deleted. Remove nested folders and repositories by hand.",
    it: "La cartella non tracciata ‘{path}’ non è stata eliminata. Rimuovi manualmente cartelle e repository annidate.",
    fr: "Le dossier non suivi « {path} » n’a pas été supprimé. Supprimez à la main les dossiers et dépôts imbriqués.",
    es: "La carpeta sin seguimiento «{path}» no se ha eliminado. Elimina a mano las carpetas y repositorios anidados.",
    de: "Der nicht verfolgte Ordner „{path}“ wurde nicht gelöscht. Entfernen Sie verschachtelte Ordner und Repositorys von Hand.",
  },
  "discard.specialPath": {
    en: "The special path ‘{path}’ was not deleted.",
    it: "Il percorso speciale ‘{path}’ non è stato eliminato.",
    fr: "Le chemin spécial « {path} » n’a pas été supprimé.",
    es: "La ruta especial «{path}» no se ha eliminado.",
    de: "Der spezielle Pfad „{path}“ wurde nicht gelöscht.",
  },
  "discard.deleteFailed": {
    en: "‘{path}’ could not be deleted: {reason}",
    it: "Impossibile eliminare ‘{path}’: {reason}",
    fr: "Impossible de supprimer « {path} » : {reason}",
    es: "No se ha podido eliminar «{path}»: {reason}",
    de: "„{path}“ konnte nicht gelöscht werden: {reason}",
  },
  "discard.partiallyDone": {
    en: "{completed} files were already restored or deleted, but the operation did not finish: {reason}",
    it: "{completed} file sono già stati ripristinati o eliminati, ma l’operazione non è stata completata: {reason}",
    fr: "{completed} fichiers ont déjà été restaurés ou supprimés, mais l’opération ne s’est pas terminée : {reason}",
    es: "{completed} archivos ya se han restaurado o eliminado, pero la operación no ha terminado: {reason}",
    de: "{completed} Dateien wurden bereits wiederhergestellt oder gelöscht, aber der Vorgang wurde nicht abgeschlossen: {reason}",
  },

  // Stash and conflict refusals, read in the repository tools dialog.
  "stash.createFailed": {
    en: "The stash could not be created: {reason}",
    it: "Creazione dello stash non riuscita: {reason}",
    fr: "Le stash n’a pas pu être créé : {reason}",
    es: "No se ha podido crear el stash: {reason}",
    de: "Der Stash konnte nicht erstellt werden: {reason}",
  },
  "stash.nothingToStash": {
    en: "There is nothing to put aside.", it: "Non c’è niente da mettere da parte.",
    fr: "Il n’y a rien à mettre de côté.", es: "No hay nada que guardar.",
    de: "Es gibt nichts zum Beiseitelegen.",
  },
  "stash.invalidMessage": {
    en: "Invalid stash message.", it: "Messaggio dello stash non valido.",
    fr: "Message de stash invalide.", es: "Mensaje del stash no válido.",
    de: "Ungültige Stash-Nachricht.",
  },
  "stash.changedSinceLoad": {
    en: "The stash list changed since it was loaded. Refresh it and try again.",
    it: "L’elenco degli stash è cambiato da quando è stato caricato. Aggiornalo e riprova.",
    fr: "La liste des stash a changé depuis son chargement. Actualisez-la et réessayez.",
    es: "La lista de stashes ha cambiado desde que se cargó. Actualízala e inténtalo de nuevo.",
    de: "Die Stash-Liste hat sich seit dem Laden geändert. Aktualisieren Sie sie und versuchen Sie es erneut.",
  },
  "stash.appliedButKept": {
    en: "The changes were applied, but the stash entry was kept because it could not be removed safely. Refresh the list before trying again.",
    it: "Le modifiche sono state applicate, ma la voce di stash è stata conservata perché non poteva essere rimossa in sicurezza. Aggiorna l’elenco prima di riprovare.",
    fr: "Les modifications ont été appliquées, mais l’entrée de stash a été conservée car elle ne pouvait pas être supprimée en toute sécurité. Actualisez la liste avant de réessayer.",
    es: "Los cambios se han aplicado, pero la entrada del stash se ha conservado porque no se podía eliminar de forma segura. Actualiza la lista antes de volver a intentarlo.",
    de: "Die Änderungen wurden angewendet, aber der Stash-Eintrag wurde beibehalten, weil er nicht sicher entfernt werden konnte. Aktualisieren Sie die Liste, bevor Sie es erneut versuchen.",
  },
  "conflict.nothingPending": {
    en: "There is no operation to finish.", it: "Non c’è nessuna operazione da concludere.",
    fr: "Il n’y a aucune opération à terminer.", es: "No hay ninguna operación que concluir.",
    de: "Es gibt keinen Vorgang zum Abschließen.",
  },
  "conflict.stillConflicted": {
    en: "There are still conflicted files: resolve them and stage them before continuing.",
    it: "Ci sono ancora file in conflitto: risolvili e mettili in stage prima di continuare.",
    fr: "Il reste des fichiers en conflit : résolvez-les et indexez-les avant de continuer.",
    es: "Todavía hay archivos en conflicto: resuélvelos y prepáralos antes de continuar.",
    de: "Es gibt noch Dateien mit Konflikten: Lösen und merken Sie sie vor, bevor Sie fortfahren.",
  },

  // Refusals raised before a clone starts. They are read in the clone dialog,
  // where the user can still change the answer.
  "clone.parentUnreadable": {
    en: "The folder ‘{path}’ could not be opened: {reason}",
    it: "Impossibile aprire la cartella ‘{path}’: {reason}",
    fr: "Impossible d’ouvrir le dossier « {path} » : {reason}",
    es: "No se ha podido abrir la carpeta «{path}»: {reason}",
    de: "Der Ordner „{path}“ konnte nicht geöffnet werden: {reason}",
  },
  "clone.destinationNotFolder": {
    en: "The destination is not a folder: {path}",
    it: "La destinazione non è una cartella: {path}",
    fr: "La destination n’est pas un dossier : {path}",
    es: "El destino no es una carpeta: {path}",
    de: "Das Ziel ist kein Ordner: {path}",
  },
  "clone.parentIsRepository": {
    en: "The chosen folder is already a Git repository: {path}. Choose one that is not.",
    it: "La cartella scelta è già una repository Git: {path}. Scegline una che non lo sia.",
    fr: "Le dossier choisi est déjà un dépôt Git : {path}. Choisissez-en un qui ne l’est pas.",
    es: "La carpeta elegida ya es un repositorio Git: {path}. Elige una que no lo sea.",
    de: "Der gewählte Ordner ist bereits ein Git-Repository: {path}. Wählen Sie einen anderen.",
  },
  "clone.parentInsideRepository": {
    en: "The chosen folder is inside the repository ‘{repository}’. Choose one outside it.",
    it: "La cartella scelta è interna alla repository ‘{repository}’. Scegline una fuori.",
    fr: "Le dossier choisi se trouve dans le dépôt « {repository} ». Choisissez-en un à l’extérieur.",
    es: "La carpeta elegida está dentro del repositorio «{repository}». Elige una fuera.",
    de: "Der gewählte Ordner liegt im Repository „{repository}“. Wählen Sie einen außerhalb.",
  },
  "clone.parentMetadataUnreadable": {
    en: "The Git metadata of the parent folder ‘{path}’ could not be checked: {reason}",
    it: "Impossibile verificare i metadati Git della cartella padre ‘{path}’: {reason}",
    fr: "Impossible de vérifier les métadonnées Git du dossier parent « {path} » : {reason}",
    es: "No se han podido comprobar los metadatos de Git de la carpeta padre «{path}»: {reason}",
    de: "Die Git-Metadaten des übergeordneten Ordners „{path}“ konnten nicht geprüft werden: {reason}",
  },
  "clone.nameTaken": {
    en: "‘{name}’ already exists in this folder: choose another name.",
    it: "Esiste già ‘{name}’ in questa cartella: scegli un altro nome.",
    fr: "« {name} » existe déjà dans ce dossier : choisissez un autre nom.",
    es: "Ya existe «{name}» en esta carpeta: elige otro nombre.",
    de: "„{name}“ existiert in diesem Ordner bereits: Wählen Sie einen anderen Namen.",
  },
  "clone.folderNameInvalid": {
    en: "Invalid folder name: use a simple name, with no path separators.",
    it: "Nome della cartella non valido: usa un nome semplice, senza separatori di percorso.",
    fr: "Nom de dossier invalide : utilisez un nom simple, sans séparateurs de chemin.",
    es: "Nombre de carpeta no válido: usa un nombre simple, sin separadores de ruta.",
    de: "Ungültiger Ordnername: Verwenden Sie einen einfachen Namen ohne Pfadtrennzeichen.",
  },
  "clone.destinationNameInvalid": {
    en: "The destination folder name is not valid.",
    it: "Il nome della cartella di destinazione non è valido.",
    fr: "Le nom du dossier de destination n’est pas valide.",
    es: "El nombre de la carpeta de destino no es válido.",
    de: "Der Name des Zielordners ist nicht gültig.",
  },
  "clone.noUsableFolder": {
    en: "The clone did not produce a usable folder: {reason}",
    it: "Il clone non ha prodotto una cartella utilizzabile: {reason}",
    fr: "Le clonage n’a pas produit de dossier utilisable : {reason}",
    es: "El clonado no ha producido una carpeta utilizable: {reason}",
    de: "Der Klon hat keinen nutzbaren Ordner erzeugt: {reason}",
  },

  // Operation outcomes, read in the activity log after every batch. They travel
  // in `OperationResult.messageId`, beside the English sentence.
  "outcome.unavailable": {
    en: "The repository is no longer reachable: {reason}",
    it: "Repository non più raggiungibile: {reason}",
    fr: "Le dépôt n’est plus accessible : {reason}",
    es: "El repositorio ya no es accesible: {reason}",
    de: "Das Repository ist nicht mehr erreichbar: {reason}",
  },
  "outcome.cancelled": {
    en: "The operation was cancelled before it reached this repository.",
    it: "Operazione annullata prima di raggiungere questa repository.",
    fr: "L’opération a été annulée avant d’atteindre ce dépôt.",
    es: "La operación se canceló antes de llegar a este repositorio.",
    de: "Der Vorgang wurde abgebrochen, bevor er dieses Repository erreichte.",
  },
  "outcome.emptyCommitMessage": {
    en: "The commit message is empty.", it: "Il messaggio di commit è vuoto.",
    fr: "Le message de commit est vide.", es: "El mensaje del commit está vacío.",
    de: "Die Commit-Nachricht ist leer.",
  },
  "outcome.hasConflicts": {
    en: "The repository has conflicts to resolve.",
    it: "La repository contiene conflitti da risolvere.",
    fr: "Le dépôt contient des conflits à résoudre.",
    es: "El repositorio tiene conflictos por resolver.",
    de: "Das Repository enthält zu lösende Konflikte.",
  },
  "outcome.nothingStaged": {
    en: "No file is staged. Turn on the explicit inclusion of every change, or stage the files with Git.",
    it: "Nessun file è nello staging. Abilita l’inclusione esplicita di tutte le modifiche oppure prepara i file con Git.",
    fr: "Aucun fichier n’est indexé. Activez l’inclusion explicite de toutes les modifications, ou indexez les fichiers avec Git.",
    es: "No hay ningún archivo preparado. Activa la inclusión explícita de todos los cambios, o prepara los archivos con Git.",
    de: "Keine Datei ist vorgemerkt. Aktivieren Sie das ausdrückliche Einbeziehen aller Änderungen, oder merken Sie die Dateien mit Git vor.",
  },
  "outcome.alreadyUpToDate": {
    en: "The repository is already up to date.", it: "La repository è già aggiornata.",
    fr: "Le dépôt est déjà à jour.", es: "El repositorio ya está actualizado.",
    de: "Das Repository ist bereits aktuell.",
  },
  "outcome.pullDiverged": {
    en: "Pull blocked: the local and remote branches have diverged. Choose merge or rebase.",
    it: "Pull bloccato: il branch locale e quello remoto sono divergenti. Scegli merge o rebase.",
    fr: "Pull bloqué : les branches locale et distante ont divergé. Choisissez merge ou rebase.",
    es: "Pull bloqueado: las ramas local y remota han divergido. Elige merge o rebase.",
    de: "Pull blockiert: Der lokale und der entfernte Branch sind auseinandergelaufen. Wählen Sie Merge oder Rebase.",
  },
  "outcome.pushBehind": {
    en: "Push blocked: the remote branch has commits that are missing locally.",
    it: "Push bloccato: il branch remoto contiene commit mancanti localmente.",
    fr: "Push bloqué : la branche distante contient des commits absents en local.",
    es: "Push bloqueado: la rama remota tiene commits que faltan en local.",
    de: "Push blockiert: Der entfernte Branch enthält Commits, die lokal fehlen.",
  },
  "outcome.upstreamUnsafe": {
    en: "The upstream configuration could not be resolved safely.",
    it: "Impossibile risolvere in modo sicuro la configurazione upstream.",
    fr: "La configuration upstream n’a pas pu être résolue en toute sécurité.",
    es: "No se ha podido resolver de forma segura la configuración upstream.",
    de: "Die Upstream-Konfiguration konnte nicht sicher aufgelöst werden.",
  },
  "outcome.nothingToSend": {
    en: "No commit to send.", it: "Nessun commit da inviare.",
    fr: "Aucun commit à envoyer.", es: "Ningún commit que enviar.",
    de: "Kein Commit zu senden.",
  },
  "outcome.pushDetached": {
    en: "The first push is blocked because HEAD is detached.",
    it: "Il primo push è bloccato perché HEAD è detached.",
    fr: "Le premier push est bloqué car HEAD est détaché.",
    es: "El primer push está bloqueado porque HEAD está detached.",
    de: "Der erste Push ist blockiert, weil HEAD detached ist.",
  },
  "outcome.pushNeedsCommit": {
    en: "Create at least one local commit before the first push.",
    it: "Crea almeno un commit locale prima del primo push.",
    fr: "Créez au moins un commit local avant le premier push.",
    es: "Crea al menos un commit local antes del primer push.",
    de: "Erstellen Sie mindestens einen lokalen Commit vor dem ersten Push.",
  },
  "outcome.pushInvalidBranch": {
    en: "The local branch name is not valid for a push: {reason}",
    it: "Il nome del branch locale non è valido per il push: {reason}",
    fr: "Le nom de la branche locale n’est pas valide pour un push : {reason}",
    es: "El nombre de la rama local no es válido para un push: {reason}",
    de: "Der lokale Branch-Name ist für einen Push nicht gültig: {reason}",
  },

  // Strings the earlier passes left behind, in dialogs that were otherwise done.
  "common.operationFailed": {
    en: "The operation failed", it: "Operazione non riuscita", fr: "L’opération a échoué",
    es: "La operación no se ha completado", de: "Der Vorgang ist fehlgeschlagen",
  },
  "discard.noRecovery": {
    en: "No later Git operation will be able to recover these changes.",
    it: "Nessuna operazione Git successiva potrà recuperare questi cambiamenti.",
    fr: "Aucune opération Git ultérieure ne pourra récupérer ces modifications.",
    es: "Ninguna operación de Git posterior podrá recuperar estos cambios.",
    de: "Keine spätere Git-Operation kann diese Änderungen zurückholen.",
  },
  "discard.keep": {
    en: "Keep the changes", it: "Conserva modifiche", fr: "Conserver les modifications",
    es: "Conservar los cambios", de: "Änderungen behalten",
  },
  "discard.running": {
    en: "Discarding…", it: "Annullamento…", fr: "Annulation…",
    es: "Descartando…", de: "Wird verworfen…",
  },
  "discard.confirm": {
    en: "Discard permanently", it: "Annulla definitivamente",
    fr: "Annuler définitivement", es: "Descartar definitivamente",
    de: "Endgültig verwerfen",
  },
  "commit.eyebrow": {
    en: "Operation review", it: "Revisione operazione", fr: "Revue de l’opération",
    es: "Revisión de la operación", de: "Prüfung des Vorgangs",
  },
  "create.adminRequirement": {
    en: "Creating directly requires", it: "La creazione diretta richiede",
    fr: "La création directe nécessite", es: "La creación directa requiere",
    de: "Das direkte Erstellen erfordert",
  },
  "delete.notConfirmed": {
    en: "GitHub did not confirm the deletion of the repository.",
    it: "GitHub non ha confermato l’eliminazione della repository.",
    fr: "GitHub n’a pas confirmé la suppression du dépôt.",
    es: "GitHub no ha confirmado la eliminación del repositorio.",
    de: "GitHub hat die Löschung des Repositorys nicht bestätigt.",
  },
  "error.externalUrlRefused": {
    en: "Only HTTPS addresses on the github.com domain may be opened.",
    it: "È consentita soltanto l’apertura di indirizzi HTTPS sul dominio github.com.",
    fr: "Seules les adresses HTTPS du domaine github.com peuvent être ouvertes.",
    es: "Solo se pueden abrir direcciones HTTPS del dominio github.com.",
    de: "Es dürfen nur HTTPS-Adressen der Domain github.com geöffnet werden.",
  },

  // Stable generic messages for the GitHubErrorCode values crossing IPC. More
  // specific errors keep their dedicated identifiers and parameters; these
  // make sure a classified fallback never remains English in another locale.
  "github.error.invalidRequest": {
    en: "The GitHub request is not valid.", it: "La richiesta GitHub non è valida.",
    fr: "La requête GitHub n’est pas valide.", es: "La solicitud de GitHub no es válida.",
    de: "Die GitHub-Anfrage ist ungültig.",
  },
  "github.error.network": {
    en: "GitHub could not be reached. Check your connection and try again.",
    it: "Impossibile raggiungere GitHub. Controlla la connessione e riprova.",
    fr: "Impossible de contacter GitHub. Vérifiez votre connexion et réessayez.",
    es: "No se ha podido contactar con GitHub. Comprueba tu conexión e inténtalo de nuevo.",
    de: "GitHub ist nicht erreichbar. Prüfe deine Verbindung und versuche es erneut.",
  },
  "github.error.timeout": {
    en: "The GitHub request took too long. Try again.",
    it: "La richiesta a GitHub ha impiegato troppo tempo. Riprova.",
    fr: "La requête GitHub a pris trop de temps. Réessayez.",
    es: "La solicitud a GitHub ha tardado demasiado. Inténtalo de nuevo.",
    de: "Die GitHub-Anfrage hat zu lange gedauert. Versuche es erneut.",
  },
  "github.error.invalidResponse": {
    en: "GitHub returned an invalid response.", it: "GitHub ha restituito una risposta non valida.",
    fr: "GitHub a renvoyé une réponse non valide.", es: "GitHub ha devuelto una respuesta no válida.",
    de: "GitHub hat eine ungültige Antwort zurückgegeben.",
  },
  "github.error.invalidDeviceFlow": {
    en: "GitHub could not start a valid sign-in flow.",
    it: "GitHub non ha potuto avviare un flusso di accesso valido.",
    fr: "GitHub n’a pas pu démarrer une procédure de connexion valide.",
    es: "GitHub no ha podido iniciar un flujo de acceso válido.",
    de: "GitHub konnte keinen gültigen Anmeldevorgang starten.",
  },
  "github.error.noPendingLogin": {
    en: "There is no GitHub sign-in in progress. Start again.",
    it: "Non è in corso alcun accesso a GitHub. Ricomincia.",
    fr: "Aucune connexion à GitHub n’est en cours. Recommencez.",
    es: "No hay ningún acceso a GitHub en curso. Vuelve a empezar.",
    de: "Es läuft keine GitHub-Anmeldung. Starte sie erneut.",
  },
  "github.error.loginSuperseded": {
    en: "This GitHub sign-in was replaced by a newer attempt.",
    it: "Questo accesso a GitHub è stato sostituito da un tentativo più recente.",
    fr: "Cette connexion à GitHub a été remplacée par une tentative plus récente.",
    es: "Este acceso a GitHub ha sido sustituido por un intento más reciente.",
    de: "Diese GitHub-Anmeldung wurde durch einen neueren Versuch ersetzt.",
  },
  "github.error.authorizationDenied": {
    en: "GitHub sign-in was denied.", it: "L’accesso a GitHub è stato negato.",
    fr: "La connexion à GitHub a été refusée.", es: "Se ha denegado el acceso a GitHub.",
    de: "Die GitHub-Anmeldung wurde abgelehnt.",
  },
  "github.error.authenticationRequired": {
    en: "Sign in to GitHub to continue.", it: "Accedi a GitHub per continuare.",
    fr: "Connectez-vous à GitHub pour continuer.", es: "Inicia sesión en GitHub para continuar.",
    de: "Melde dich bei GitHub an, um fortzufahren.",
  },
  "github.error.authenticationExpired": {
    en: "Your GitHub session has expired. Sign in again.",
    it: "La sessione GitHub è scaduta. Accedi di nuovo.",
    fr: "Votre session GitHub a expiré. Reconnectez-vous.",
    es: "Tu sesión de GitHub ha caducado. Vuelve a iniciar sesión.",
    de: "Deine GitHub-Sitzung ist abgelaufen. Melde dich erneut an.",
  },
  "github.error.rateLimited": {
    en: "GitHub’s request limit has been reached. Try again later.",
    it: "È stato raggiunto il limite di richieste di GitHub. Riprova più tardi.",
    fr: "La limite de requêtes GitHub a été atteinte. Réessayez plus tard.",
    es: "Se ha alcanzado el límite de solicitudes de GitHub. Inténtalo más tarde.",
    de: "Das GitHub-Anfragelimit wurde erreicht. Versuche es später erneut.",
  },
  "github.error.forbidden": {
    en: "GitHub did not grant permission for this operation.",
    it: "GitHub non ha concesso l’autorizzazione per questa operazione.",
    fr: "GitHub n’a pas accordé l’autorisation nécessaire à cette opération.",
    es: "GitHub no ha concedido permiso para esta operación.",
    de: "GitHub hat die Berechtigung für diesen Vorgang nicht erteilt.",
  },
  "github.error.notFound": {
    en: "GitHub could not find the requested resource.",
    it: "GitHub non ha trovato la risorsa richiesta.",
    fr: "GitHub n’a pas trouvé la ressource demandée.",
    es: "GitHub no ha encontrado el recurso solicitado.",
    de: "GitHub konnte die angeforderte Ressource nicht finden.",
  },
  "github.error.storageUnavailable": {
    en: "Secure storage for the GitHub session is unavailable.",
    it: "L’archiviazione sicura della sessione GitHub non è disponibile.",
    fr: "Le stockage sécurisé de la session GitHub n’est pas disponible.",
    es: "El almacenamiento seguro de la sesión de GitHub no está disponible.",
    de: "Der sichere Speicher für die GitHub-Sitzung ist nicht verfügbar.",
  },
  "github.error.internal": {
    en: "An internal error occurred while communicating with GitHub.",
    it: "Si è verificato un errore interno durante la comunicazione con GitHub.",
    fr: "Une erreur interne s’est produite pendant la communication avec GitHub.",
    es: "Se ha producido un error interno al comunicarse con GitHub.",
    de: "Bei der Kommunikation mit GitHub ist ein interner Fehler aufgetreten.",
  },

  // Why a folder name cannot be used. The check that counts is the backend one;
  // this only says it sooner, while the user is still typing.
  "clone.nameTooLong": {
    en: "The name is too long.", it: "Nome troppo lungo.", fr: "Le nom est trop long.",
    es: "El nombre es demasiado largo.", de: "Der Name ist zu lang.",
  },
  "clone.namePath": {
    en: "Choose a name, not a path.", it: "Scegli un nome, non un percorso.",
    fr: "Choisissez un nom, pas un chemin.", es: "Elige un nombre, no una ruta.",
    de: "Wählen Sie einen Namen, keinen Pfad.",
  },
  "clone.nameLeadingDash": {
    en: "It cannot start with a dash.", it: "Non può iniziare con un trattino.",
    fr: "Il ne peut pas commencer par un tiret.", es: "No puede empezar por un guion.",
    de: "Er darf nicht mit einem Bindestrich beginnen.",
  },
  "clone.nameTrailingDot": {
    en: "It cannot end with a dot.", it: "Non può finire con un punto.",
    fr: "Il ne peut pas se terminer par un point.", es: "No puede terminar en un punto.",
    de: "Er darf nicht mit einem Punkt enden.",
  },
  "clone.nameSeparators": {
    en: "No path separators.", it: "Niente separatori di percorso.",
    fr: "Pas de séparateurs de chemin.", es: "Sin separadores de ruta.",
    de: "Keine Pfadtrennzeichen.",
  },

  // The GitHub account dialog: sign-in through the Device Flow, profile and the
  // list of repositories the GitHub App can reach.
  "account.eyebrow": {
    en: "Remote integration", it: "Integrazione remota", fr: "Intégration distante",
    es: "Integración remota", de: "Externe Integration",
  },
  "account.title": {
    en: "GitHub account", it: "Account GitHub", fr: "Compte GitHub",
    es: "Cuenta de GitHub", de: "GitHub-Konto",
  },
  "account.close": {
    en: "Close GitHub account", it: "Chiudi account GitHub", fr: "Fermer le compte GitHub",
    es: "Cerrar la cuenta de GitHub", de: "GitHub-Konto schließen",
  },
  "account.connectedAs": {
    en: "Signed in as @{login}", it: "Connesso come @{login}", fr: "Connecté en tant que @{login}",
    es: "Conectado como @{login}", de: "Angemeldet als @{login}",
  },
  "account.signInSubtitle": {
    en: "Sign in with GitHub’s secure Device Flow.",
    it: "Accedi con il Device Flow sicuro di GitHub.",
    fr: "Connectez-vous avec le Device Flow sécurisé de GitHub.",
    es: "Inicia sesión con el Device Flow seguro de GitHub.",
    de: "Melden Sie sich mit dem sicheren Device Flow von GitHub an.",
  },
  "account.tabProfile": {
    en: "Profile", it: "Profilo", fr: "Profil", es: "Perfil", de: "Profil",
  },
  "account.tabRepositories": {
    en: "Repositories", it: "Repository", fr: "Dépôts", es: "Repositorios", de: "Repositorys",
  },

  // Device Flow.
  "account.deviceTitle": {
    en: "Authorise this device", it: "Autorizza questo dispositivo",
    fr: "Autorisez cet appareil", es: "Autoriza este dispositivo",
    de: "Dieses Gerät autorisieren",
  },
  "account.deviceSubtitle": {
    en: "Copy the code, open GitHub and confirm access for RubyRepo.",
    it: "Copia il codice, apri GitHub e conferma l’accesso a RubyRepo.",
    fr: "Copiez le code, ouvrez GitHub et confirmez l’accès de RubyRepo.",
    es: "Copia el código, abre GitHub y confirma el acceso de RubyRepo.",
    de: "Kopieren Sie den Code, öffnen Sie GitHub und bestätigen Sie den Zugriff für RubyRepo.",
  },
  "account.codeLabel": {
    en: "One-time code", it: "Codice monouso", fr: "Code à usage unique",
    es: "Código de un solo uso", de: "Einmalcode",
  },
  "account.codeAria": {
    en: "One-time GitHub code", it: "Codice GitHub monouso", fr: "Code GitHub à usage unique",
    es: "Código de GitHub de un solo uso", de: "GitHub-Einmalcode",
  },
  "account.copy": {
    en: "Copy", it: "Copia", fr: "Copier", es: "Copiar", de: "Kopieren",
  },
  "account.copied": {
    en: "Copied", it: "Copiato", fr: "Copié", es: "Copiado", de: "Kopiert",
  },
  "account.copyUnsupported": {
    en: "Copying is not supported", it: "Copia non supportata",
    fr: "La copie n’est pas prise en charge", es: "La copia no es compatible",
    de: "Kopieren wird nicht unterstützt",
  },
  "account.copyFailed": {
    en: "Copy failed: {reason}. Select the code by hand.",
    it: "Copia non riuscita: {reason}. Seleziona il codice manualmente.",
    fr: "Échec de la copie : {reason}. Sélectionnez le code à la main.",
    es: "No se ha podido copiar: {reason}. Selecciona el código a mano.",
    de: "Kopieren fehlgeschlagen: {reason}. Markieren Sie den Code von Hand.",
  },
  "account.expiresIn": {
    en: "Expires in {time}", it: "Scade tra {time}", fr: "Expire dans {time}",
    es: "Caduca en {time}", de: "Läuft ab in {time}",
  },
  "account.limitedTime": {
    en: "Limited time", it: "Tempo limitato", fr: "Temps limité",
    es: "Tiempo limitado", de: "Begrenzte Zeit",
  },
  "account.copyAndOpen": {
    en: "Copy the code and open GitHub", it: "Copia il codice e apri GitHub",
    fr: "Copier le code et ouvrir GitHub", es: "Copiar el código y abrir GitHub",
    de: "Code kopieren und GitHub öffnen",
  },
  "account.openBrowserFailed": {
    en: "The browser could not be opened: {reason}",
    it: "Impossibile aprire il browser: {reason}",
    fr: "Impossible d’ouvrir le navigateur : {reason}",
    es: "No se ha podido abrir el navegador: {reason}",
    de: "Der Browser konnte nicht geöffnet werden: {reason}",
  },
  "account.codeExpiredShort": {
    en: "The code has expired.", it: "Il codice è scaduto.", fr: "Le code a expiré.",
    es: "El código ha caducado.", de: "Der Code ist abgelaufen.",
  },
  "account.codeExpired": {
    en: "The code has expired. Generate a new one to try again.",
    it: "Il codice è scaduto. Generane uno nuovo per riprovare.",
    fr: "Le code a expiré. Générez-en un nouveau pour réessayer.",
    es: "El código ha caducado. Genera uno nuevo para volver a intentarlo.",
    de: "Der Code ist abgelaufen. Erzeugen Sie einen neuen, um es erneut zu versuchen.",
  },
  "account.sessionUnavailable": {
    en: "GitHub authorised the code, but the session is not available.",
    it: "GitHub ha autorizzato il codice, ma la sessione non è disponibile.",
    fr: "GitHub a autorisé le code, mais la session n’est pas disponible.",
    es: "GitHub ha autorizado el código, pero la sesión no está disponible.",
    de: "GitHub hat den Code autorisiert, aber die Sitzung ist nicht verfügbar.",
  },
  "account.slowDown": {
    en: "GitHub asked us to slow down. Next check in {seconds} seconds.",
    it: "GitHub ha richiesto di rallentare. Nuovo controllo tra {seconds} secondi.",
    fr: "GitHub a demandé de ralentir. Nouvelle vérification dans {seconds} secondes.",
    es: "GitHub ha pedido reducir el ritmo. Nueva comprobación en {seconds} segundos.",
    de: "GitHub hat um Verlangsamung gebeten. Nächste Prüfung in {seconds} Sekunden.",
  },
  "account.waitingBrowser": {
    en: "Waiting for the confirmation in the browser…",
    it: "In attesa della conferma nel browser…",
    fr: "En attente de la confirmation dans le navigateur…",
    es: "Esperando la confirmación en el navegador…",
    de: "Warten auf die Bestätigung im Browser…",
  },
  "account.enterCode": {
    en: "Enter the code on GitHub. This window checks for the confirmation on its own.",
    it: "Inserisci il codice su GitHub. Questa finestra controllerà automaticamente la conferma.",
    fr: "Saisissez le code sur GitHub. Cette fenêtre vérifie la confirmation toute seule.",
    es: "Introduce el código en GitHub. Esta ventana comprueba la confirmación por su cuenta.",
    de: "Geben Sie den Code auf GitHub ein. Dieses Fenster prüft die Bestätigung selbst.",
  },
  "account.pollFailed": {
    en: "Checking the sign-in failed: {reason}",
    it: "Controllo dell’accesso non riuscito: {reason}",
    fr: "Échec de la vérification de la connexion : {reason}",
    es: "No se ha podido comprobar el inicio de sesión: {reason}",
    de: "Die Prüfung der Anmeldung ist fehlgeschlagen: {reason}",
  },
  "account.beginFailed": {
    en: "The GitHub sign-in could not be started: {reason}",
    it: "Impossibile avviare l’accesso GitHub: {reason}",
    fr: "Impossible de démarrer la connexion GitHub : {reason}",
    es: "No se ha podido iniciar el acceso a GitHub: {reason}",
    de: "Die GitHub-Anmeldung konnte nicht gestartet werden: {reason}",
  },
  "account.cancelLogin": {
    en: "Cancel sign-in", it: "Annulla accesso", fr: "Annuler la connexion",
    es: "Cancelar el inicio de sesión", de: "Anmeldung abbrechen",
  },
  "account.newCode": {
    en: "Generate a new code", it: "Genera nuovo codice", fr: "Générer un nouveau code",
    es: "Generar un código nuevo", de: "Neuen Code erzeugen",
  },

  // Signed out.
  "account.connectTitle": {
    en: "Link your GitHub account", it: "Collega il tuo account GitHub",
    fr: "Liez votre compte GitHub", es: "Enlaza tu cuenta de GitHub",
    de: "Verknüpfen Sie Ihr GitHub-Konto",
  },
  "account.connectBody": {
    en: "See the repositories the GitHub App can reach and check where you have write access. Authorisation happens in the browser: RubyRepo never asks for your password.",
    it: "Visualizza le repository accessibili alla GitHub App e verifica dove hai permessi di scrittura. L’autorizzazione avviene nel browser: RubyRepo non richiede la tua password.",
    fr: "Consultez les dépôts accessibles à la GitHub App et vérifiez où vous avez le droit d’écriture. L’autorisation se fait dans le navigateur : RubyRepo ne demande jamais votre mot de passe.",
    es: "Consulta los repositorios a los que llega la GitHub App y comprueba dónde tienes permiso de escritura. La autorización ocurre en el navegador: RubyRepo nunca pide tu contraseña.",
    de: "Sehen Sie die Repositorys, die die GitHub App erreicht, und prüfen Sie, wo Sie Schreibrechte haben. Die Autorisierung erfolgt im Browser: RubyRepo fragt nie nach Ihrem Passwort.",
  },
  "account.browserNoticeTitle": {
    en: "Sign-in disabled in the browser preview",
    it: "Accesso disattivato nell’anteprima browser",
    fr: "Connexion désactivée dans l’aperçu navigateur",
    es: "Inicio de sesión desactivado en la vista previa del navegador",
    de: "Anmeldung in der Browser-Vorschau deaktiviert",
  },
  "account.browserNoticeBody": {
    en: "Start the Tauri desktop app to link GitHub for real.",
    it: "Avvia l’app desktop Tauri per collegare realmente GitHub.",
    fr: "Lancez l’application de bureau Tauri pour lier réellement GitHub.",
    es: "Inicia la aplicación de escritorio Tauri para enlazar GitHub de verdad.",
    de: "Starten Sie die Tauri-Desktop-App, um GitHub wirklich zu verknüpfen.",
  },
  "account.loginNotStarted": {
    en: "Sign-in not started", it: "Accesso non avviato", fr: "Connexion non démarrée",
    es: "Inicio de sesión no iniciado", de: "Anmeldung nicht gestartet",
  },
  "account.requestingCode": {
    en: "Requesting a code…", it: "Richiesta codice…", fr: "Demande du code…",
    es: "Solicitando el código…", de: "Code wird angefordert…",
  },
  "account.signIn": {
    en: "Sign in with GitHub", it: "Accedi con GitHub", fr: "Se connecter avec GitHub",
    es: "Iniciar sesión con GitHub", de: "Mit GitHub anmelden",
  },
  "account.tokenFootnote": {
    en: "The token is held and protected by the local backend.",
    it: "Il token viene gestito e protetto dal backend locale.",
    fr: "Le jeton est conservé et protégé par le backend local.",
    es: "El token lo guarda y protege el backend local.",
    de: "Das Token wird vom lokalen Backend verwahrt und geschützt.",
  },

  // Profile.
  "account.sessionSaved": {
    en: "Sign-in saved", it: "Accesso salvato", fr: "Connexion enregistrée",
    es: "Inicio de sesión guardado", de: "Anmeldung gespeichert",
  },
  "account.sessionTemporary": {
    en: "Temporary session", it: "Sessione temporanea", fr: "Session temporaire",
    es: "Sesión temporal", de: "Temporäre Sitzung",
  },
  "account.profileButton": {
    en: "Profile", it: "Profilo", fr: "Profil", es: "Perfil", de: "Profil",
  },
  "account.statsAria": {
    en: "GitHub account statistics", it: "Statistiche account GitHub",
    fr: "Statistiques du compte GitHub", es: "Estadísticas de la cuenta de GitHub",
    de: "Statistiken des GitHub-Kontos",
  },
  "account.reposAccessible": {
    en: "accessible repositories", it: "repository accessibili", fr: "dépôts accessibles",
    es: "repositorios accesibles", de: "erreichbare Repositorys",
  },
  "account.appInstallations": {
    en: "App installations", it: "installazioni App", fr: "installations de l’App",
    es: "instalaciones de la App", de: "App-Installationen",
  },
  "account.followers": {
    en: "followers", it: "follower", fr: "abonnés", es: "seguidores", de: "Follower",
  },
  "account.following": {
    en: "following", it: "seguiti", fr: "abonnements", es: "siguiendo", de: "gefolgt",
  },
  "account.noInstallationTitle": {
    en: "No GitHub App installation found",
    it: "Nessuna installazione GitHub App trovata",
    fr: "Aucune installation de la GitHub App trouvée",
    es: "No se ha encontrado ninguna instalación de la GitHub App",
    de: "Keine GitHub-App-Installation gefunden",
  },
  "account.noInstallationBody": {
    en: "You are signed in, but RubyRepo cannot see any repository yet. Install or enable the GitHub App on your account or on the organisations you want.",
    it: "Hai effettuato l’accesso, ma RubyRepo non può ancora vedere repository. Installa o abilita la GitHub App sul tuo account o sulle organizzazioni desiderate.",
    fr: "Vous êtes connecté, mais RubyRepo ne voit encore aucun dépôt. Installez ou activez la GitHub App sur votre compte ou sur les organisations souhaitées.",
    es: "Has iniciado sesión, pero RubyRepo todavía no ve ningún repositorio. Instala o activa la GitHub App en tu cuenta o en las organizaciones que quieras.",
    de: "Sie sind angemeldet, aber RubyRepo sieht noch kein Repository. Installieren oder aktivieren Sie die GitHub App für Ihr Konto oder die gewünschten Organisationen.",
  },
  "account.manageInstallations": {
    en: "Manage installations", it: "Gestisci installazioni", fr: "Gérer les installations",
    es: "Gestionar las instalaciones", de: "Installationen verwalten",
  },
  "account.detailsTitle": {
    en: "Account details", it: "Dettagli account", fr: "Détails du compte",
    es: "Detalles de la cuenta", de: "Kontodetails",
  },
  "account.publicRepos": {
    en: "Public repositories", it: "Repository pubbliche", fr: "Dépôts publics",
    es: "Repositorios públicos", de: "Öffentliche Repositorys",
  },
  "account.privateRepos": {
    en: "Private repositories", it: "Repository private", fr: "Dépôts privés",
    es: "Repositorios privados", de: "Private Repositorys",
  },
  "account.persistence": {
    en: "Persistence", it: "Persistenza", fr: "Persistance",
    es: "Persistencia", de: "Persistenz",
  },
  "account.credentialsSaved": {
    en: "Credentials saved", it: "Credenziali salvate", fr: "Identifiants enregistrés",
    es: "Credenciales guardadas", de: "Anmeldedaten gespeichert",
  },
  "account.currentSessionOnly": {
    en: "Current session only", it: "Solo sessione corrente", fr: "Session courante uniquement",
    es: "Solo la sesión actual", de: "Nur aktuelle Sitzung",
  },
  "account.expiry": {
    en: "Expiry", it: "Scadenza", fr: "Expiration", es: "Caducidad", de: "Ablauf",
  },
  "account.actionFailed": {
    en: "The operation failed", it: "Operazione non riuscita", fr: "L’opération a échoué",
    es: "La operación no se ha completado", de: "Der Vorgang ist fehlgeschlagen",
  },
  "account.signOutAccount": {
    en: "Sign out of the account", it: "Disconnetti account",
    fr: "Se déconnecter du compte", es: "Cerrar la sesión de la cuenta",
    de: "Vom Konto abmelden",
  },
  "account.signOutQuestion": {
    en: "Sign out @{login}?", it: "Disconnettere @{login}?", fr: "Déconnecter @{login} ?",
    es: "¿Cerrar la sesión de @{login}?", de: "@{login} abmelden?",
  },
  "account.signOutBody": {
    en: "To use GitHub again you will have to authorise the app once more.",
    it: "Per riutilizzare GitHub dovrai autorizzare nuovamente l’app.",
    fr: "Pour réutiliser GitHub, vous devrez autoriser l’application à nouveau.",
    es: "Para volver a usar GitHub tendrás que autorizar la aplicación otra vez.",
    de: "Um GitHub wieder zu nutzen, müssen Sie die App erneut autorisieren.",
  },
  "account.signOut": {
    en: "Sign out", it: "Disconnetti", fr: "Se déconnecter",
    es: "Cerrar sesión", de: "Abmelden",
  },
  "account.signOutFailed": {
    en: "Signing out failed: {reason}", it: "Disconnessione non riuscita: {reason}",
    fr: "Échec de la déconnexion : {reason}",
    es: "No se ha podido cerrar la sesión: {reason}",
    de: "Die Abmeldung ist fehlgeschlagen: {reason}",
  },

  // The repository list.
  "account.searchAria": {
    en: "Search GitHub repositories", it: "Cerca repository GitHub",
    fr: "Rechercher des dépôts GitHub", es: "Buscar repositorios de GitHub",
    de: "GitHub-Repositorys suchen",
  },
  "account.searchPlaceholder": {
    en: "Search repositories…", it: "Cerca repository…", fr: "Rechercher des dépôts…",
    es: "Buscar repositorios…", de: "Repositorys suchen…",
  },
  "account.clearSearch": {
    en: "Clear the search", it: "Cancella ricerca", fr: "Effacer la recherche",
    es: "Borrar la búsqueda", de: "Suche löschen",
  },
  "account.filterAria": {
    en: "Filter by access", it: "Filtra per accesso", fr: "Filtrer par accès",
    es: "Filtrar por acceso", de: "Nach Zugriff filtern",
  },
  "account.filterAll": {
    en: "All", it: "Tutte", fr: "Tous", es: "Todos", de: "Alle",
  },
  "account.filterWrite": {
    en: "Write", it: "Scrittura", fr: "Écriture", es: "Escritura", de: "Schreiben",
  },
  "account.filterRead": {
    en: "Read", it: "Lettura", fr: "Lecture", es: "Lectura", de: "Lesen",
  },
  "account.installAppFirst": {
    en: "Install the GitHub App first", it: "Installa prima la GitHub App",
    fr: "Installez d’abord la GitHub App", es: "Instala antes la GitHub App",
    de: "Installieren Sie zuerst die GitHub App",
  },
  "account.noWritableRepository": {
    en: "No repository with write access", it: "Nessuna repository con accesso in scrittura",
    fr: "Aucun dépôt avec accès en écriture", es: "Ningún repositorio con acceso de escritura",
    de: "Kein Repository mit Schreibzugriff",
  },
  "account.desktopOnly": {
    en: "Available in the Tauri desktop app", it: "Disponibile nell’app desktop Tauri",
    fr: "Disponible dans l’application de bureau Tauri",
    es: "Disponible en la aplicación de escritorio Tauri",
    de: "In der Tauri-Desktop-App verfügbar",
  },
  "account.linkFolder": {
    en: "Link a folder", it: "Collega cartella", fr: "Lier un dossier",
    es: "Enlazar una carpeta", de: "Ordner verknüpfen",
  },
  "account.newRepository": {
    en: "New repository", it: "Nuova repository", fr: "Nouveau dépôt",
    es: "Repositorio nuevo", de: "Neues Repository",
  },
  "account.refreshAria": {
    en: "Refresh the GitHub repositories", it: "Aggiorna repository GitHub",
    fr: "Actualiser les dépôts GitHub", es: "Actualizar los repositorios de GitHub",
    de: "GitHub-Repositorys aktualisieren",
  },
  "account.noInstallationsTitle": {
    en: "No installation available", it: "Nessuna installazione disponibile",
    fr: "Aucune installation disponible", es: "Ninguna instalación disponible",
    de: "Keine Installation verfügbar",
  },
  "account.noInstallationsBody": {
    en: "Install or enable the GitHub App to give RubyRepo access to the repositories you want.",
    it: "Installa o abilita la GitHub App per concedere a RubyRepo l’accesso alle repository desiderate.",
    fr: "Installez ou activez la GitHub App pour donner à RubyRepo accès aux dépôts souhaités.",
    es: "Instala o activa la GitHub App para dar a RubyRepo acceso a los repositorios que quieras.",
    de: "Installieren oder aktivieren Sie die GitHub App, um RubyRepo Zugriff auf die gewünschten Repositorys zu geben.",
  },
  "account.loadingRepositories": {
    en: "Reading the GitHub repositories…", it: "Lettura repository GitHub…",
    fr: "Lecture des dépôts GitHub…", es: "Leyendo los repositorios de GitHub…",
    de: "GitHub-Repositorys werden gelesen…",
  },
  "account.repositoriesUnavailable": {
    en: "Repositories not available", it: "Repository non disponibili",
    fr: "Dépôts non disponibles", es: "Repositorios no disponibles",
    de: "Repositorys nicht verfügbar",
  },
  "account.retry": {
    en: "Try again", it: "Riprova", fr: "Réessayer", es: "Reintentar", de: "Erneut versuchen",
  },
  "account.noAccessibleTitle": {
    en: "No accessible repository", it: "Nessuna repository accessibile",
    fr: "Aucun dépôt accessible", es: "Ningún repositorio accesible",
    de: "Kein erreichbares Repository",
  },
  "account.noAccessibleBody": {
    en: "The current installations do not expose any repository to RubyRepo.",
    it: "Le installazioni correnti non espongono repository a RubyRepo.",
    fr: "Les installations actuelles n’exposent aucun dépôt à RubyRepo.",
    es: "Las instalaciones actuales no exponen ningún repositorio a RubyRepo.",
    de: "Die aktuellen Installationen geben RubyRepo kein Repository frei.",
  },
  "account.noResultsTitle": {
    en: "No result", it: "Nessun risultato", fr: "Aucun résultat",
    es: "Ningún resultado", de: "Kein Ergebnis",
  },
  "account.noResultsBody": {
    en: "Change the search or the access filter.",
    it: "Modifica la ricerca o il filtro di accesso.",
    fr: "Modifiez la recherche ou le filtre d’accès.",
    es: "Cambia la búsqueda o el filtro de acceso.",
    de: "Ändern Sie die Suche oder den Zugriffsfilter.",
  },
  "account.listSummary": {
    en: "{shown} of {total} repositories", it: "{shown} di {total} repository",
    fr: "{shown} dépôts sur {total}", es: "{shown} de {total} repositorios",
    de: "{shown} von {total} Repositorys",
  },
  "account.updating": {
    en: "Updating…", it: "Aggiornamento…", fr: "Mise à jour…",
    es: "Actualizando…", de: "Wird aktualisiert…",
  },
  "account.accessWrite": {
    en: "Write", it: "Scrittura", fr: "Écriture", es: "Escritura", de: "Schreiben",
  },
  "account.accessRead": {
    en: "Read-only", it: "Sola lettura", fr: "Lecture seule",
    es: "Solo lectura", de: "Nur Lesen",
  },
  "account.isLocal": {
    en: "Local", it: "Locale", fr: "Local", es: "Local", de: "Lokal",
  },
  "account.notLocal": {
    en: "Not present", it: "Non presente", fr: "Absent", es: "No presente", de: "Nicht vorhanden",
  },
  "account.installationNumber": {
    en: "Installation #{id}", it: "Installazione #{id}", fr: "Installation n° {id}",
    es: "Instalación n.º {id}", de: "Installation Nr. {id}",
  },
  "account.linkFolderTo": {
    en: "Link a local folder to {repository}",
    it: "Collega una cartella locale a {repository}",
    fr: "Lier un dossier local à {repository}",
    es: "Enlazar una carpeta local con {repository}",
    de: "Einen lokalen Ordner mit {repository} verknüpfen",
  },
  "account.linkLocalFolder": {
    en: "Link a local folder", it: "Collega cartella locale",
    fr: "Lier un dossier local", es: "Enlazar una carpeta local",
    de: "Lokalen Ordner verknüpfen",
  },
  "account.deleteFromGitHub": {
    en: "Delete {repository} from GitHub", it: "Elimina {repository} da GitHub",
    fr: "Supprimer {repository} de GitHub", es: "Eliminar {repository} de GitHub",
    de: "{repository} aus GitHub löschen",
  },
  "account.deleteRepository": {
    en: "Delete the repository from GitHub", it: "Elimina repository da GitHub",
    fr: "Supprimer le dépôt de GitHub", es: "Eliminar el repositorio de GitHub",
    de: "Repository aus GitHub löschen",
  },
  "account.openOnGitHub": {
    en: "Open {repository} on GitHub", it: "Apri {repository} su GitHub",
    fr: "Ouvrir {repository} sur GitHub", es: "Abrir {repository} en GitHub",
    de: "{repository} auf GitHub öffnen",
  },
  "account.deleteDesktopOnly": {
    en: "Deleting is available only in the desktop app with a signed-in GitHub account.",
    it: "L’eliminazione è disponibile soltanto nell’app desktop con un account GitHub connesso.",
    fr: "La suppression n’est disponible que dans l’application de bureau avec un compte GitHub connecté.",
    es: "La eliminación solo está disponible en la aplicación de escritorio con una cuenta de GitHub conectada.",
    de: "Das Löschen ist nur in der Desktop-App mit angemeldetem GitHub-Konto möglich.",
  },
  "account.deleteMismatch": {
    en: "GitHub returned an outcome for a different repository. The list was left untouched.",
    it: "GitHub ha restituito un esito riferito a una repository diversa. L’elenco non è stato modificato.",
    fr: "GitHub a renvoyé un résultat concernant un autre dépôt. La liste n’a pas été modifiée.",
    es: "GitHub ha devuelto un resultado de otro repositorio. La lista no se ha modificado.",
    de: "GitHub hat ein Ergebnis für ein anderes Repository zurückgegeben. Die Liste blieb unverändert.",
  },
  "account.createDesktopOnly": {
    en: "Creating is available only in the desktop app with a signed-in GitHub account.",
    it: "La creazione è disponibile soltanto nell’app desktop con un account GitHub connesso.",
    fr: "La création n’est disponible que dans l’application de bureau avec un compte GitHub connecté.",
    es: "La creación solo está disponible en la aplicación de escritorio con una cuenta de GitHub conectada.",
    de: "Das Erstellen ist nur in der Desktop-App mit angemeldetem GitHub-Konto möglich.",
  },
  "account.createdNotVisible": {
    en: "The repository was created, but it is not visible yet among those granted to the GitHub App.",
    it: "La repository è stata creata, ma non è ancora visibile tra quelle concesse alla GitHub App.",
    fr: "Le dépôt a été créé, mais il n’apparaît pas encore parmi ceux accordés à la GitHub App.",
    es: "El repositorio se ha creado, pero todavía no aparece entre los concedidos a la GitHub App.",
    de: "Das Repository wurde erstellt, erscheint aber noch nicht unter den für die GitHub App freigegebenen.",
  },
  "account.createdListStale": {
    en: "Repository created, but the remote list was not refreshed: {reason}",
    it: "Repository creata, ma elenco remoto non aggiornato: {reason}",
    fr: "Dépôt créé, mais la liste distante n’a pas été actualisée : {reason}",
    es: "Repositorio creado, pero la lista remota no se ha actualizado: {reason}",
    de: "Repository erstellt, aber die Remote-Liste wurde nicht aktualisiert: {reason}",
  },

  // The titles of the native folder dialogs. They travel to the backend already
  // translated: the dictionary and the active language live here, not there.
  "dialog.chooseWorkspace": {
    en: "Choose the folder that contains the repositories",
    it: "Scegli la cartella che contiene le repository",
    fr: "Choisissez le dossier qui contient les dépôts",
    es: "Elige la carpeta que contiene los repositorios",
    de: "Wählen Sie den Ordner mit den Repositorys",
  },
  "dialog.chooseLinkFolder": {
    en: "Choose the local folder to link to GitHub",
    it: "Scegli la cartella locale da collegare a GitHub",
    fr: "Choisissez le dossier local à lier à GitHub",
    es: "Elige la carpeta local que quieres enlazar con GitHub",
    de: "Wählen Sie den lokalen Ordner für die Verknüpfung mit GitHub",
  },
  "dialog.chooseCloneParent": {
    en: "Choose where to create the local copy",
    it: "Scegli dove creare la copia locale",
    fr: "Choisissez où créer la copie locale",
    es: "Elige dónde crear la copia local",
    de: "Wählen Sie, wo die lokale Kopie erstellt werden soll",
  },
  "error.folderNotUsable": {
    en: "The chosen folder cannot be used: {reason}",
    it: "La cartella scelta non è utilizzabile: {reason}",
    fr: "Le dossier choisi n’est pas utilisable : {reason}",
    es: "La carpeta elegida no se puede usar: {reason}",
    de: "Der gewählte Ordner ist nicht verwendbar: {reason}",
  },

  // The Git process itself: what stopped it, and what it could not do. These
  // reach the interface as errors on any operation.
  "git.notFound": {
    en: "Git was not found. Install Git or set RUBYREPO_GIT_PATH.",
    it: "Git non è stato trovato. Installa Git oppure imposta RUBYREPO_GIT_PATH.",
    fr: "Git est introuvable. Installez Git ou définissez RUBYREPO_GIT_PATH.",
    es: "No se ha encontrado Git. Instala Git o define RUBYREPO_GIT_PATH.",
    de: "Git wurde nicht gefunden. Installieren Sie Git oder setzen Sie RUBYREPO_GIT_PATH.",
  },
  "git.cancelled": {
    en: "Operation cancelled: Git was stopped.",
    it: "Operazione annullata: Git è stato interrotto.",
    fr: "Opération annulée : Git a été arrêté.",
    es: "Operación cancelada: se ha detenido Git.",
    de: "Vorgang abgebrochen: Git wurde gestoppt.",
  },
  "git.timedOut": {
    en: "Git did not answer within {seconds} seconds and was stopped.",
    it: "Git non ha risposto entro {seconds} secondi ed è stato interrotto.",
    fr: "Git n’a pas répondu en {seconds} secondes et a été arrêté.",
    es: "Git no ha respondido en {seconds} segundos y se ha detenido.",
    de: "Git hat nicht innerhalb von {seconds} Sekunden geantwortet und wurde gestoppt.",
  },
  "git.exitedWithCode": {
    en: "Git exited with code {code}.", it: "Git è terminato con codice {code}.",
    fr: "Git s’est terminé avec le code {code}.", es: "Git ha terminado con el código {code}.",
    de: "Git wurde mit Code {code} beendet.",
  },
  "git.startFailed": {
    en: "Git could not be started: {reason}", it: "Impossibile avviare Git: {reason}",
    fr: "Impossible de démarrer Git : {reason}", es: "No se ha podido iniciar Git: {reason}",
    de: "Git konnte nicht gestartet werden: {reason}",
  },
  "git.waitFailed": {
    en: "Git could not be waited for: {reason}", it: "Impossibile attendere Git: {reason}",
    fr: "Impossible d’attendre Git : {reason}", es: "No se ha podido esperar a Git: {reason}",
    de: "Auf Git konnte nicht gewartet werden: {reason}",
  },
  "git.stdoutUnavailable": {
    en: "The output of Git could not be read.", it: "Impossibile leggere l’output di Git.",
    fr: "Impossible de lire la sortie de Git.", es: "No se ha podido leer la salida de Git.",
    de: "Die Ausgabe von Git konnte nicht gelesen werden.",
  },
  "git.stderrUnavailable": {
    en: "The error output of Git could not be read.",
    it: "Impossibile leggere gli errori di Git.",
    fr: "Impossible de lire la sortie d’erreur de Git.",
    es: "No se ha podido leer la salida de errores de Git.",
    de: "Die Fehlerausgabe von Git konnte nicht gelesen werden.",
  },
  "git.stdoutInterrupted": {
    en: "Reading the output of Git was interrupted.",
    it: "Lettura dell’output di Git interrotta.",
    fr: "La lecture de la sortie de Git a été interrompue.",
    es: "La lectura de la salida de Git se ha interrumpido.",
    de: "Das Lesen der Git-Ausgabe wurde unterbrochen.",
  },
  "git.stderrInterrupted": {
    en: "Reading the error output of Git was interrupted.",
    it: "Lettura degli errori di Git interrotta.",
    fr: "La lecture de la sortie d’erreur de Git a été interrompue.",
    es: "La lectura de la salida de errores de Git se ha interrumpido.",
    de: "Das Lesen der Git-Fehlerausgabe wurde unterbrochen.",
  },
  "git.folderMissing": {
    en: "The folder does not exist: {path}", it: "La cartella non esiste: {path}",
    fr: "Le dossier n’existe pas : {path}", es: "La carpeta no existe: {path}",
    de: "Der Ordner existiert nicht: {path}",
  },
  "git.notARepository": {
    en: "Not a Git repository: {path}", it: "Non è una repository Git: {path}",
    fr: "Ce n’est pas un dépôt Git : {path}", es: "No es un repositorio Git: {path}",
    de: "Kein Git-Repository: {path}",
  },
  "git.rootUnresolvable": {
    en: "The root of the Git repository could not be resolved: {reason}",
    it: "Impossibile risolvere la root della repository Git: {reason}",
    fr: "Impossible de résoudre la racine du dépôt Git : {reason}",
    es: "No se ha podido resolver la raíz del repositorio Git: {reason}",
    de: "Die Wurzel des Git-Repositorys konnte nicht aufgelöst werden: {reason}",
  },
  "git.unsafeNetworkConfig": {
    en: "GitHub authentication blocked: the repository has an unsafe local network configuration. Remove it, or use the system Git credentials.",
    it: "Autenticazione GitHub bloccata: la repository contiene una configurazione di rete locale non sicura. Rimuovila oppure usa le credenziali Git di sistema.",
    fr: "Authentification GitHub bloquée : le dépôt contient une configuration réseau locale non sûre. Supprimez-la, ou utilisez les identifiants Git du système.",
    es: "Autenticación de GitHub bloqueada: el repositorio tiene una configuración de red local insegura. Elimínala, o usa las credenciales Git del sistema.",
    de: "GitHub-Authentifizierung blockiert: Das Repository hat eine unsichere lokale Netzwerkkonfiguration. Entfernen Sie sie, oder verwenden Sie die Git-Anmeldedaten des Systems.",
  },
  "git.invalidUpstreamConfig": {
    en: "The upstream configuration of the branch is not valid.",
    it: "La configurazione upstream del branch non è valida.",
    fr: "La configuration upstream de la branche n’est pas valide.",
    es: "La configuración upstream de la rama no es válida.",
    de: "Die Upstream-Konfiguration des Branches ist nicht gültig.",
  },
  "git.invalidUpstreamRef": {
    en: "The upstream configuration contains an invalid reference.",
    it: "La configurazione upstream contiene un riferimento non valido.",
    fr: "La configuration upstream contient une référence invalide.",
    es: "La configuración upstream contiene una referencia no válida.",
    de: "Die Upstream-Konfiguration enthält eine ungültige Referenz.",
  },
  "git.upstreamNotConfigured": {
    en: "The upstream of the branch does not belong to a configured remote.",
    it: "L’upstream del branch non appartiene a un remote configurato.",
    fr: "L’upstream de la branche n’appartient pas à un dépôt distant configuré.",
    es: "El upstream de la rama no pertenece a un remoto configurado.",
    de: "Der Upstream des Branches gehört zu keinem konfigurierten Remote.",
  },

  // The local channel that hands Git the GitHub token, never the token itself.
  "askpass.configureFailed": {
    en: "GitHub authentication could not be set up: {reason}",
    it: "Impossibile configurare l’autenticazione GitHub: {reason}",
    fr: "Impossible de configurer l’authentification GitHub : {reason}",
    es: "No se ha podido configurar la autenticación de GitHub: {reason}",
    de: "Die GitHub-Authentifizierung konnte nicht eingerichtet werden: {reason}",
  },
  "askpass.initFailed": {
    en: "The local GitHub channel could not be initialised.",
    it: "Impossibile inizializzare il canale GitHub locale.",
    fr: "Impossible d’initialiser le canal GitHub local.",
    es: "No se ha podido inicializar el canal local de GitHub.",
    de: "Der lokale GitHub-Kanal konnte nicht initialisiert werden.",
  },
  "askpass.protectFailed": {
    en: "The local GitHub channel could not be protected.",
    it: "Impossibile proteggere il canale GitHub locale.",
    fr: "Impossible de protéger le canal GitHub local.",
    es: "No se ha podido proteger el canal local de GitHub.",
    de: "Der lokale GitHub-Kanal konnte nicht geschützt werden.",
  },
  "askpass.addressFailed": {
    en: "The address of the local GitHub channel could not be determined.",
    it: "Impossibile determinare il canale GitHub locale.",
    fr: "Impossible de déterminer l’adresse du canal GitHub local.",
    es: "No se ha podido determinar la dirección del canal local de GitHub.",
    de: "Die Adresse des lokalen GitHub-Kanals konnte nicht ermittelt werden.",
  },
  "askpass.nonceFailed": {
    en: "A secure GitHub session could not be generated.",
    it: "Impossibile generare una sessione GitHub sicura.",
    fr: "Impossible de générer une session GitHub sûre.",
    es: "No se ha podido generar una sesión segura de GitHub.",
    de: "Eine sichere GitHub-Sitzung konnte nicht erzeugt werden.",
  },
  "askpass.startFailed": {
    en: "The local GitHub channel could not be started.",
    it: "Impossibile avviare il canale GitHub locale.",
    fr: "Impossible de démarrer le canal GitHub local.",
    es: "No se ha podido iniciar el canal local de GitHub.",
    de: "Der lokale GitHub-Kanal konnte nicht gestartet werden.",
  },

  // Branches.
  "branch.invalidName": {
    en: "Invalid branch name.", it: "Nome del branch non valido.",
    fr: "Nom de branche invalide.", es: "Nombre de rama no válido.",
    de: "Ungültiger Branch-Name.",
  },
  "branch.refusedByGit": {
    en: "Git does not accept ‘{name}’ as a branch name.",
    it: "Git non accetta ‘{name}’ come nome di branch.",
    fr: "Git n’accepte pas « {name} » comme nom de branche.",
    es: "Git no acepta «{name}» como nombre de rama.",
    de: "Git akzeptiert „{name}“ nicht als Branch-Namen.",
  },
  "branch.switchFailed": {
    en: "The branch could not be switched: {reason}",
    it: "Cambio di branch non riuscito: {reason}",
    fr: "Le changement de branche a échoué : {reason}",
    es: "No se ha podido cambiar de rama: {reason}",
    de: "Der Branch konnte nicht gewechselt werden: {reason}",
  },
  "branch.createFailed": {
    en: "The branch could not be created: {reason}",
    it: "Creazione del branch non riuscita: {reason}",
    fr: "La création de la branche a échoué : {reason}",
    es: "No se ha podido crear la rama: {reason}",
    de: "Der Branch konnte nicht erstellt werden: {reason}",
  },

  // Remotes.
  "remote.invalidGitHubInput": {
    en: "Invalid GitHub repository or clone URL.",
    it: "Repository GitHub o URL clone non validi.",
    fr: "Dépôt GitHub ou URL de clonage invalides.",
    es: "Repositorio de GitHub o URL de clonado no válidos.",
    de: "Ungültiges GitHub-Repository oder ungültige Klon-URL.",
  },
  "remote.fullNameFormat": {
    en: "The GitHub full name must have the form owner/repository.",
    it: "Il nome completo GitHub deve avere il formato owner/repository.",
    fr: "Le nom complet GitHub doit avoir la forme owner/repository.",
    es: "El nombre completo de GitHub debe tener la forma owner/repository.",
    de: "Der vollständige GitHub-Name muss die Form owner/repository haben.",
  },
  "remote.httpsOnly": {
    en: "Only HTTPS github.com URLs are allowed, with no credentials, port, query or fragment.",
    it: "Sono consentiti solo URL HTTPS github.com senza credenziali, porta, query o frammento.",
    fr: "Seules les URL HTTPS github.com sont autorisées, sans identifiants, port, requête ni fragment.",
    es: "Solo se permiten URL HTTPS de github.com, sin credenciales, puerto, consulta ni fragmento.",
    de: "Es sind nur HTTPS-URLs von github.com erlaubt, ohne Anmeldedaten, Port, Query oder Fragment.",
  },
  "remote.urlMustBeOwnerRepository": {
    en: "The GitHub URL must identify exactly owner/repository.",
    it: "L’URL GitHub deve identificare esattamente owner/repository.",
    fr: "L’URL GitHub doit identifier exactement owner/repository.",
    es: "La URL de GitHub debe identificar exactamente owner/repository.",
    de: "Die GitHub-URL muss genau owner/repository bezeichnen.",
  },
  "remote.fullNameMismatch": {
    en: "repositoryFullName does not match the repository named by cloneUrl.",
    it: "repositoryFullName non corrisponde alla repository indicata da cloneUrl.",
    fr: "repositoryFullName ne correspond pas au dépôt indiqué par cloneUrl.",
    es: "repositoryFullName no coincide con el repositorio que indica cloneUrl.",
    de: "repositoryFullName stimmt nicht mit dem von cloneUrl genannten Repository überein.",
  },
  "remote.invalidCloneUrl": {
    en: "The clone URL of the GitHub repository is not valid.",
    it: "L’URL clone della repository GitHub non è valido.",
    fr: "L’URL de clonage du dépôt GitHub n’est pas valide.",
    es: "La URL de clonado del repositorio de GitHub no es válida.",
    de: "Die Klon-URL des GitHub-Repositorys ist nicht gültig.",
  },
  "remote.invalidName": {
    en: "Invalid remote name: use letters, numbers, dashes or dots.",
    it: "Nome del remote non valido: usa lettere, numeri, trattini o punti.",
    fr: "Nom de dépôt distant invalide : utilisez des lettres, chiffres, tirets ou points.",
    es: "Nombre de remoto no válido: usa letras, números, guiones o puntos.",
    de: "Ungültiger Remote-Name: Verwenden Sie Buchstaben, Zahlen, Bindestriche oder Punkte.",
  },
  "remote.nameNotSafe": {
    en: "The remote name cannot be used safely.",
    it: "Il nome del remote non può essere usato in modo sicuro.",
    fr: "Le nom du dépôt distant ne peut pas être utilisé en toute sécurité.",
    es: "El nombre del remoto no se puede usar de forma segura.",
    de: "Der Remote-Name kann nicht sicher verwendet werden.",
  },
  "remote.invalidUrl": {
    en: "Invalid remote URL: no spaces, control characters or transport helpers.",
    it: "URL del remote non valido: niente spazi, caratteri di controllo o helper di trasporto.",
    fr: "URL de dépôt distant invalide : pas d’espaces, de caractères de contrôle ni d’assistants de transport.",
    es: "URL de remoto no válida: sin espacios, caracteres de control ni ayudantes de transporte.",
    de: "Ungültige Remote-URL: keine Leerzeichen, Steuerzeichen oder Transport-Helper.",
  },
  "remote.configureFailed": {
    en: "The remote could not be configured: {reason}",
    it: "Configurazione del remote non riuscita: {reason}",
    fr: "La configuration du dépôt distant a échoué : {reason}",
    es: "No se ha podido configurar el remoto: {reason}",
    de: "Das Remote konnte nicht konfiguriert werden: {reason}",
  },
  "remote.removeFailed": {
    en: "The remote could not be removed: {reason}",
    it: "Rimozione del remote non riuscita: {reason}",
    fr: "La suppression du dépôt distant a échoué : {reason}",
    es: "No se ha podido eliminar el remoto: {reason}",
    de: "Das Remote konnte nicht entfernt werden: {reason}",
  },

  // Stash and conflict actions that reached Git and came back failing.
  "stash.actionFailed": {
    en: "The stash operation failed: {reason}",
    it: "Operazione sullo stash non riuscita: {reason}",
    fr: "L’opération sur le stash a échoué : {reason}",
    es: "La operación sobre el stash ha fallado: {reason}",
    de: "Der Stash-Vorgang ist fehlgeschlagen: {reason}",
  },
  "conflict.actionFailed": {
    en: "The operation failed: {reason}", it: "Operazione non riuscita: {reason}",
    fr: "L’opération a échoué : {reason}", es: "La operación ha fallado: {reason}",
    de: "Der Vorgang ist fehlgeschlagen: {reason}",
  },

  // Linking, continued: the checks that need Git to answer first.
  "link.checkFolderFailed": {
    en: "The chosen Git folder could not be checked: {reason}",
    it: "Impossibile verificare la cartella Git selezionata: {reason}",
    fr: "Impossible de vérifier le dossier Git choisi : {reason}",
    es: "No se ha podido comprobar la carpeta Git elegida: {reason}",
    de: "Der gewählte Git-Ordner konnte nicht geprüft werden: {reason}",
  },
  "link.indexUnreadable": {
    en: "The Git index could not be checked: {reason}",
    it: "Impossibile verificare l’indice Git: {reason}",
    fr: "Impossible de vérifier l’index Git : {reason}",
    es: "No se ha podido comprobar el índice de Git: {reason}",
    de: "Der Git-Index konnte nicht geprüft werden: {reason}",
  },
  "link.initFailed": {
    en: "The Git repository could not be initialised: {reason}",
    it: "Impossibile inizializzare la repository Git: {reason}",
    fr: "Impossible d’initialiser le dépôt Git : {reason}",
    es: "No se ha podido inicializar el repositorio Git: {reason}",
    de: "Das Git-Repository konnte nicht initialisiert werden: {reason}",
  },
  "link.fetchUrlsUnreadable": {
    en: "The fetch URLs of origin could not be checked: {reason}",
    it: "Impossibile verificare gli URL fetch di origin: {reason}",
    fr: "Impossible de vérifier les URL fetch d’origin : {reason}",
    es: "No se han podido comprobar las URL de fetch de origin: {reason}",
    de: "Die Fetch-URLs von origin konnten nicht geprüft werden: {reason}",
  },
  "link.pushUrlsUnreadable": {
    en: "The push URLs of origin could not be checked: {reason}",
    it: "Impossibile verificare gli URL push di origin: {reason}",
    fr: "Impossible de vérifier les URL push d’origin : {reason}",
    es: "No se han podido comprobar las URL de push de origin: {reason}",
    de: "Die Push-URLs von origin konnten nicht geprüft werden: {reason}",
  },

  // Undoing a `git init` that the app itself had just done.
  "rollback.metadataUnreadable": {
    en: ".git could not be checked: {reason}",
    it: "Impossibile verificare .git: {reason}",
    fr: "Impossible de vérifier .git : {reason}",
    es: "No se ha podido comprobar .git: {reason}",
    de: ".git konnte nicht geprüft werden: {reason}",
  },
  "rollback.metadataUnresolvable": {
    en: ".git could not be resolved: {reason}",
    it: "Impossibile risolvere .git: {reason}",
    fr: "Impossible de résoudre .git : {reason}",
    es: "No se ha podido resolver .git: {reason}",
    de: ".git konnte nicht aufgelöst werden: {reason}",
  },
  "rollback.removeFailed": {
    en: "‘{path}’ could not be removed: {reason}",
    it: "Impossibile rimuovere ‘{path}’: {reason}",
    fr: "Impossible de supprimer « {path} » : {reason}",
    es: "No se ha podido eliminar «{path}»: {reason}",
    de: "„{path}“ konnte nicht entfernt werden: {reason}",
  },

  // Scanning a workspace folder.
  // `{reason}` carries the message from the operating system, and that arrives
  // in the language of Windows, not the one chosen here. Verified: on an Italian
  // Windows the German sentence ends with an Italian fragment. That is correct —
  // it is the system speaking, like Git — and rewriting it would mean inventing
  // words it never said.
  "scan.rootUnreadable": {
    en: "‘{path}’ could not be opened: {reason}",
    it: "Impossibile aprire ‘{path}’: {reason}",
    fr: "Impossible d’ouvrir « {path} » : {reason}",
    es: "No se ha podido abrir «{path}»: {reason}",
    de: "„{path}“ konnte nicht geöffnet werden: {reason}",
  },
  "scan.rootNotFolder": {
    en: "The path is not a folder: {path}", it: "Il percorso non è una cartella: {path}",
    fr: "Le chemin n’est pas un dossier : {path}", es: "La ruta no es una carpeta: {path}",
    de: "Der Pfad ist kein Ordner: {path}",
  },

  // Notifications composed from an error or a count. The reason arrives
  // separate from the sentence: the translation decides where to put it.
  "notify.sessionUnavailable": {
    en: "GitHub session unavailable: {reason}",
    it: "Sessione GitHub non disponibile: {reason}",
    fr: "Session GitHub indisponible : {reason}",
    es: "Sesión de GitHub no disponible: {reason}",
    de: "GitHub-Sitzung nicht verfügbar: {reason}",
  },
  "notify.refreshFailed": {
    en: "The update failed: {reason}", it: "Aggiornamento non riuscito: {reason}",
    fr: "La mise à jour a échoué : {reason}", es: "La actualización ha fallado: {reason}",
    de: "Die Aktualisierung ist fehlgeschlagen: {reason}",
  },
  "notify.scanFailed": {
    en: "The scan failed: {reason}", it: "Scansione non riuscita: {reason}",
    fr: "L’analyse a échoué : {reason}", es: "El análisis ha fallado: {reason}",
    de: "Der Scan ist fehlgeschlagen: {reason}",
  },
  "notify.cancelFailed": {
    en: "The operation could not be stopped: {reason}",
    it: "Interruzione non riuscita: {reason}",
    fr: "L’arrêt a échoué : {reason}",
    es: "No se ha podido detener la operación: {reason}",
    de: "Der Abbruch ist fehlgeschlagen: {reason}",
  },
  "notify.githubUnavailable": {
    en: "GitHub repositories unavailable: {reason}",
    it: "Repository GitHub non disponibili: {reason}",
    fr: "Dépôts GitHub indisponibles : {reason}",
    es: "Repositorios de GitHub no disponibles: {reason}",
    de: "GitHub-Repositorys nicht verfügbar: {reason}",
  },
  "notify.revealFailed": {
    en: "The path could not be opened: {reason}",
    it: "Impossibile aprire il percorso: {reason}",
    fr: "Impossible d’ouvrir le chemin : {reason}",
    es: "No se ha podido abrir la ruta: {reason}",
    de: "Der Pfad konnte nicht geöffnet werden: {reason}",
  },
  "notify.linkedAlready": {
    en: "{name} was already linked and has been selected.",
    it: "{name} era già collegata ed è stata selezionata.",
    fr: "{name} était déjà lié et a été sélectionné.",
    es: "{name} ya estaba enlazado y se ha seleccionado.",
    de: "{name} war bereits verknüpft und wurde ausgewählt.",
  },
  "notify.linkedNow": {
    en: "{name} linked to GitHub. No push was made.",
    it: "{name} collegata a GitHub. Nessun push eseguito.",
    fr: "{name} lié à GitHub. Aucun push effectué.",
    es: "{name} enlazado con GitHub. No se ha hecho ningún push.",
    de: "{name} mit GitHub verknüpft. Es wurde kein Push ausgeführt.",
  },
  "notify.fileUpdatedOne": {
    en: "{count} file updated.", it: "{count} file aggiornato.",
    fr: "{count} fichier mis à jour.", es: "{count} archivo actualizado.",
    de: "{count} Datei aktualisiert.",
  },
  "notify.fileUpdatedMany": {
    en: "{count} files updated.", it: "{count} file aggiornati.",
    fr: "{count} fichiers mis à jour.", es: "{count} archivos actualizados.",
    de: "{count} Dateien aktualisiert.",
  },
  "activity.openAria": {
    en: "Open the activity list, {count} results",
    it: "Apri attività, {count} risultati",
    fr: "Ouvrir la liste d’activité, {count} résultats",
    es: "Abrir la lista de actividad, {count} resultados",
    de: "Aktivitätsliste öffnen, {count} Ergebnisse",
  },
  "app.lastCompleted": {
    en: "Last completed: {name}", it: "Ultima completata: {name}",
    fr: "Dernier terminé : {name}", es: "Último completado: {name}",
    de: "Zuletzt abgeschlossen: {name}",
  },
  "branch.listAria": {
    en: "Branches of {name}", it: "Branch di {name}",
    fr: "Branches de {name}", es: "Ramas de {name}",
    de: "Branches von {name}",
  },
  "inspector.selectFileAria": {
    en: "Select {file} in {group}", it: "Seleziona {file} in {group}",
    fr: "Sélectionner {file} dans {group}", es: "Seleccionar {file} en {group}",
    de: "{file} in {group} auswählen",
  },
  "table.selectAria": {
    en: "Select {name}", it: "Seleziona {name}",
    fr: "Sélectionner {name}", es: "Seleccionar {name}",
    de: "{name} auswählen",
  },
  "create.doneReadme": {
    en: "The repository was initialised with a README.",
    it: "La repository è stata inizializzata con un README.",
    fr: "Le dépôt a été initialisé avec un README.",
    es: "El repositorio se ha inicializado con un README.",
    de: "Das Repository wurde mit einer README initialisiert.",
  },
  "create.doneReadmeOnBranch": {
    en: "The repository was initialised with a README on the branch {branch}.",
    it: "La repository è stata inizializzata con un README sul branch {branch}.",
    fr: "Le dépôt a été initialisé avec un README sur la branche {branch}.",
    es: "El repositorio se ha inicializado con un README en la rama {branch}.",
    de: "Das Repository wurde mit einer README auf dem Branch {branch} initialisiert.",
  },
  "create.withReadme": {
    en: "Initial README", it: "README iniziale", fr: "README initial",
    es: "README inicial", de: "Anfängliche README",
  },
  "create.emptyRepository": {
    en: "Empty repository", it: "Repository vuota", fr: "Dépôt vide",
    es: "Repositorio vacío", de: "Leeres Repository",
  },
  "create.openOnGitHub": {
    en: "Open on GitHub", it: "Apri su GitHub", fr: "Ouvrir sur GitHub",
    es: "Abrir en GitHub", de: "Auf GitHub öffnen",
  },
  "delete.localKeptOne": {
    en: "Files, Git history and local remotes stay available in {path}.",
    it: "File, cronologia Git e remote locali restano disponibili in {path}.",
    fr: "Fichiers, historique Git et dépôts distants locaux restent disponibles dans {path}.",
    es: "Los archivos, el historial de Git y los remotos locales siguen disponibles en {path}.",
    de: "Dateien, Git-Verlauf und lokale Remotes bleiben in {path} verfügbar.",
  },
  "delete.localKeptMany": {
    en: "Files, Git history and local remotes stay available in the {count} folders found.",
    it: "File, cronologia Git e remote locali restano disponibili nelle {count} cartelle rilevate.",
    fr: "Fichiers, historique Git et dépôts distants locaux restent disponibles dans les {count} dossiers détectés.",
    es: "Los archivos, el historial de Git y los remotos locales siguen disponibles en las {count} carpetas detectadas.",
    de: "Dateien, Git-Verlauf und lokale Remotes bleiben in den {count} gefundenen Ordnern verfügbar.",
  },

  // Dashboard labels, and texts only a screen reader ever pronounces. The
  // latter escaped every earlier search precisely because they cannot be seen:
  // an `aria-label` never appears on screen, so looking at the app is not enough
  // to find them.
  "app.workspaceEyebrow": {
    en: "Workspace", it: "Workspace", fr: "Espace de travail",
    es: "Espacio de trabajo", de: "Arbeitsbereich",
  },
  "app.repositoriesTitle": {
    en: "Repositories", it: "Repository", fr: "Dépôts",
    es: "Repositorios", de: "Repositorys",
  },
  "app.filtersAria": {
    en: "Repository filters", it: "Filtri repository", fr: "Filtres de dépôts",
    es: "Filtros de repositorios", de: "Repository-Filter",
  },
  "app.filterStateAria": {
    en: "Repository state", it: "Stato repository", fr: "État des dépôts",
    es: "Estado de los repositorios", de: "Repository-Status",
  },
  "app.clearSearch": {
    en: "Clear the search", it: "Cancella ricerca", fr: "Effacer la recherche",
    es: "Borrar la búsqueda", de: "Suche löschen",
  },
  "app.refreshAllAria": {
    en: "Refresh the state of every repository",
    it: "Aggiorna lo stato di tutte le repository",
    fr: "Actualiser l’état de tous les dépôts",
    es: "Actualizar el estado de todos los repositorios",
    de: "Status aller Repositorys aktualisieren",
  },
  "app.refreshAllTitle": {
    en: "Refresh the state", it: "Aggiorna stato", fr: "Actualiser l’état",
    es: "Actualizar el estado", de: "Status aktualisieren",
  },
  "app.repositoryListAria": {
    en: "Repository list", it: "Elenco repository", fr: "Liste des dépôts",
    es: "Lista de repositorios", de: "Repository-Liste",
  },
  "app.batchActionsAria": {
    en: "Actions on the selected repositories",
    it: "Azioni sulle repository selezionate",
    fr: "Actions sur les dépôts sélectionnés",
    es: "Acciones sobre los repositorios seleccionados",
    de: "Aktionen für die ausgewählten Repositorys",
  },
  "app.selectedCount": {
    en: "{count} selected", it: "{count} selezionate", fr: "{count} sélectionnés",
    es: "{count} seleccionados", de: "{count} ausgewählt",
  },
  "app.hiddenByFilter": {
    en: "{count} outside the current filter",
    it: "{count} fuori dal filtro corrente",
    fr: "{count} en dehors du filtre actuel",
    es: "{count} fuera del filtro actual",
    de: "{count} außerhalb des aktuellen Filters",
  },
  "app.deselect": {
    en: "Deselect", it: "Deseleziona", fr: "Désélectionner",
    es: "Deseleccionar", de: "Auswahl aufheben",
  },
  "common.optional": {
    en: "optional", it: "opzionale", fr: "facultatif",
    es: "opcional", de: "optional",
  },
  "create.namePlaceholder": {
    en: "project-name", it: "nome-progetto", fr: "nom-du-projet",
    es: "nombre-proyecto", de: "projektname",
  },
  "create.descriptionPlaceholder": {
    en: "What is this repository for?", it: "A cosa serve questa repository?",
    fr: "À quoi sert ce dépôt ?", es: "¿Para qué sirve este repositorio?",
    de: "Wofür ist dieses Repository?",
  },
  "create.summaryAria": {
    en: "Creation summary", it: "Riepilogo creazione", fr: "Résumé de la création",
    es: "Resumen de la creación", de: "Zusammenfassung der Erstellung",
  },
  "create.permissionDenied": {
    en: "Insufficient GitHub permission (403)",
    it: "Permesso GitHub insufficiente (403)",
    fr: "Permission GitHub insuffisante (403)",
    es: "Permiso de GitHub insuficiente (403)",
    de: "Unzureichende GitHub-Berechtigung (403)",
  },
  "link.remoteNowPointsTo": {
    en: "The remote {remote} now points to {repository}.",
    it: "Il remote {remote} punta ora a {repository}.",
    fr: "Le dépôt distant {remote} pointe maintenant vers {repository}.",
    es: "El remoto {remote} ahora apunta a {repository}.",
    de: "Das Remote {remote} zeigt jetzt auf {repository}.",
  },
  "link.remoteLinked": {
    en: "Remote linked", it: "Remote collegato", fr: "Dépôt distant lié",
    es: "Remoto enlazado", de: "Remote verknüpft",
  },
  "link.repositoryChoiceAria": {
    en: "GitHub repository to link", it: "Repository GitHub da collegare",
    fr: "Dépôt GitHub à lier", es: "Repositorio de GitHub que enlazar",
    de: "Zu verknüpfendes GitHub-Repository",
  },
  "link.summaryAria": {
    en: "Link summary", it: "Riepilogo collegamento", fr: "Résumé de la liaison",
    es: "Resumen del enlace", de: "Zusammenfassung der Verknüpfung",
  },
  "inspector.detailsAria": {
    en: "Details of {name}", it: "Dettagli di {name}", fr: "Détails de {name}",
    es: "Detalles de {name}", de: "Details zu {name}",
  },
  "sync.eyebrow": {
    en: "Safety check", it: "Controllo di sicurezza", fr: "Contrôle de sécurité",
    es: "Comprobación de seguridad", de: "Sicherheitsprüfung",
  },

  // Texts that sat on a line of their own inside the JSX. They stayed
  // untranslated longer than any other: the searches looked for `>text<` on the
  // same line, and these are not. Opening the app is what found them.
  "app.summaryCount": {
    en: "{count} repositories", it: "{count} repository", fr: "{count} dépôts",
    es: "{count} repositorios", de: "{count} Repositorys",
  },
  "app.summaryDirty": {
    en: "{count} with changes", it: "{count} con modifiche",
    fr: "{count} avec des modifications", es: "{count} con cambios",
    de: "{count} mit Änderungen",
  },
  "app.pickFolder": {
    en: "Choose a folder", it: "Scegli cartella", fr: "Choisir un dossier",
    es: "Elegir una carpeta", de: "Ordner wählen",
  },
  "app.linkFolderToGitHub": {
    en: "Link a folder to GitHub", it: "Collega cartella a GitHub",
    fr: "Lier un dossier à GitHub", es: "Enlazar una carpeta con GitHub",
    de: "Ordner mit GitHub verknüpfen",
  },
  "app.clearFilters": {
    en: "Clear the filters", it: "Azzera filtri", fr: "Réinitialiser les filtres",
    es: "Restablecer los filtros", de: "Filter zurücksetzen",
  },
  "inspector.branch": {
    en: "Branch", it: "Branch", fr: "Branche", es: "Rama", de: "Branch",
  },
  "inspector.tools": {
    en: "Tools", it: "Strumenti", fr: "Outils", es: "Herramientas", de: "Werkzeuge",
  },
  "inspector.reveal": {
    en: "Show the folder", it: "Mostra cartella", fr: "Afficher le dossier",
    es: "Mostrar la carpeta", de: "Ordner anzeigen",
  },
  "inspector.revealInFileManager": {
    en: "Show in the file manager", it: "Mostra nel file manager",
    fr: "Afficher dans le gestionnaire de fichiers",
    es: "Mostrar en el explorador de archivos",
    de: "Im Dateimanager anzeigen",
  },
  "inspector.diffUnstaged": {
    en: "Not staged", it: "Non staged", fr: "Non indexé",
    es: "Sin preparar", de: "Nicht vorgemerkt",
  },
  "inspector.diffStaged": {
    en: "Staged", it: "Staged", fr: "Indexé", es: "Preparado", de: "Vorgemerkt",
  },
  "inspector.diffTruncated": {
    en: "The diff was shortened because it exceeds the display limit.",
    it: "Diff abbreviato perché supera il limite di visualizzazione.",
    fr: "Le diff a été raccourci car il dépasse la limite d’affichage.",
    es: "El diff se ha acortado porque supera el límite de visualización.",
    de: "Der Diff wurde gekürzt, weil er das Anzeigelimit überschreitet.",
  },
  "delete.backToRepositories": {
    en: "Back to the repositories", it: "Torna alle repository",
    fr: "Retour aux dépôts", es: "Volver a los repositorios",
    de: "Zurück zu den Repositorys",
  },
  "delete.confirmationHelp": {
    en: "Capitals, lower case, spaces and characters must all match.",
    it: "Maiuscole, minuscole, spazi e caratteri devono coincidere.",
    fr: "Majuscules, minuscules, espaces et caractères doivent correspondre.",
    es: "Mayúsculas, minúsculas, espacios y caracteres deben coincidir.",
    de: "Groß- und Kleinschreibung, Leerzeichen und Zeichen müssen übereinstimmen.",
  },
  "link.showInDashboard": {
    en: "Show in the dashboard", it: "Mostra nella dashboard",
    fr: "Afficher dans le tableau de bord", es: "Mostrar en el panel",
    de: "Im Dashboard anzeigen",
  },

  "app.resultCount": {
    en: "{shown} of {total}", it: "{shown} di {total}", fr: "{shown} sur {total}",
    es: "{shown} de {total}", de: "{shown} von {total}",
  },

  "app.connectAccountFirst": {
    en: "Link your GitHub account first", it: "Collega prima il tuo account GitHub",
    fr: "Liez d’abord votre compte GitHub", es: "Enlaza antes tu cuenta de GitHub",
    de: "Verknüpfen Sie zuerst Ihr GitHub-Konto",
  },
  "app.cloneFromGitHub": {
    en: "Clone from GitHub", it: "Clona da GitHub", fr: "Cloner depuis GitHub",
    es: "Clonar desde GitHub", de: "Von GitHub klonen",
  },
  "app.fetch": {
    en: "Fetch", it: "Fetch", fr: "Fetch", es: "Fetch", de: "Fetch",
  },

  "app.tagline": {
    en: "Multiple Git repositories", it: "Più repository Git",
    fr: "Plusieurs dépôts Git", es: "Varios repositorios Git",
    de: "Mehrere Git-Repositorys",
  },

  "delete.nothingTouched": {
    en: "RubyRepo deleted no folder, changed no origin and pushed nothing.",
    it: "RubyRepo non ha eliminato cartelle, modificato origin o eseguito push.",
    fr: "RubyRepo n’a supprimé aucun dossier, modifié aucun origin ni effectué de push.",
    es: "RubyRepo no ha eliminado ninguna carpeta, no ha cambiado ningún origin y no ha hecho push.",
    de: "RubyRepo hat keinen Ordner gelöscht, kein origin geändert und nichts gepusht.",
  },

  "app.installAppFirst": {
    en: "Install the GitHub App first", it: "Installa prima la GitHub App",
    fr: "Installez d’abord la GitHub App", es: "Instala antes la GitHub App",
    de: "Installieren Sie zuerst die GitHub App",
  },
  "delete.localFoldersIntact": {
    en: "Any local folders will be left intact",
    it: "Le eventuali cartelle locali resteranno intatte",
    fr: "Les éventuels dossiers locaux resteront intacts",
    es: "Las carpetas locales que haya quedarán intactas",
    de: "Etwaige lokale Ordner bleiben unberührt",
  },

  // Texts whose previous JSX shape hid them from the untranslated-text check.
  "common.toChoose": {
    en: "To be chosen", it: "Da scegliere", fr: "À choisir",
    es: "Por elegir", de: "Noch auszuwählen",
  },
  "commit.fileSummary": {
    en: "{staged} staged · {modified} modified · {untracked} new",
    it: "{staged} staged · {modified} modificati · {untracked} nuovi",
    fr: "{staged} indexés · {modified} modifiés · {untracked} nouveaux",
    es: "{staged} preparados · {modified} modificados · {untracked} nuevos",
    de: "{staged} vorgemerkt · {modified} geändert · {untracked} neu",
  },
  "commit.noStagedWarning": {
    en: "There are no staged files: stage selected files first or enable Stage all.",
    it: "Non ci sono file staged: esegui prima lo staging selettivo oppure abilita Stage all.",
    fr: "Aucun fichier n’est indexé : indexez d’abord les fichiers sélectionnés ou activez Tout indexer.",
    es: "No hay archivos preparados: prepara primero los archivos seleccionados o activa Preparar todo.",
    de: "Es sind keine Dateien vorgemerkt: Merke zuerst ausgewählte Dateien vor oder aktiviere Alles vormerken.",
  },
  "create.descriptionCount": {
    en: "{count}/350 characters", it: "{count}/350 caratteri", fr: "{count}/350 caractères",
    es: "{count}/350 caracteres", de: "{count}/350 Zeichen",
  },
  "create.openNewFallback": {
    en: "Alternatively, open github.com/new", it: "Apri in alternativa github.com/new",
    fr: "Sinon, ouvrir github.com/new", es: "Como alternativa, abre github.com/new",
    de: "Alternativ github.com/new öffnen",
  },
  "delete.dangerBody": {
    en: "It will be permanently deleted from GitHub. This deletion cannot be undone by the app.",
    it: "Verrà eliminata definitivamente da GitHub. Questa cancellazione non può essere annullata dall’app.",
    fr: "Il sera définitivement supprimé de GitHub. L’application ne peut pas annuler cette suppression.",
    es: "Se eliminará definitivamente de GitHub. La aplicación no puede deshacer esta eliminación.",
    de: "Es wird endgültig von GitHub gelöscht. Die App kann diese Löschung nicht rückgängig machen.",
  },
  "delete.localFoundMany": {
    en: "{count} linked local folders found", it: "{count} cartelle locali collegate rilevate",
    fr: "{count} dossiers locaux liés détectés", es: "{count} carpetas locales enlazadas detectadas",
    de: "{count} verknüpfte lokale Ordner gefunden",
  },
  "delete.confirmPrompt": {
    en: "To confirm, type exactly", it: "Per confermare, digita esattamente",
    fr: "Pour confirmer, saisissez exactement", es: "Para confirmar, escribe exactamente",
    de: "Gib zur Bestätigung genau Folgendes ein:",
  },
  "inspector.loadingRepository": {
    en: "Reading the repository…", it: "Lettura della repository…",
    fr: "Lecture du dépôt…", es: "Leyendo el repositorio…", de: "Repository wird gelesen…",
  },
  "inspector.selectedCount": {
    en: "{count} selected", it: "{count} selezionati", fr: "{count} sélectionnés",
    es: "{count} seleccionados", de: "{count} ausgewählt",
  },
  "inspector.noRemote": {
    en: "No remote", it: "Nessun remote", fr: "Aucun dépôt distant",
    es: "Sin remoto", de: "Kein Remote",
  },
  "app.batchProgress": {
    en: "{completed} of {total}", it: "{completed} di {total}", fr: "{completed} sur {total}",
    es: "{completed} de {total}", de: "{completed} von {total}",
  },
  "app.scanProgress": {
    en: "{count} found", it: "{count} trovate", fr: "{count} trouvés",
    es: "{count} encontrados", de: "{count} gefunden",
  },
  "notify.cloned": {
    en: "{name} cloned to {path}.", it: "{name} clonata in {path}.",
    fr: "{name} cloné dans {path}.", es: "{name} clonado en {path}.",
    de: "{name} nach {path} geklont.",
  },
  "error.unknown": {
    en: "Unknown error", it: "Errore sconosciuto", fr: "Erreur inconnue",
    es: "Error desconocido", de: "Unbekannter Fehler",
  },

} satisfies Record<string, Entry>;

export type MessageId = keyof typeof messages;

export const MESSAGES: Record<MessageId, Entry> = messages;
