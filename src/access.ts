export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "unlisted-user" | "non-private-chat" };

export type UpdateIdentity = {
  userId: number | undefined;
  chatType: string | undefined;
};

/**
 * Decides whether an update may reach the agent.
 *
 * Two independent gates, because the allowlist alone is not enough. It controls
 * who may *send* commands, not who may *read* the answers: in a group, every
 * member sees whatever Claude prints — file contents, code, credentials it
 * happened to echo. Restricting to private chats closes that channel.
 */
export function decideAccess(
  update: UpdateIdentity,
  allowedUsers: ReadonlySet<number>,
): AccessDecision {
  if (update.userId === undefined || !allowedUsers.has(update.userId)) {
    return { allowed: false, reason: "unlisted-user" };
  }
  if (update.chatType !== "private") {
    return { allowed: false, reason: "non-private-chat" };
  }
  return { allowed: true };
}

export const ACCESS_MESSAGES: Record<"unlisted-user" | "non-private-chat", string> = {
  "unlisted-user": "Not authorized.",
  "non-private-chat":
    "This bot only works in a direct message. Everyone in a group would be able to read the output of your files and commands.",
};
