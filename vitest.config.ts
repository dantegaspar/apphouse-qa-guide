import path from "node:path";
import { defineConfig } from "vitest/config";

/** Pruebas unitarias y de integración (npm test). Cada archivo usa su propia base SQLite temporal. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
