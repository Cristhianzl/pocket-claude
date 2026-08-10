import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACCESS_MESSAGES, decideAccess } from "../src/access.js";

const allowed = new Set([111, 222]);

describe("decideAccess", () => {
  it("should_allow_an_allowlisted_user_in_a_private_chat", () => {
    assert.deepEqual(decideAccess({ userId: 111, chatType: "private" }, allowed), {
      allowed: true,
    });
  });

  it("should_reject_a_user_who_is_not_allowlisted", () => {
    assert.deepEqual(decideAccess({ userId: 999, chatType: "private" }, allowed), {
      allowed: false,
      reason: "unlisted-user",
    });
  });

  it("should_reject_an_update_with_no_sender", () => {
    assert.deepEqual(decideAccess({ userId: undefined, chatType: "private" }, allowed), {
      allowed: false,
      reason: "unlisted-user",
    });
  });

  // The allowlist governs who may send, not who may read. In a group every
  // member would see the contents of files Claude prints.
  for (const chatType of ["group", "supergroup", "channel"]) {
    it(`should_reject_an_allowlisted_user_in_a_${chatType}`, () => {
      assert.deepEqual(decideAccess({ userId: 111, chatType }, allowed), {
        allowed: false,
        reason: "non-private-chat",
      });
    });
  }

  it("should_reject_an_unknown_chat_type", () => {
    assert.deepEqual(decideAccess({ userId: 111, chatType: undefined }, allowed), {
      allowed: false,
      reason: "non-private-chat",
    });
  });

  // Identity is checked first so a stranger in a group is never told the bot is
  // private-only, which would confirm it exists and is running.
  it("should_report_the_user_gate_before_the_chat_gate", () => {
    assert.deepEqual(decideAccess({ userId: 999, chatType: "group" }, allowed), {
      allowed: false,
      reason: "unlisted-user",
    });
  });

  it("should_reject_every_user_when_the_allowlist_is_empty", () => {
    assert.equal(decideAccess({ userId: 111, chatType: "private" }, new Set()).allowed, false);
  });

  it("should_provide_a_message_for_every_rejection_reason", () => {
    for (const reason of ["unlisted-user", "non-private-chat"] as const) {
      assert.ok(ACCESS_MESSAGES[reason].length > 0);
    }
  });
});
