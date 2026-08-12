import fs from "node:fs/promises";
import path from "node:path";

export type ChatState = {
  cwd: string;
  sessionId: string | null;
};

type StateFile = Record<string, ChatState>;

/**
 * Persists the chat -> project/session mapping so a restart resumes where the
 * conversation left off.
 */
export class StateStore {
  #file: string;
  #cache: StateFile | null = null;
  /**
   * The in-flight load is memoized. Without it, concurrent callers each read
   * the file and install their own fresh object, discarding the mutations the
   * others already made to theirs.
   */
  #loading: Promise<StateFile> | null = null;
  /** Writes are chained so concurrent saves cannot clobber each other. */
  #writes: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  #load(): Promise<StateFile> {
    if (this.#cache) return Promise.resolve(this.#cache);
    this.#loading ??= (async () => {
      let state: StateFile = {};
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(this.#file, "utf8"));
        if (isStateFile(parsed)) state = parsed;
      } catch {
        state = {};
      }
      this.#cache = state;
      return state;
    })();
    return this.#loading;
  }

  async get(chatId: number): Promise<ChatState | undefined> {
    return (await this.#load())[String(chatId)];
  }

  async count(): Promise<number> {
    return Object.keys(await this.#load()).length;
  }

  async set(chatId: number, value: ChatState): Promise<void> {
    const state = await this.#load();
    state[String(chatId)] = value;
    this.#writes = this.#writes.then(async () => {
      await fs.mkdir(path.dirname(this.#file), { recursive: true });
      await fs.writeFile(this.#file, JSON.stringify(this.#cache ?? {}, null, 2), "utf8");
    });
    await this.#writes;
  }
}

function isStateFile(value: unknown): value is StateFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as ChatState).cwd === "string" &&
      ((entry as ChatState).sessionId === null ||
        typeof (entry as ChatState).sessionId === "string"),
  );
}
