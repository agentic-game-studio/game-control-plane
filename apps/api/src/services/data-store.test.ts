/**
 * Per-file mutex regression tests for the data-store.
 *
 * The mutex in `updateData` is the single thing that keeps two
 * concurrent read-modify-write cycles from clobbering each other.
 * This test fires many concurrent updates against the same file and
 * asserts that every update is observed in the final state — a
 * regression in the mutex would lose some updates silently.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readData, updateData, writeData } from "./data-store.js";

interface Counter {
  count: number;
}

describe("data-store updateData mutex", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "data-store-test-"));
    // data-store hardcodes its DATA_DIR relative to its own file. We
    // cannot easily monkey-patch the module path with vitest's API in a
    // portable way, but for this test we only need the per-filename
    // mutex Map to behave correctly — that lives in module scope, not
    // on the filesystem, so concurrent updates serialize on the lock
    // even though they all hit the same on-disk file (which they will
    // race on if the mutex is broken).
    void dataDir;
  });

  it("serializes concurrent updaters so all increments are observed", async () => {
    // Initialize the counter file with the right shape.
    await writeData("counter.json", { count: 0 } satisfies Counter);

    // Fire 50 concurrent incrementers. A broken mutex would let
    // multiple readers see `count = N`, each compute `N+1`, and the
    // last writer wins — so the final count would be << 50.
    const N = 50;
    await Promise.all(
      Array.from({ length: N }, () =>
        updateData<Counter>("counter.json", (d) => ({ count: d.count + 1 })),
      ),
    );

    const final = await readData<Counter>("counter.json");
    expect(final.count).toBe(N);
  });

  it("preserves ordered changes when each updater reads the prior value", async () => {
    await writeData("history.json", { events: [] as string[] });

    const writers = ["a", "b", "c", "d", "e"].map((label) =>
      updateData<{ events: string[] }>("history.json", (d) => ({
        events: [...d.events, label],
      })),
    );

    await Promise.all(writers);
    const final = await readData<{ events: string[] }>("history.json");
    // Every label must appear exactly once.
    expect(final.events.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("releases the lock on updater throw so the next caller can proceed", async () => {
    await writeData("explodes.json", { count: 0 } satisfies Counter);

    // First updater throws. Without a `finally`-style release, the
    // lock would be stranded and the next caller would hang until
    // vitest's testTimeout.
    await expect(
      updateData<Counter>("explodes.json", () => {
        throw new Error("synthetic failure");
      }),
    ).rejects.toThrow("synthetic failure");

    // Lock should be released — this should resolve promptly.
    const after = await updateData<Counter>("explodes.json", (d) => ({
      count: d.count + 1,
    }));
    expect(after.count).toBe(1);
  });
});

// Suppress an unused-var warning for the dataDir fixture.
void rmSync;
