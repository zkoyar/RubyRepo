// Esegue un comando forzando su Windows la toolchain Rust MSVC.
//
// Con l'ABI GNU il progetto si compila ma non funziona, in due modi diversi e
// tutti e due silenziosi:
//
//   - l'eseguibile dei test non parte affatto (STATUS_ENTRYPOINT_NOT_FOUND):
//     importa `TaskDialogIndirect` da comctl32 senza il manifest
//     Common-Controls 6, che `tauri-build` inietta soltanto nei target `bin`;
//   - il pacchetto si costruisce ma l'app installata muore all'avvio, perche'
//     `webview2-com-sys` collega staticamente il loader WebView2 solo con MSVC
//     e altrimenti pretende `WebView2Loader.dll` accanto all'eseguibile, che il
//     bundler non include.
//
// Il secondo caso e' il peggiore: produce un installer che sembra riuscito e
// non e' distribuibile. Per questo qui la toolchain mancante e' un errore e non
// un avviso.
//
// Il vincolo non puo' stare in `rust-toolchain.toml`, che accetta un solo
// canale: una tripla Windows li' dentro renderebbe il progetto incompilabile
// altrove. `RUSTUP_TOOLCHAIN` ha la precedenza su quel file, quindi basta
// l'ambiente.

import { spawnSync } from "node:child_process";

const TOOLCHAIN = "stable-x86_64-pc-windows-msvc";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Uso: node scripts/windows-msvc.mjs <comando> [argomenti...]");
  process.exit(2);
}

const env = { ...process.env };

if (process.platform === "win32") {
  const installed = spawnSync("rustup", ["toolchain", "list"], { encoding: "utf8" });
  if (installed.status !== 0 || !installed.stdout.includes(TOOLCHAIN)) {
    console.error(
      `Su Windows questo progetto richiede la toolchain ${TOOLCHAIN}.\n` +
        `Con l'ABI GNU i test non partono e il pacchetto prodotto non si avvia.\n` +
        `Installala con:\n` +
        `  rustup toolchain install ${TOOLCHAIN}`,
    );
    process.exit(1);
  }
  env.RUSTUP_TOOLCHAIN = TOOLCHAIN;
}

// `shell` serve su Windows perche' i comandi di npm sono file .cmd; gli
// argomenti arrivano dagli script del progetto, non dall'esterno.
const result = spawnSync(command, args, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
