// Verifica che ogni identificatore nominato dal backend esista nel dizionario.
//
// Il frontend e' gia' protetto dal compilatore: `MessageId` e' `keyof typeof
// messages`, quindi un `t("chiave.inesistente")` non compila. Il backend no —
// li' un identificatore e' una stringa qualsiasi dentro `AppError::translated`
// o `OperationResult::translated`, e sbagliarla non fa fallire niente: il
// messaggio degrada sulla frase inglese e continua a funzionare, in inglese,
// per tutte e cinque le lingue. E' esattamente il guasto che non si vede.
//
// Il degrado resta voluto — serve a non perdere mai il messaggio — ma un
// identificatore che nessuna voce soddisfa e' un refuso, non una scelta.
//
// Segnala anche le voci del dizionario che nessuno usa: una chiave scritta e
// mai collegata e' lavoro fatto a vuoto, ed e' gia' successo (il primo gruppo
// dei riepiloghi di batch era nel dizionario da giorni senza chiamanti).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DICTIONARY = join("src", "i18n", "dictionary.ts");
const RUST_DIR = join("src-tauri", "src");
const FRONTEND_DIR = "src";

/// Chiavi usate in modo indiretto, dove il nome non compare mai per intero in
/// una chiamata: la lingua scelta, e i due esiti generici del registro.
const ALLOWED_UNUSED = new Set([]);

function filesUnder(directory, matches) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path, matches);
    return matches(entry.name) ? [path] : [];
  });
}

const dictionary = readFileSync(DICTIONARY, "utf8");
const defined = new Set(
  [...dictionary.matchAll(/^ {2}"([\w.]+)":/gm)].map((match) => match[1]),
);

if (defined.size === 0) {
  console.error("Dizionario: nessuna voce trovata, il formato e' cambiato?");
  process.exit(1);
}

// Un identificatore del backend e' il secondo argomento di `translated`, oppure
// l'unico di `OperationResult::translated`. In entrambi i casi e' una stringa
// letterale che contiene un punto, il che basta a distinguerla dal codice.
const rustFiles = filesUnder(RUST_DIR, (name) => name.endsWith(".rs"));
const named = new Map();
const prefixes = new Set();

for (const file of rustFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\.translated\(\s*"([\w.]+)"/g)) {
    named.set(match[1], file);
  }
  // Il codice puo' essere una costante invece di una stringa: `translated(
  // UNAUTHORIZED_REPOSITORY_CODE, "error.unauthorizedRepository", ...)`.
  for (const match of source.matchAll(
    /translated\(\s*(?:"[\w]+"|[A-Za-z_:]+),\s*"([\w.]+)"/g,
  )) {
    named.set(match[1], file);
  }
  // Gli identificatori tenuti in una costante, come quello del conflitto origin.
  for (const match of source.matchAll(/MESSAGE_ID: &str = "([\w.]+)"/g)) {
    named.set(match[1], file);
  }
  // Alcune famiglie sono costruite da un codice tipizzato, per esempio
  // `format!("github.error.{code}")`. Il test del mapper verifica i suffissi;
  // qui il prefisso basta a non dichiarare orfane tutte le voci risultanti.
  for (const match of source.matchAll(
    /format!\(\s*"([\w]+(?:\.[\w]+)+\.)\{[A-Za-z_]\w*\}"/g,
  )) {
    prefixes.add(match[1]);
  }
}

// Rete piu' larga per il solo controllo delle voci orfane: qualunque stringa
// puntata nel backend conta come uso. Serve perche' un identificatore puo'
// passare da una variabile — i quattro casi per operazione dei file scelgono
// prima `(id, frase)` e poi costruiscono l'errore — e li' l'estrazione precisa
// non lo vede. Per il controllo opposto, quello dei refusi, resta la lettura
// stretta: allargarla anche li' finirebbe per accettare qualsiasi stringa.
const mentionedInRust = new Set();
for (const file of rustFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/"([a-z][\w]*(?:\.[\w]+)+)"/g)) {
    mentionedInRust.add(match[1]);
  }
}

const unknown = [...named].filter(([id]) => !defined.has(id));

// Uso lato frontend: `t("...")`, piu' i riferimenti come identificatore nudo
// restituito dalle funzioni pure di `repositoryUtils`.
const frontendFiles = filesUnder(
  FRONTEND_DIR,
  (name) => /\.tsx?$/.test(name) && !name.includes("dictionary"),
);
const used = new Set([...named.keys(), ...mentionedInRust]);

// Alcune chiavi vengono composte a runtime — `sync.strategy.${strategy}`,
// `table.header.${column}` — quindi il nome intero non compare mai nel sorgente.
// Di quelle si raccoglie il prefisso, e una voce che ne comincia con uno conta
// come usata: e' meno preciso, ma il controllo deve segnalare i refusi senza
// costringere a elencare a mano ogni chiave composta.
for (const file of frontendFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/"([\w]+(?:\.[\w]+)+)"/g)) {
    used.add(match[1]);
  }
  for (const match of source.matchAll(/`([\w]+(?:\.[\w]+)*)\.\$\{/g)) {
    prefixes.add(`${match[1]}.`);
  }
}

const orphaned = [...defined].filter(
  (id) =>
    !used.has(id) &&
    !ALLOWED_UNUSED.has(id) &&
    ![...prefixes].some((prefix) => id.startsWith(prefix)),
);

if (unknown.length > 0) {
  console.error("Identificatori nominati dal backend e assenti dal dizionario:");
  for (const [id, file] of unknown) console.error(`  ${id}  (${file})`);
}

if (orphaned.length > 0) {
  console.error("Voci del dizionario che nessuno usa:");
  for (const id of orphaned) console.error(`  ${id}`);
}

if (unknown.length > 0 || orphaned.length > 0) {
  process.exit(1);
}

console.log(
  `Messaggi: ${defined.size} voci, ${named.size} nominate dal backend, nessuna scoperta.`,
);
