import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: /api requests go to the Django backend so the SPA
// does not need CORS for local development. Build output is static.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.js"],
  },
});
