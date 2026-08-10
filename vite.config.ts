import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Allinea l'output alle webview effettivamente usate da Tauri invece che al
  // baseline generico di Vite: WebView2 su Windows e WKWebView su macOS. I
  // sourcemap accompagnano solo le build di debug.
  // I test dei componenti hanno bisogno di un DOM; quelli sulle funzioni pure
  // girerebbero anche senza, ma un ambiente solo evita due configurazioni.
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/demoData.ts", "src/**/*.test.{ts,tsx}"],
      // Soglie deliberatamente basse: fotografano la copertura di oggi, non
      // quella che vorremmo. Servono a impedire che scenda, non a dichiarare
      // che il frontend e' coperto — non lo e'. Vanno alzate ogni volta che si
      // aggiungono test, altrimenti sono decorazione.
      thresholds: {
        statements: 38.5,
        branches: 34.0,
        functions: 36.7,
        lines: 39.9,
      },
    },
  },

  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "oxc",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: "icons",
              test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
});
