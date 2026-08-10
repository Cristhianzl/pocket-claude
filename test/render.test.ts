import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeToolUse,
  escapeHtml,
  markdownToTelegramHtml,
  splitForTelegram,
} from "../src/render.js";

const TELEGRAM_MAX = 4096;

function tagsBalanced(html: string): boolean {
  for (const [open, close] of [
    ["<pre><code>", "</code></pre>"],
    ["<code>", "</code>"],
    ["<b>", "</b>"],
    ["<i>", "</i>"],
  ] as const) {
    const opens = html.split(open).length - 1;
    const closes = html.split(close).length - 1;
    // <pre><code> also matches <code>, so compare the surplus rather than raw counts.
    if (open === "<code>") {
      const pre = html.split("<pre><code>").length - 1;
      if (opens - pre !== closes - pre) return false;
    } else if (opens !== closes) {
      return false;
    }
  }
  return true;
}

describe("escapeHtml", () => {
  it("should_escape_the_three_characters_telegram_parses", () => {
    assert.equal(escapeHtml(`<b>&</b>`), "&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("should_escape_ampersands_before_angle_brackets", () => {
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });
});

describe("markdownToTelegramHtml", () => {
  it("should_neutralize_injected_markup", () => {
    const html = markdownToTelegramHtml("<script>alert(1)</script>");
    assert.equal(html.includes("<script>"), false);
    assert.equal(html.includes("&lt;script&gt;"), true);
  });

  it("should_escape_html_inside_fenced_code", () => {
    const html = markdownToTelegramHtml("```ts\nconst x = a < b && c > d;\n```");
    assert.match(html, /<pre><code>const x = a &lt; b &amp;&amp; c &gt; d;/);
  });

  it("should_convert_inline_code_bold_and_headings", () => {
    const html = markdownToTelegramHtml("## Title\nUse **bold** and `code`.");
    assert.match(html, /<b>Title<\/b>/);
    assert.match(html, /<b>bold<\/b>/);
    assert.match(html, /<code>code<\/code>/);
  });

  it("should_handle_multiple_fenced_blocks", () => {
    const html = markdownToTelegramHtml("a\n```\none\n```\nb\n```\ntwo\n```");
    assert.equal(html.split("<pre><code>").length - 1, 2);
    assert.equal(tagsBalanced(html), true);
  });

  it("should_return_empty_string_for_blank_input", () => {
    assert.equal(markdownToTelegramHtml("   \n  "), "");
  });

  it("should_leave_an_unterminated_fence_as_escaped_text", () => {
    const html = markdownToTelegramHtml("```\nunclosed");
    assert.equal(html.includes("<pre>"), false);
  });
});

describe("splitForTelegram", () => {
  it("should_not_split_content_that_already_fits", () => {
    assert.deepEqual(splitForTelegram("short"), ["short"]);
  });

  it("should_keep_every_chunk_within_the_telegram_limit", () => {
    const chunks = splitForTelegram("line\n".repeat(3000));
    for (const chunk of chunks) assert.ok(chunk.length <= TELEGRAM_MAX, `chunk of ${chunk.length}`);
  });

  it("should_close_and_reopen_code_blocks_that_span_a_cut", () => {
    const html = markdownToTelegramHtml(`intro\n\`\`\`\n${"x".repeat(6000)}\n\`\`\``);
    const chunks = splitForTelegram(html);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.equal(tagsBalanced(chunk), true);
  });

  it("should_not_emit_a_tiny_chunk_when_an_early_newline_exists", () => {
    const chunks = splitForTelegram(`hi\n${"x".repeat(6000)}`);
    assert.ok(chunks[0]!.length > 1000, `first chunk was ${chunks[0]!.length}`);
  });

  it("should_preserve_all_content_across_chunks", () => {
    const body = "abcde\n".repeat(2000);
    assert.equal(splitForTelegram(body).join("").replace(/\n/g, ""), body.replace(/\n/g, ""));
  });
});

describe("describeToolUse", () => {
  it("should_render_bash_commands_with_a_prompt_marker", () => {
    assert.equal(describeToolUse("Bash", { command: "npm test" }), "$ npm test");
  });

  it("should_collapse_whitespace_in_multiline_commands", () => {
    assert.equal(describeToolUse("Bash", { command: "a\n  b\n  c" }), "$ a b c");
  });

  it("should_truncate_long_values", () => {
    const line = describeToolUse("Bash", { command: "x".repeat(500) });
    assert.ok(line.length < 200);
    assert.match(line, /\.\.\.$/);
  });

  it("should_name_file_tools_with_their_path", () => {
    assert.equal(describeToolUse("Edit", { file_path: "/srv/a.ts" }), "edit /srv/a.ts");
    assert.equal(describeToolUse("Read", { file_path: "/srv/a.ts" }), "read /srv/a.ts");
  });

  it("should_fall_back_to_the_tool_name_for_unknown_tools", () => {
    assert.equal(describeToolUse("Mystery", {}), "Mystery");
    assert.match(describeToolUse("Mystery", { a: 1 }), /^Mystery /);
  });

  it("should_not_throw_on_missing_expected_fields", () => {
    for (const name of ["Bash", "Read", "Edit", "Glob", "Grep", "WebFetch", "Task"]) {
      assert.doesNotThrow(() => describeToolUse(name, {}));
    }
  });
});
