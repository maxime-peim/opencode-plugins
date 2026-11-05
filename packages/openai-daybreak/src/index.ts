import { Plugin } from "@opencode/plugin"
import { isMode, record } from "./daybreak.js"
import { Daybreak } from "./rpc.js"
import { sessionState } from "./state.js"
import { rewriteFrame, rewriteRequest } from "./wire.js"

export default Plugin.define({
  id: "oc-openai-daybreak",
  async setup(ctx) {
    const state = sessionState(ctx.storage)

    // JSON Schema validates RPC values at runtime but leaves their TypeScript types unknown.
    async function sessionInput(input: unknown) {
      const value = record(input, "RPC input")
      if (typeof value.sessionID !== "string" || value.sessionID.length === 0) {
        throw new Error("Daybreak: a session ID is required.")
      }
      // Validate that the session exists before reading or changing its durable override.
      await ctx.session.get({ sessionID: value.sessionID })
      return { sessionID: value.sessionID, mode: value.mode }
    }

    await ctx.rpc.register(Daybreak, {
      status: async (input) => {
        const { sessionID } = await sessionInput(input)
        return state.get(sessionID)
      },
      set: async (input) => {
        const { sessionID, mode } = await sessionInput(input)
        if (!isMode(mode)) throw new Error("Daybreak: expected blue, red, or standard.")
        await state.set(sessionID, mode)
        return mode
      },
      reset: async (input) => {
        const { sessionID } = await sessionInput(input)
        await state.reset(sessionID)
        return null
      },
    })

    await ctx.session.hook(
      "http.request",
      async (event) => {
        // Auxiliary models can have different access requirements from the session's selected model.
        if (event.kind !== "primary" && event.kind !== "generate") return
        const mode = await state.get(event.sessionID)
        if (mode === null) return
        event.request = await rewriteRequest(event.request, mode)
      },
      { providerID: "openai" },
    )

    await ctx.session.hook(
      "experimental.ws.send",
      async (event) => {
        if (event.kind !== "primary" && event.kind !== "generate") return
        const mode = await state.get(event.sessionID)
        if (mode === null) return
        event.frame = rewriteFrame(event.frame, mode)
      },
      { providerID: "openai" },
    )
  },
})
