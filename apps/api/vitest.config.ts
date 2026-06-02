import { defineConfig } from "vitest/config";

/**
 * Shared vitest config for the API. The two important knobs:
 *
 * 1. `pool: "forks"` — the data-store mutex + verification dedup tests
 *    exercise shared in-memory state (fileLocks Map, consecutiveFailures).
 *    In a multi-worker run, a Map mutation in one worker would not be
 *    visible in another, and we'd silently lose the ordering assertion.
 *    Forking also avoids the (admittedly small) risk of a runaway test
 *    process contaminating the next test.
 *
 * 2. `testTimeout: 15_000` — the auth-timing test is a statistical
 *    measurement. The default 5s is too tight for cases where the JIT
 *    decides to GC right in the middle of a sample, and we don't want a
 *    slow CI host to flake the security test.
 */
export default defineConfig({
  test: {
    pool: "forks",
    testTimeout: 15_000,
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: ["src/**/*.e2e.test.ts"],
    env: {
      // Tests must never talk to a real LLM provider. The pre-existing
      // producer-summary test relies on these placeholders being present
      // (zod refuses to parse without at least one provider), and the new
      // verification/llm tests build on the same assumption.
      ZAI_API_KEY: "test_zai_key_placeholder_16chars",
      API_SECRET: "test_api_secret_for_unit_tests_only_32chars",
      // Disable pino file transport in tests — it tries to create rotated
      // log files under apps/api/logs/, which (a) pollutes the working
      // directory, (b) triggers a worker-thread config error on some
      // pino-file-transport versions when retention vs archive.frequency
      // don't agree, and (c) is unnecessary for unit tests that don't
      // assert on log file contents.
      LOG_TO_FILE: "false",
    },
  },
});
