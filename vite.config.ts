import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFile } from "node:fs/promises";

export default defineConfig({
  plugins: [react(), {
    name: "release-public-assets",
    async closeBundle() {
      for (const name of ["favicon.svg", "_headers", ".assetsignore"])
        await copyFile(`public/${name}`, `dist/${name}`);
    },
  }],
  build: { copyPublicDir: false },
  server: {
    host: "127.0.0.1",
    port: 5186,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4318" },
  },
});
