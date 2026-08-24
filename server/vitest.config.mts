import { defineConfig } from "vitest/config";

// Without this, vitest's default glob also picks up compiled test files
// under dist/ (left behind by `npm run build`), which then fail to import
// the ESM-only vitest package from CommonJS output.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
