// Verifica che ogni classe usata nei componenti esista nel foglio di stile.
//
// Esiste perche' tre dialog interi sono stati consegnati senza stile: erano
// scritti con classi `dialog-*` mentre la convenzione del progetto e' `modal-*`,
// e nessuna di quelle classi esisteva. I test non potevano accorgersene —
// verificano il comportamento, e `getByRole` trova allo stesso modo un pulsante
// corretto e uno invisibile — quindi il difetto era visibile soltanto aprendo
// l'app. Questo controllo costa un secondo e rende quel guasto un errore di
// verifica invece di qualcosa che scopre l'utente.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DIR = "src";
const STYLESHEET = join(SOURCE_DIR, "App.css");

/// Classi che non stanno nel foglio di stile perche' arrivano da altrove:
/// modificatori di stato applicati da JavaScript, utilita' di terze parti.
const ALLOWED = new Set(["spin", "is-active", "is-selected", "is-current", "has-error"]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [path];
  });
}

const stylesheet = readFileSync(STYLESHEET, "utf8");
const defined = new Set([...stylesheet.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

const problems = [];
for (const file of sourceFiles(SOURCE_DIR)) {
  const text = readFileSync(file, "utf8");
  const used = new Set();

  // Solo le stringhe letterali: le espressioni interpolate contengono nomi di
  // variabile che non sono classi, e trattarle come tali darebbe falsi allarmi.
  for (const match of text.matchAll(/className="([^"{}]+)"/g)) {
    for (const name of match[1].split(/\s+/).filter(Boolean)) used.add(name);
  }
  for (const match of text.matchAll(/className=\{`([^`]*)`\}/g)) {
    for (const piece of match[1].split(/\$\{[^}]*\}/)) {
      for (const name of piece.split(/\s+/).filter(Boolean)) {
        // `toast--${tone}` lascia il frammento `toast--`: e' un prefisso che
        // l'espressione completa, non una classe da cercare.
        if (name.endsWith("-")) continue;
        used.add(name);
      }
    }
  }

  const missing = [...used].filter((name) => !defined.has(name) && !ALLOWED.has(name)).sort();
  if (missing.length > 0) problems.push({ file, missing });
}

if (problems.length === 0) {
  console.log("Classi CSS: nessuna classe usata senza definizione.");
  process.exit(0);
}

console.error("Classi usate nei componenti ma assenti da " + STYLESHEET + ":\n");
for (const { file, missing } of problems) {
  console.error("  " + file);
  for (const name of missing) console.error("      " + name);
}
console.error(
  "\nSe una di queste e' voluta, definiscila nel foglio di stile oppure aggiungila\n" +
    "all'elenco ALLOWED in scripts/check-css-classes.mjs spiegando da dove arriva.",
);
process.exit(1);
