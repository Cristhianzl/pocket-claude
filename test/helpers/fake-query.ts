import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { QueryFn } from "../../src/agent.js";

export type QueryCall = {
  cwd?: string;
  resume?: string;
  model?: string;
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
  settingSources?: string[];
  plugins?: Array<{ type: string; path: string }>;
  systemPrompt?: { type: string; preset: string; append?: string };
};

export function initMessage(overrides: Partial<Record<string, unknown>> = {}): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: "session-1",
    cwd: "/srv/work",
    model: "claude-opus-5",
    apiKeySource: "none",
    tools: [],
    mcp_servers: [],
    permissionMode: "bypassPermissions",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    apiKeySourceDetail: undefined,
    claude_code_version: "test",
    uuid: "uuid-init",
    ...overrides,
  } as unknown as SDKMessage;
}

export function assistantMessage(
  content: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
): SDKMessage {
  return {
    type: "assistant",
    message: { content },
    parent_tool_use_id: null,
    uuid: "uuid-assistant",
    session_id: "session-1",
    ...overrides,
  } as unknown as SDKMessage;
}

export function resultMessage(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1500,
    duration_api_ms: 1200,
    is_error: false,
    num_turns: 1,
    result: "ok",
    stop_reason: "end_turn",
    total_cost_usd: 0.02,
    session_id: "session-1",
    uuid: "uuid-result",
    ...overrides,
  } as unknown as SDKMessage;
}

export type Script = (userText: string, turnIndex: number) => SDKMessage[] | Promise<SDKMessage[]>;

async function* scriptedTurns(
  prompt: AsyncIterable<SDKUserMessage>,
  script: Script,
): AsyncGenerator<SDKMessage> {
  let turn = 0;
  for await (const userMessage of prompt) {
    for (const message of await script(String(userMessage.message.content), turn)) {
      yield message;
    }
    turn += 1;
  }
}

async function* replay(
  prompt: AsyncIterable<SDKUserMessage>,
  options: { script: Script; onStart?: SDKMessage[]; throwOnStart?: Error },
): AsyncGenerator<SDKMessage> {
  if (options.throwOnStart) throw options.throwOnStart;
  for (const message of options.onStart ?? []) yield message;
  yield* scriptedTurns(prompt, options.script);
}

/**
 * A `query()` stand-in that consumes the agent's prompt stream and replays a
 * scripted response per user message, so tests exercise the real streaming-input
 * interaction instead of a stubbed method.
 */
export function makeFakeQuery(options: {
  script: Script;
  onStart?: SDKMessage[];
  throwOnStart?: Error;
}): { queryFn: QueryFn; calls: QueryCall[]; interrupts: () => number } {
  const calls: QueryCall[] = [];
  let interruptCount = 0;

  const queryFn = ((params: { prompt: unknown; options?: QueryCall }) => {
    calls.push(params.options ?? {});

    const generator = replay(params.prompt as AsyncIterable<SDKUserMessage>, options);

    return Object.assign(generator, {
      interrupt: async () => {
        interruptCount += 1;
        return undefined;
      },
      setPermissionMode: async () => undefined,
      setModel: async () => undefined,
      setMcpPermissionModeOverride: async () => ({}),
      supportedCommands: async () => [],
      supportedModels: async () => [],
      mcpServerStatus: async () => [],
    }) as unknown as Query;
  }) as unknown as QueryFn;

  return { queryFn, calls, interrupts: () => interruptCount };
}
