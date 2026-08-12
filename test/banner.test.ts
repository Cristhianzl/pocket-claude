import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type BannerInfo, renderBanner } from "../src/banner.js";

function info(overrides: Partial<BannerInfo> = {}): BannerInfo {
  return {
    version: "1.0.3",
    bot: "@clz_claudebot",
    model: "claude-opus-5",
    root: "~/Documents",
    users: 1,
    skills: 19,
    commands: 20,
    chats: 1,
    ...overrides,
  };
}

const ESCAPE = `${String.fromCharCode(27)}[`;

describe("renderBanner", () => {
  it("should_show_every_configured_value", () => {
    const output = renderBanner(info());

    for (const expected of ["@clz_claudebot", "claude-opus-5", "~/Documents", "v1.0.3"]) {
      assert.ok(output.includes(expected), `expected ${expected} in the banner`);
    }
  });

  it("should_warn_about_the_permission_mode", () => {
    assert.match(renderBanner(info()), /bypassPermissions/);
  });

  it("should_stay_plain_when_color_is_off", () => {
    assert.equal(renderBanner(info()).includes(ESCAPE), false);
  });

  it("should_colour_only_when_asked", () => {
    assert.ok(renderBanner(info(), { color: true }).includes(ESCAPE));
  });

  it("should_keep_the_panel_rectangular", () => {
    const rows = renderBanner(info({ bot: "@a", model: "m" }))
      .split("\n")
      .filter((line) => line.startsWith("  │"));

    assert.ok(rows.length > 0, "the panel must have rows");
    const widths = new Set(rows.map((line) => [...line].length));
    assert.equal(widths.size, 1, `ragged panel: ${[...widths].join(", ")}`);
  });

  it("should_align_the_rows_with_the_border", () => {
    const lines = renderBanner(info()).split("\n");
    const top = lines.find((line) => line.startsWith("  ┌"));
    const bottom = lines.find((line) => line.startsWith("  └"));
    const rows = lines.filter((line) => line.startsWith("  │"));

    for (const row of rows) {
      assert.equal(
        [...row].length,
        [...(top ?? "")].length,
        `row is not flush with the border: ${row}`,
      );
    }
    assert.equal([...(bottom ?? "")].length, [...(top ?? "")].length);
  });

  it("should_keep_the_panel_rectangular_for_long_values", () => {
    const rows = renderBanner(info({ model: "claude-opus-5[1m]", root: "~/Documents/WORK" }))
      .split("\n")
      .filter((line) => line.startsWith("  │"));

    assert.equal(new Set(rows.map((line) => [...line].length)).size, 1);
  });

  it("should_singularise_counts_of_one", () => {
    assert.match(renderBanner(info({ users: 1, chats: 1 })), /1 allowed user\b/);
  });

  it("should_pluralise_counts_above_one", () => {
    const output = renderBanner(info({ users: 3, chats: 2 }));
    assert.match(output, /3 allowed users/);
    assert.match(output, /2 saved sessions/);
  });
});
