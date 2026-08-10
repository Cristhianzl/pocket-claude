import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { StateStore } from "../src/store.js";

async function tempFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "teleclaude-store-"));
  return path.join(dir, "nested", "state.json");
}

describe("StateStore", () => {
  it("should_return_undefined_for_an_unknown_chat", async () => {
    const store = new StateStore(await tempFile());
    assert.equal(await store.get(1), undefined);
  });

  it("should_persist_and_read_back_a_chat_state", async () => {
    const file = await tempFile();
    await new StateStore(file).set(7, { cwd: "/srv/api", sessionId: "abc" });

    const reloaded = new StateStore(file);
    assert.deepEqual(await reloaded.get(7), { cwd: "/srv/api", sessionId: "abc" });
  });

  it("should_create_missing_parent_directories", async () => {
    const file = await tempFile();
    await new StateStore(file).set(1, { cwd: "/srv", sessionId: null });
    assert.ok((await fs.stat(file)).isFile());
  });

  it("should_keep_chats_isolated_from_each_other", async () => {
    const file = await tempFile();
    const store = new StateStore(file);
    await store.set(1, { cwd: "/a", sessionId: "s1" });
    await store.set(2, { cwd: "/b", sessionId: "s2" });

    const reloaded = new StateStore(file);
    assert.equal((await reloaded.get(1))?.cwd, "/a");
    assert.equal((await reloaded.get(2))?.cwd, "/b");
  });

  // Concurrent writes previously raced on the same file.
  it("should_not_lose_writes_issued_concurrently", async () => {
    const file = await tempFile();
    const store = new StateStore(file);

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.set(index, { cwd: `/p/${index}`, sessionId: `s${index}` }),
      ),
    );

    const reloaded = new StateStore(file);
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await reloaded.get(index))?.sessionId, `s${index}`);
    }
  });

  it("should_start_empty_when_the_file_holds_invalid_json", async () => {
    const file = await tempFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ not json", "utf8");

    assert.equal(await new StateStore(file).get(1), undefined);
  });

  // A hand-edited or truncated file must not crash the bot on the first message.
  it("should_ignore_a_file_whose_shape_is_wrong", async () => {
    const file = await tempFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ "1": { cwd: 42 } }), "utf8");

    const store = new StateStore(file);
    assert.equal(await store.get(1), undefined);
    await assert.doesNotReject(store.set(1, { cwd: "/ok", sessionId: null }));
  });

  it("should_overwrite_an_existing_chat_entry", async () => {
    const file = await tempFile();
    const store = new StateStore(file);
    await store.set(1, { cwd: "/old", sessionId: "old" });
    await store.set(1, { cwd: "/new", sessionId: null });

    assert.deepEqual(await new StateStore(file).get(1), { cwd: "/new", sessionId: null });
  });
});
