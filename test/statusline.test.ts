import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getLogLevel, log, setLogLevel, setLogSink } from "../src/logger.js";
import { formatStats, formatUptime, type Stats, StatusLine } from "../src/statusline.js";

const ESC = `${String.fromCharCode(27)}[`;

function stats(overrides: Partial<Stats> = {}): Stats {
  return { chats: 1, turns: 12, costUsd: 0.48, busy: false, billedPerToken: true, ...overrides };
}

function harness(overrides: Partial<Stats> = {}) {
  const written: string[] = [];
  let clock = 0;
  const line = new StatusLine({
    read: () => stats(overrides),
    write: (text) => written.push(text),
    columns: () => 60,
    now: () => clock,
    intervalMs: 10_000,
  });
  return { line, written, tick: (ms: number) => (clock += ms) };
}

const originalLevel = getLogLevel();

afterEach(() => {
  setLogSink();
  setLogLevel(originalLevel);
});

describe("formatUptime", () => {
  it("should_show_seconds_below_a_minute", () => {
    assert.equal(formatUptime(42_000), "42s");
  });

  it("should_show_minutes_and_seconds_below_an_hour", () => {
    assert.equal(formatUptime(125_000), "2m05s");
  });

  it("should_show_hours_and_minutes_above_an_hour", () => {
    assert.equal(formatUptime(8_040_000), "2h14m");
  });

  it("should_not_go_negative", () => {
    assert.equal(formatUptime(-5), "0s");
  });
});

describe("formatStats", () => {
  it("should_render_every_field", () => {
    assert.equal(formatStats(stats(), 8_040_000), "up 2h14m │ 1 chat │ 12 turns │ $0.48 │ idle");
  });

  it("should_mark_a_working_agent", () => {
    assert.match(formatStats(stats({ busy: true }), 0), /working$/);
  });

  it("should_mark_a_subscription_cost_as_an_estimate", () => {
    assert.match(formatStats(stats({ billedPerToken: false }), 0), /~\$0\.48/);
  });

  it("should_singularise_a_single_chat_and_turn", () => {
    assert.match(formatStats(stats({ chats: 1, turns: 1 }), 0), /1 chat │ 1 turn │/);
  });
});

describe("StatusLine", () => {
  it("should_hide_the_cursor_while_running", () => {
    const { line, written } = harness();
    line.start();
    line.stop();
    assert.ok(
      written.some((text) => text.includes(`${ESC}?25l`)),
      "cursor must be hidden",
    );
    assert.ok(written.at(-1)?.includes(`${ESC}?25h`), "cursor must be restored last");
  });

  it("should_erase_before_redrawing", () => {
    const { line, written } = harness();
    line.start();
    written.length = 0;
    line.refresh();
    assert.ok((written[0] ?? "").startsWith(`${ESC}3A${ESC}0J`));
  });

  it("should_not_erase_before_it_has_drawn", () => {
    const { line, written } = harness();
    line.erase();
    assert.deepEqual(written, []);
  });

  it("should_wrap_a_log_line_between_erase_and_redraw", () => {
    const { line, written } = harness();
    setLogLevel("info");
    line.start();
    written.length = 0;

    log.info("hello");

    assert.ok((written[0] ?? "").startsWith(`${ESC}3A`));
    assert.match(written[1] ?? "", /hello/);
    assert.match(written[2] ?? "", /up 0s/);
  });

  it("should_restore_the_plain_sink_on_stop", () => {
    const { line, written } = harness();
    setLogLevel("info");
    line.start();
    line.stop();
    written.length = 0;

    log.info("after stop");

    assert.deepEqual(written, []);
  });

  it("should_advance_the_uptime_it_reports", () => {
    const { line, written, tick } = harness();
    line.start();
    tick(65_000);
    written.length = 0;
    line.refresh();

    assert.ok(
      written.some((text) => text.includes("up 1m05s")),
      `expected the uptime to advance: ${written.join("")}`,
    );
  });
});
