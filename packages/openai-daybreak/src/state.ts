import type { Plugin } from "@opencode/plugin"
import { isMode, type Mode } from "./daybreak.js"

type Storage = Pick<Plugin.Context["storage"], "get" | "set" | "remove">

/** Read through to OpenCode's durable, server-wide plugin storage; do not cache per location or TUI. */
export function sessionState(storage: Storage) {
  const key = (sessionID: string) => `session/${sessionID}`
  return {
    async get(sessionID: string): Promise<Mode | null> {
      const value = await storage.get(key(sessionID))
      if (value === undefined) return null
      if (!isMode(value)) throw new Error("Daybreak: invalid stored session setting. Use /daybreak reset.")
      return value
    },
    async set(sessionID: string, mode: Mode): Promise<void> {
      await storage.set(key(sessionID), mode)
    },
    async reset(sessionID: string): Promise<void> {
      await storage.remove(key(sessionID))
    },
  }
}
