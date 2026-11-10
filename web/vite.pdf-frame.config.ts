// Build du cadre PDF isolé (UI §13, Task 22) : un script classique (IIFE) pdf-frame.js et
// pdf-frame.css, SANS empreinte dans le nom (servis avec CORP cross-origin par une liste fermée,
// static.go), écrits à côté du site déjà construit (dist ou dist-demo).
import { defineConfig } from "vite";
import { precompress } from "./vite.config.ts";

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    plugins: demo ? [] : [precompress()],
    build: {
      outDir: demo ? "dist-demo" : "dist",
      emptyOutDir: false,
      sourcemap: false,
      copyPublicDir: false,
      lib: { entry: "src/viewers/pdf-frame/main.ts", name: "shhPdfFrame", formats: ["iife"], fileName: () => "pdf-frame.js", cssFileName: "pdf-frame" },
    },
  };
});
