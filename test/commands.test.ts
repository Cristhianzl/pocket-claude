import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { registerCommands } from "../src/commands.js";
import { SessionManager } from "../src/sessions.js";
import { StateStore } from "../src/store.js";
import { fakeAgentFactory, fakeBot, testConfig } from "./helpers/fakes.js";
import { fakeContext, recordingBot } from "./helpers/recording-bot.js";

let root: string;
let outside: string;

before(async () => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pocket-claude-cmd-")));
  root = path.join(base, "approved");
  outside = path.join(base, "secrets");
  await fs.mkdir(path.join(root, "api", "src"), { recursive: true });
  await fs.mkdir(path.join(root, ".hidden"), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(root, "notes.md"), "hello", "utf8");
  await fs.writeFile(path.join(outside, "keys.txt"), "secret", "utf8");
  await fs.symlink(outside, path.join(root, "escape"), "dir");
});

after(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

async function harness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-claude-cmdstate-"));
  const config = testConfig({ APPROVED_DIRECTORY: root });
  const agents = fakeAgentFactory();
  const sessions = new SessionManager(
    fakeBot().bot,
    config,
    new StateStore(path.join(dir, "state.json")),
    agents.factory,
  );
  const recorder = recordingBot();
  registerCommands(recorder.bot, config, sessions);
  return { recorder, sessions, agents, config };
}

describe("/pwd", () => {
  it("should_report_the_current_project", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext();
    await recorder.run("pwd", ctx);
    assert.match(lastReply(), new RegExp(root));
  });
});

describe("/cd", () => {
  it("should_explain_usage_when_no_path_is_given", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ match: "  " });
    await recorder.run("cd", ctx);
    assert.match(lastReply(), /Usage: \/cd/);
  });

  it("should_switch_to_a_directory_inside_the_root", async () => {
    const { recorder, agents } = await harness();
    const { ctx, lastReply } = fakeContext({ match: "api" });
    await recorder.run("cd", ctx);

    assert.match(lastReply(), /Fresh session started/);
    assert.equal(agents.last()?.cwd, path.join(root, "api"));
  });

  it("should_refuse_a_path_outside_the_approved_directory", async () => {
    const { recorder, agents } = await harness();
    const { ctx, lastReply } = fakeContext({ match: outside });
    await recorder.run("cd", ctx);

    assert.match(lastReply(), /Outside APPROVED_DIRECTORY/);
    assert.equal(agents.created.length, 1, "no new session was started");
  });

  it("should_refuse_relative_traversal_out_of_the_root", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ match: "../secrets" });
    await recorder.run("cd", ctx);
    assert.match(lastReply(), /Outside APPROVED_DIRECTORY/);
  });

  // Regression: lexical containment alone accepted this and let the agent work
  // outside APPROVED_DIRECTORY.
  it("should_refuse_a_symlink_that_escapes_the_root", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ match: "escape" });
    await recorder.run("cd", ctx);
    assert.match(lastReply(), /Outside APPROVED_DIRECTORY/);
  });

  it("should_report_a_missing_directory", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ match: "nope" });
    await recorder.run("cd", ctx);
    assert.match(lastReply(), /not found/i);
  });

  it("should_refuse_a_file", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ match: "notes.md" });
    await recorder.run("cd", ctx);
    assert.match(lastReply(), /not a directory/);
  });
});

describe("/ls", () => {
  it("should_list_the_current_directory_when_given_no_argument", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext();
    await recorder.run("ls", ctx);
    assert.match(lastReply(), /api\//);
    assert.match(lastReply(), /notes\.md/);
  });

  it("should_hide_dotfiles", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext();
    await recorder.run("ls", ctx);
    assert.equal(lastReply().includes(".hidden"), false);
  });

  it("should_refuse_a_path_outside_the_approved_directory", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ match: outside });
    await recorder.run("ls", ctx);
    assert.match(lastReply(), /Outside APPROVED_DIRECTORY/);
  });

  it("should_report_a_missing_path", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ match: "nope" });
    await recorder.run("ls", ctx);
    assert.match(lastReply(), /not found/i);
  });
});

describe("/get", () => {
  it("should_explain_usage_when_no_path_is_given", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext();
    await recorder.run("get", ctx);
    assert.match(lastReply(), /Usage: \/get/);
  });

  it("should_send_a_file_inside_the_root", async () => {
    const { recorder } = await harness();
    const { ctx, documents } = fakeContext({ match: "notes.md" });
    await recorder.run("get", ctx);
    assert.equal(documents.length, 1);
  });

  it("should_refuse_a_file_outside_the_approved_directory", async () => {
    const { recorder } = await harness();
    const { ctx, documents, lastReply } = fakeContext({ match: path.join(outside, "keys.txt") });
    await recorder.run("get", ctx);

    assert.equal(documents.length, 0);
    assert.match(lastReply(), /Outside APPROVED_DIRECTORY/);
  });

  it("should_refuse_a_file_reached_through_an_escaping_symlink", async () => {
    const { recorder } = await harness();
    const { ctx, documents, lastReply } = fakeContext({ match: "escape/keys.txt" });
    await recorder.run("get", ctx);

    assert.equal(documents.length, 0);
    assert.match(lastReply(), /Outside APPROVED_DIRECTORY/);
  });

  it("should_refuse_a_directory", async () => {
    const { recorder } = await harness();
    const { ctx, documents, lastReply } = fakeContext({ match: "api" });
    await recorder.run("get", ctx);

    assert.equal(documents.length, 0);
    assert.match(lastReply(), /not a file/);
  });
});

describe("/projects", () => {
  it("should_offer_a_cd_command_per_project", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext();
    await recorder.run("projects", ctx);
    assert.match(lastReply(), new RegExp(`/cd ${path.join(root, "api")}`));
  });

  it("should_hide_dot_directories", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext();
    await recorder.run("projects", ctx);
    assert.equal(lastReply().includes(".hidden"), false);
  });
});

describe("/stop", () => {
  it("should_say_nothing_is_running_when_idle", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext();
    await recorder.run("stop", ctx);
    assert.match(lastReply(), /Nothing is running/);
  });

  it("should_interrupt_a_running_turn", async () => {
    const { recorder, sessions, agents } = await harness();
    await sessions.get(1);
    const agent = agents.last();
    if (agent) agent.busy = true;

    const { ctx, lastReply } = fakeContext();
    await recorder.run("stop", ctx);

    assert.equal(agent?.interrupted, 1);
    assert.match(lastReply(), /Interrupted/);
  });
});

describe("/status", () => {
  it("should_report_a_subscription_login_as_not_billed", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext();
    await recorder.run("status", ctx);

    assert.match(lastReply(), /Claude subscription \(no API key\)/);
    assert.match(lastReply(), /estimate, not billed/);
  });

  it("should_report_an_api_key_login_as_billed", async () => {
    const { recorder, sessions, agents } = await harness();
    await sessions.get(1);
    const agent = agents.last();
    if (agent) agent.apiKeySource = "user";

    const { ctx, lastReply } = fakeContext();
    await recorder.run("status", ctx);

    assert.match(lastReply(), /API key \(user\)/);
    assert.equal(lastReply().includes("not billed"), false);
  });
});

describe("/new", () => {
  it("should_start_a_fresh_session_in_the_same_directory", async () => {
    const { recorder, sessions, agents } = await harness();
    await sessions.reset(1, path.join(root, "api"));

    const { ctx, lastReply } = fakeContext();
    await recorder.run("new", ctx);

    assert.match(lastReply(), /Fresh session/);
    assert.equal(agents.last()?.cwd, path.join(root, "api"));
  });
});

describe("/help", () => {
  it("should_list_every_registered_command", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext();
    await recorder.run("help", ctx);

    for (const command of ["/pwd", "/cd", "/ls", "/projects", "/new", "/stop", "/status", "/get"]) {
      assert.match(lastReply(), new RegExp(command.replace("/", "\\/")));
    }
  });
});
