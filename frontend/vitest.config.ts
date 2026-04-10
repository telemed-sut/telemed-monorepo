/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      exclude: [
        "**/*.d.ts",
        "tests/**",
        "app/**",
        "next.config.ts",
        "vitest.config.ts",
      ],
      thresholds: {
        lines: 20,
        functions: 20,
        statements: 20,
        branches: 15,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
