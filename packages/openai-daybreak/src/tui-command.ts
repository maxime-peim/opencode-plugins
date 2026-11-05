import type { Plugin } from "@opencode/plugin/tui"
import { describeMode, parseCommand, readMode } from "./daybreak.js"
import { Daybreak } from "./rpc.js"

export async function runDaybreak(context: Plugin.Context, input?: string): Promise<void> {
  try {
    const action = parseCommand(input)
    const route = context.ui.router.current()
    if (route.type !== "session") {
      context.ui.toast.show({ title: "Daybreak", message: "Open a session first.", variant: "warning" })
      return
    }
    // Use the selected session's location, not the TUI launch directory (cross-project navigation).
    const session = await context.client.session.get({ sessionID: route.sessionID })
    const options = { location: session.location }
    const daybreak = context.client.rpc(Daybreak)
    const result = await (action === "status"
      ? daybreak.status({ sessionID: route.sessionID }, options)
      : action === "reset"
        ? daybreak.reset({ sessionID: route.sessionID }, options)
        : daybreak.set({ sessionID: route.sessionID, mode: action }, options))
    context.ui.toast.show({
      title: "Daybreak",
      message: describeMode(readMode(result)),
      variant: action === "status" ? "info" : "success",
      duration: 6000,
    })
  } catch (error) {
    const message =
      error !== null && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Could not update the session setting."
    context.ui.toast.show({
      title: "Daybreak",
      message,
      variant: "error",
      duration: 8000,
    })
  }
}
