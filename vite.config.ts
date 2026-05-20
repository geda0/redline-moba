import { defineConfig } from "vite";

// Client build. The voice backend (server/) runs separately via `npm run server`.
export default defineConfig({
  server: { port: 5173 },
  build: { target: "es2022", outDir: "dist" },
});
