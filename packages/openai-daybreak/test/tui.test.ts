import assert from "node:assert/strict"
import { test } from "node:test"
import type { Plugin } from "@opencode/plugin/tui"
import { runDaybreak } from "../src/tui-command.js"

function harness() {
  const toasts: { message: string; variant: string }[] = []
  const calls: { method: string; input: unknown; options: unknown }[] = []
  let route: { type: string; sessionID?: string } = { type: "session", sessionID: "ses_a" }
  let failure: unknown
  const method = (name: string) => async (input: { sessionID: string; mode?: string }, options: unknown) => {
    calls.push({ method: name, input, options })
    if (failure !== undefined) throw failure
    return input.mode ?? null
  }
  const context = {
    client: {
      session: {
        get: async () => ({ location: { directory: "/work/actual-session-project" } }),
      },
      rpc: () => ({ status: method("status"), set: method("set"), reset: method("reset") }),
    },
    ui: {
      router: { current: () => route },
      toast: { show: (toast: (typeof toasts)[number]) => toasts.push(toast) },
    },
  } as unknown as Plugin.Context
  return {
    context,
    toasts,
    calls,
    route(value: typeof route) {
      route = value
    },
    fail(error: unknown) {
      failure = error
    },
  }
}

test("/daybreak blue targets the current session and its actual location", async () => {
  const fixture = harness()
  await runDaybreak(fixture.context, "blue")
  assert.deepEqual(fixture.calls, [
    {
      method: "set",
      input: { sessionID: "ses_a", mode: "blue" },
      options: { location: { directory: "/work/actual-session-project" } },
    },
  ])
  assert.match(fixture.toasts[0]!.message, /daybreak_blue/)
  assert.equal(fixture.toasts[0]!.variant, "success")
})

test("bare /daybreak only queries status", async () => {
  const fixture = harness()
  await runDaybreak(fixture.context)
  assert.equal(fixture.calls[0]!.method, "status")
  assert.equal(fixture.toasts[0]!.variant, "info")
  assert.match(fixture.toasts[0]!.message, /provider defaults/)
})

test("reset is independent from explicit standard", async () => {
  const fixture = harness()
  await runDaybreak(fixture.context, "standard")
  await runDaybreak(fixture.context, "reset")
  assert.deepEqual(
    fixture.calls.map((call) => call.method),
    ["set", "reset"],
  )
})

test("switching session routes does not reuse another session's ID", async () => {
  const fixture = harness()
  await runDaybreak(fixture.context, "blue")
  fixture.route({ type: "session", sessionID: "ses_b" })
  await runDaybreak(fixture.context, "red")
  assert.deepEqual(
    fixture.calls.map((call) => call.input),
    [
      { sessionID: "ses_a", mode: "blue" },
      { sessionID: "ses_b", mode: "red" },
    ],
  )
})

test("invalid arguments show usage without an RPC or model call", async () => {
  const fixture = harness()
  await runDaybreak(fixture.context, "blue red")
  assert.equal(fixture.calls.length, 0)
  assert.equal(fixture.toasts[0]!.variant, "error")
  assert.match(fixture.toasts[0]!.message, /Usage:/)
})

test("home screen never creates a session or changes defaults", async () => {
  const fixture = harness()
  fixture.route({ type: "home" })
  await runDaybreak(fixture.context, "blue")
  assert.equal(fixture.calls.length, 0)
  assert.equal(fixture.toasts[0]!.variant, "warning")
})

test("server failures produce an error, not a misleading success", async () => {
  const fixture = harness()
  fixture.fail(new Error("RPC unavailable"))
  await runDaybreak(fixture.context, "blue")
  assert.equal(fixture.toasts[0]!.variant, "error")
  assert.equal(fixture.toasts[0]!.message, "RPC unavailable")
})

test("plain-object RPC failures preserve the server's message", async () => {
  const fixture = harness()
  fixture.fail({ type: "rpc.internal", message: "Session not found" })
  await runDaybreak(fixture.context, "blue")
  assert.equal(fixture.toasts[0]!.variant, "error")
  assert.equal(fixture.toasts[0]!.message, "Session not found")
})

test("unrecognized failures use a safe fallback message", async () => {
  for (const failure of [null, false, 0, "RPC unavailable", {}, { message: 42 }]) {
    const fixture = harness()
    fixture.fail(failure)
    await runDaybreak(fixture.context, "blue")
    assert.equal(fixture.toasts[0]!.variant, "error")
    assert.equal(fixture.toasts[0]!.message, "Could not update the session setting.")
  }
})
