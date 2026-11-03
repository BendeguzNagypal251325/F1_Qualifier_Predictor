import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs separately (uv run f1qp-serve); Vite forwards /api to it.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": process.env.F1QP_API ?? "http://127.0.0.1:8000" } },
  build: { outDir: "dist", sourcemap: true },
});
