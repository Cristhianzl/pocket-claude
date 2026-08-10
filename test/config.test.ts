import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { buildConfig, ConfigError } from "../src/config.js";
import { PLACEHOLDERS } from "../src/env.js";

const valid = {
  TELEGRAM_BOT_TOKEN: "9876543210:XYZ-real-token-value-abcdefghij",
  TELEGRAM_BOT_USERNAME: "real_bot",
  APPROVED_DIRECTORY: "/srv/work",
  ALLOWED_USERS: "111,222",
};

describe("buildConfig", () => {
  it("should_parse_a_complete_configuration", () => {
    const config = buildConfig(valid);
    assert.equal(config.botToken, valid.TELEGRAM_BOT_TOKEN);
    assert.equal(config.botUsername, "real_bot");
    assert.deepEqual([...config.allowedUsers], [111, 222]);
    assert.equal(config.approvedDirectory, "/srv/work");
  });

  it("should_strip_a_leading_at_from_the_bot_username", () => {
    assert.equal(
      buildConfig({ ...valid, TELEGRAM_BOT_USERNAME: "@real_bot" }).botUsername,
      "real_bot",
    );
  });

  it("should_default_the_state_file_when_unset", () => {
    assert.equal(buildConfig(valid).stateFile, path.resolve("./data/state.json"));
  });

  it("should_leave_the_model_undefined_when_unset", () => {
    assert.equal(buildConfig(valid).model, undefined);
  });

  for (const name of Object.keys(valid)) {
    it(`should_reject_a_missing_${name}`, () => {
      const source: Record<string, string | undefined> = { ...valid };
      delete source[name];
      assert.throws(() => buildConfig(source), ConfigError);
    });

    it(`should_reject_a_blank_${name}`, () => {
      assert.throws(() => buildConfig({ ...valid, [name]: "   " }), ConfigError);
    });

    // Catching template values is the difference between a clear startup error
    // and a confusing 401 from Telegram.
    it(`should_reject_the_template_value_for_${name}`, () => {
      assert.throws(() => buildConfig({ ...valid, [name]: PLACEHOLDERS[name]! }), ConfigError);
    });
  }

  it("should_reject_non_numeric_allowed_users", () => {
    assert.throws(() => buildConfig({ ...valid, ALLOWED_USERS: "111,@ana" }), ConfigError);
  });

  it("should_reject_an_allowed_users_list_of_only_separators", () => {
    assert.throws(() => buildConfig({ ...valid, ALLOWED_USERS: " , , " }), ConfigError);
  });

  it("should_ignore_empty_entries_between_separators", () => {
    assert.deepEqual(
      [...buildConfig({ ...valid, ALLOWED_USERS: "111,,222," }).allowedUsers],
      [111, 222],
    );
  });
});
