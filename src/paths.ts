import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type PathResolution =
  | { ok: true; path: string }
  | { ok: false; reason: "outside-root" | "not-found" };

export function resolveHome(input: string, home: string = os.homedir()): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.join(home, input.slice(2));
  return path.resolve(input);
}

/**
 * Lexical containment test. `root + sep` rather than a bare `startsWith` so
 * `/srv/workspace-evil` is not treated as living inside `/srv/workspace`.
 */
export function isWithinRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}

/**
 * Resolves a user-supplied path and confines it to `root`.
 *
 * Lexical containment alone is bypassable: a symlink *inside* the root pointing
 * outside it passes `isWithinRoot` while resolving elsewhere. Both the root and
 * the target are therefore resolved through `realpath` before comparing.
 */
export async function resolveWithinRoot(
  input: string,
  base: string,
  root: string,
): Promise<PathResolution> {
  const target =
    input.startsWith("/") || input.startsWith("~") ? resolveHome(input) : path.resolve(base, input);

  if (!isWithinRoot(root, target)) return { ok: false, reason: "outside-root" };

  const realTarget = await realpathOrNull(target);
  if (realTarget === null) return { ok: false, reason: "not-found" };

  // The root itself may be reached through a symlink (/tmp on macOS), so it is
  // resolved too rather than compared against its lexical form.
  const realRoot = (await realpathOrNull(root)) ?? path.resolve(root);
  if (!isWithinRoot(realRoot, realTarget)) return { ok: false, reason: "outside-root" };

  return { ok: true, path: realTarget };
}
