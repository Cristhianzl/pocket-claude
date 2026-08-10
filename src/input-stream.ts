import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Async queue feeding the SDK's streaming-input mode. Keeping one long-lived
 * session (instead of a `query()` per message) is what makes message queueing
 * and `interrupt()` possible.
 */
export class InputStream {
  #buffer: SDKUserMessage[] = [];
  #wake: (() => void) | null = null;
  #closed = false;

  get closed(): boolean {
    return this.#closed;
  }

  get pending(): number {
    return this.#buffer.length;
  }

  push(text: string): void {
    if (this.#closed) return;
    this.#buffer.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      origin: { kind: "human" },
    });
    this.#wake?.();
    this.#wake = null;
  }

  close(): void {
    this.#closed = true;
    this.#wake?.();
    this.#wake = null;
  }

  async *stream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.#buffer.length > 0) {
        yield this.#buffer.shift()!;
      }
      if (this.#closed) return;
      // The Promise executor runs synchronously, so there is no window between
      // draining the buffer and registering the waker where a push is lost.
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
  }
}
