import type { Plugin } from "@opencode/plugin"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

export async function updateContext(directory: string, root: string) {
  const data = join(
    directory,
    existsSync(join(directory, ".understand-anything")) ? ".understand-anything" : ".ua",
  )
  let config: unknown
  try {
    config = JSON.parse(await readFile(join(data, "config.json"), "utf8"))
  } catch {
    return
  }
  if (
    config === null ||
    typeof config !== "object" ||
    !("autoUpdate" in config) ||
    config.autoUpdate !== true
  )
    return

  const { stdout } = await exec("node", [join(root, "hooks/session-start-stale-check.mjs")], {
    cwd: directory,
    timeout: 5000,
    maxBuffer: 64 * 1024,
  })
  if (!stdout.trim()) return
  const context = JSON.parse(stdout).hookSpecificOutput?.additionalContext
  if (typeof context !== "string" || !context.trim()) return
  return `${context}
OpenCode: continue any update already in progress instead of restarting preparation when this reminder reappears. Keep orchestration in this primary session and dispatch native workers named understand-anything/<UA agent name>. Wait for automatic completion notifications, not polling. Resolve bundled paths from ${root}. Respect all tool permissions and do not run concurrent UA workflows against this project.`
}

export async function attachAutoUpdate(ctx: Pick<Plugin.Context, "session">, root: string) {
  // A context check covers session start and post-commit without queuing extra model turns.
  await ctx.session.hook("context", async (event) => {
    if (event.agent !== "build") return
    try {
      const session = await ctx.session.get({ sessionID: event.sessionID })
      if (session.parentID) return
      const text = await updateContext(session.location.directory, root)
      if (text) event.system.push({ type: "text", text })
    } catch (error) {
      event.system.push({
        type: "text",
        text: `[understand-anything] Automatic freshness check failed: ${error instanceof Error ? error.message : String(error)}. Do not claim the graph is current; report this warning and offer a manual /understand run.`,
      })
    }
  })
}
