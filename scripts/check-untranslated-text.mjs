// Trova i testi leggibili dall'utente che non passano da `t()`.
//
// Il controllo usa l'AST TSX invece di espressioni regolari: un paragrafo su
// piu' righe e un template con interpolazioni hanno la stessa struttura di
// quelli su una sola riga, quindi non possono sparire dal controllo cambiando
// soltanto l'impaginazione del sorgente.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const USER_FACING_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "placeholder",
  "summary",
  "title",
]);

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (entry.name.includes(".test.") || entry.name.includes("dictionary")) return [];
    if (entry.name === "demoData.ts") return [];
    return [path];
  });
}

function normalise(value) {
  return value.replace(/\s+/g, " ").trim();
}

function containsWords(value) {
  return /\p{L}.*\p{L}/u.test(value);
}

function templateText(template) {
  return normalise(
    template.head.text +
      template.templateSpans
        .map((span) => `{...}${span.literal.text}`)
        .join(""),
  );
}

function scanSource(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = [];
  const seen = new Set();

  function add(node, kind, rawText) {
    const visible = normalise(rawText);
    if (!containsWords(visible)) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const text = `${kind}: ${visible}`;
    const key = `${line}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push([file, line, text]);
  }

  // Reads only expressions whose result itself is rendered. It deliberately
  // does not descend into calls or callbacks: strings in event handlers, CSS
  // class choices and message identifiers are implementation details.
  function visibleExpression(node, kind) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add(node, kind, node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      add(node, kind, templateText(node));
      return;
    }
    if (ts.isConditionalExpression(node)) {
      visibleExpression(node.whenTrue, kind);
      visibleExpression(node.whenFalse, kind);
      return;
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      visibleExpression(node.expression, kind);
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(node.operatorToken.kind)
    ) {
      visibleExpression(node.left, kind);
      visibleExpression(node.right, kind);
    }
  }

  function messageTarget(node) {
    if (ts.isNewExpression(node)) {
      return ts.isIdentifier(node.expression) && node.expression.text === "Error";
    }
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return false;
    const name = node.expression.text;
    return name === "notify" || /^set.*(?:Error|Message)$/.test(name);
  }

  function visit(node) {
    if (ts.isJsxText(node)) add(node, "testo", node.text);

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (USER_FACING_ATTRIBUTES.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) add(node.initializer, name, node.initializer.text);
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          visibleExpression(node.initializer.expression, name);
        }
      }
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      !ts.isJsxAttribute(node.parent)
    ) {
      visibleExpression(node.expression, "testo");
    }

    if (messageTarget(node)) {
      const argument = node.arguments?.[0];
      if (argument) visibleExpression(argument, "messaggio");
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

// Via cio' che non e' prosa dell'interfaccia: nomi propri, comandi e termini
// Git che rimangono uguali nelle lingue supportate.
const IGNORE = [
  /^testo: (?:GitHub(?: · @)?|Git|Pull|Push|Commit|README|origin|HEAD|main|npm run tauri dev|RepoFlow|push:)$/,
];

// Testi che restano deliberatamente in una lingua sola, con il motivo.
const ALLOWED = new Map([
  ["testo: RubyRepo", "nome proprio"],
  // Il nome del permesso come lo scrive GitHub nelle sue impostazioni:
  // tradurlo renderebbe impossibile trovarlo nella pagina indicata.
  ["testo: Administration: Read and write", "nome del permesso su GitHub"],
  ["placeholder: https://github.com/owner/repository.git", "esempio di URL"],
  // Compare solo se un componente viene montato fuori dal provider.
  [
    "messaggio: useTranslation needs a TranslationProvider above it in the tree.",
    "rivolto a chi sviluppa",
  ],
]);

function remaining(findings) {
  return findings.filter(
    ([, , text]) => !IGNORE.some((rule) => rule.test(text)) && !ALLOWED.has(text),
  );
}

function selfTest(announceSuccess = false) {
  const fixture = [
    "function Fixture({ count, danger, ready }) {",
    "  return <>",
    "    <p>",
    "      Paragrafo italiano",
    "      disposto su due righe.",
    "    </p>",
    '    <p>{`Hai ${count} repository`}</p>',
    '    <p>{ready ? "Da scegliere" : t("common.toChoose")}</p>',
    "    <button",
    '      className={danger ? "button button--danger" : "button"}',
    '      aria-label={t("common.close")}',
    '      onClick={() => notify(t("notify.refreshed"))}',
    '    >{t("common.close")}</button>',
    '    <input placeholder="https://github.com/owner/repository.git" />',
    "  </>;",
    "}",
  ].join("\n");
  const result = remaining(scanSource("fixture.tsx", fixture));
  const texts = result.map(([, , text]) => text);
  const expected = [
    "testo: Paragrafo italiano disposto su due righe.",
    "testo: Hai {...} repository",
    "testo: Da scegliere",
  ];
  const missing = expected.filter((text) => !texts.includes(text));
  const unexpected = texts.filter((text) => !expected.includes(text));
  if (missing.length > 0 || unexpected.length > 0) {
    console.error("Autoverifica check:text fallita.");
    if (missing.length > 0) console.error(`  Non trovati: ${missing.join(" | ")}`);
    if (unexpected.length > 0) console.error(`  Falsi positivi: ${unexpected.join(" | ")}`);
    process.exit(1);
  }
  if (announceSuccess) {
    console.log("Autoverifica check:text: JSX multilinea e interpolato rilevati, fixture tradotte ignorate.");
  }
}

if (process.argv.includes("--self-test")) {
  selfTest(true);
} else {
  selfTest();
  const found = files("src").flatMap((file) => scanSource(file, readFileSync(file, "utf8")));
  const untranslated = remaining(found);

  if (untranslated.length > 0) {
    console.error("Testi leggibili dall'utente che non passano da t():");
    for (const [file, line, text] of untranslated) {
      console.error(`  ${file}:${line}  ${text}`);
    }
    console.error("\nSe uno di questi deve restare com'e', aggiungilo a ALLOWED con il motivo.");
    process.exit(1);
  }

  console.log(`Testi: nessuno fuori da t(), ${ALLOWED.size} eccezioni dichiarate.`);
}
