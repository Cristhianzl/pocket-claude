import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { formatLine, getLogLevel, log, setLogLevel, setLogSink } from "../src/logger.js";

function capture(): string[] {
  const lines: string[] = [];
  setLogSink((line) => lines.push(line));
  return lines;
}

afterEach(() => {
  setLogSink();
  setLogLevel("info");
});

describe("formatLine", () => {
  it("should_put_timestamp_level_and_message_in_order", () => {
    assert.equal(
      formatLine("info", "2026-01-01T00:00:00.000Z", "started"),
      "2026-01-01T00:00:00.000Z INFO started\n",
    );
  });

  it("should_append_fields_as_key_value_pairs", () => {
    const line = formatLine("warn", "T", "denied", { user_id: 7, reason: "unlisted" });
    assert.equal(line, "T WARN denied user_id=7 reason=unlisted\n");
  });

  it("should_json_encode_non_string_field_values", () => {
    assert.match(formatLine("info", "T", "m", { list: [1, 2] }), /list=\[1,2\]/);
  });

  it("should_end_every_line_with_a_newline", () => {
    assert.match(formatLine("error", "T", "boom"), /\n$/);
  });
});

describe("log levels", () => {
  it("should_emit_at_the_configured_level_and_above", () => {
    const lines = capture();
    setLogLevel("warn");

    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    assert.deepEqual(
      lines.map((line) => line.split(" ")[1]),
      ["WARN", "ERROR"],
    );
  });

  // Without this the outbox fallback test floods the suite output with warnings.
  it("should_emit_nothing_when_silenced", () => {
    const lines = capture();
    setLogLevel("silent");

    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    assert.deepEqual(lines, []);
  });

  it("should_emit_everything_at_debug_level", () => {
    const lines = capture();
    setLogLevel("debug");
    log.debug("d");
    log.info("i");
    assert.equal(lines.length, 2);
  });

  it("should_default_to_info_and_report_the_current_level", () => {
    setLogLevel("info");
    assert.equal(getLogLevel(), "info");
    const lines = capture();
    log.debug("hidden");
    log.info("shown");
    assert.equal(lines.length, 1);
  });

  it("should_restore_the_default_sink_when_cleared", () => {
    const lines = capture();
    setLogSink();
    log.error("goes to stderr");
    assert.deepEqual(lines, []);
  });
});
