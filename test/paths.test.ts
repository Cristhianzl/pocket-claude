import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { isWithinRoot, resolveHome, resolveWithinRoot } from "../src/paths.js";

describe("resolveHome", () => {
  it("should_expand_bare_tilde_when_given_home_marker", () => {
    assert.equal(resolveHome("~", "/home/ana"), "/home/ana");
  });

  it("should_expand_tilde_prefix_when_given_home_relative_path", () => {
    assert.equal(resolveHome("~/code/api", "/home/ana"), "/home/ana/code/api");
  });

  it("should_not_expand_tilde_when_it_is_part_of_a_name", () => {
    assert.equal(resolveHome("~backup", "/home/ana"), path.resolve("~backup"));
  });

  it("should_resolve_relative_paths_against_cwd", () => {
    assert.equal(resolveHome("./src"), path.resolve("./src"));
  });
});

describe("isWithinRoot", () => {
  it("should_accept_the_root_itself", () => {
    assert.equal(isWithinRoot("/srv/work", "/srv/work"), true);
  });

  it("should_accept_a_descendant", () => {
    assert.equal(isWithinRoot("/srv/work", "/srv/work/api/src"), true);
  });

  it("should_reject_a_sibling_sharing_the_root_prefix", () => {
    assert.equal(isWithinRoot("/srv/work", "/srv/work-evil"), false);
  });

  it("should_reject_a_parent_directory", () => {
    assert.equal(isWithinRoot("/srv/work", "/srv"), false);
  });

  it("should_reject_traversal_that_escapes_after_normalization", () => {
    assert.equal(isWithinRoot("/srv/work", "/srv/work/../../etc"), false);
  });
});

describe("resolveWithinRoot", () => {
  let root: string;
  let outside: string;

  before(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-claude-paths-"));
    // The temp dir itself can be a symlink (/tmp -> /private/tmp on macOS), so
    // the fixture root is resolved before use.
    const realBase = await fs.realpath(base);
    root = path.join(realBase, "approved");
    outside = path.join(realBase, "secrets");
    await fs.mkdir(path.join(root, "api"), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "keys.txt"), "top secret", "utf8");
    await fs.symlink(outside, path.join(root, "escape"), "dir");
  });

  after(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("should_accept_a_directory_inside_the_root", async () => {
    const result = await resolveWithinRoot("api", root, root);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.path, path.join(root, "api"));
  });

  it("should_accept_the_root_itself", async () => {
    const result = await resolveWithinRoot(root, root, root);
    assert.equal(result.ok, true);
  });

  it("should_reject_relative_traversal_out_of_the_root", async () => {
    const result = await resolveWithinRoot("../secrets", root, root);
    assert.deepEqual(result, { ok: false, reason: "outside-root" });
  });

  it("should_reject_an_absolute_path_outside_the_root", async () => {
    const result = await resolveWithinRoot(outside, root, root);
    assert.deepEqual(result, { ok: false, reason: "outside-root" });
  });

  // Regression: lexical containment alone accepted this, letting the agent
  // operate outside APPROVED_DIRECTORY.
  it("should_reject_a_symlink_inside_the_root_that_points_outside", async () => {
    const result = await resolveWithinRoot("escape", root, root);
    assert.deepEqual(result, { ok: false, reason: "outside-root" });
  });

  it("should_reject_a_file_reached_through_an_escaping_symlink", async () => {
    const result = await resolveWithinRoot("escape/keys.txt", root, root);
    assert.deepEqual(result, { ok: false, reason: "outside-root" });
  });

  it("should_report_not_found_for_a_missing_path_inside_the_root", async () => {
    const result = await resolveWithinRoot("does-not-exist", root, root);
    assert.deepEqual(result, { ok: false, reason: "not-found" });
  });
});
