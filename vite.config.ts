import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The wizard and the start-up page: loaded from disk (file://), so every
// path is relative and nothing comes from the network.
export default defineConfig({
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    // Fonts stay files next to the page; the mark is small enough to inline.
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: {
        wizard: path.resolve(__dirname, "src/renderer/index.html"),
        waiting: path.resolve(__dirname, "src/renderer/waiting.html"),
      },
    },
  },
});
