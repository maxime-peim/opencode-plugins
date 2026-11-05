import assert from "node:assert/strict"
import { test } from "node:test"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/index.js"
import { sessionState } from "../src/state.js"

type Stored = Awaited<ReturnType<Plugin.Context["storage"]["get"]>>

async function harness(values = new Map<string, Stored>()) {
  const hooks = new Map<string, { run: (event: never) => Promise<void>; providerID: string }>()
  const sessions = new Set(["ses_a", "ses_b"])
  let handlers: Record<string, (input: unknown) => Promise<unknown>> = {}
  const storage = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: Stored) => {
      values.set(key, value)
    },
    remove: async (key: string) => {
      values.delete(key)
    },
  }
  const context = {
    storage,
    rpc: {
      register: async (_definition: unknown, implementation: typeof handlers) => {
        handlers = implementation
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        if (!sessions.has(sessionID)) throw new Error("Session not found")
        return { id: sessionID }
      },
      hook: async (name: string, run: (event: never) => Promise<void>, options: { providerID: string }) => {
        hooks.set(name, { run, providerID: options.providerID })
      },
    },
  }
  await plugin.setup(context as unknown as Plugin.Context)
  return {
    values,
    state: sessionState(storage),
    async call(name: string, input: unknown) {
      assert.ok(handlers[name])
      return handlers[name](input)
    },
    async request(sessionID: string, providerID = "openai", kind = "primary") {
      const event = {
        sessionID,
        kind,
        request: new Request("https://api.openai.test/v1/responses", {
          method: "POST",
          body: JSON.stringify({ model: "gpt-5.6-sol", reasoning: { effort: "high" } }),
        }),
      }
      const original = event.request
      const hook = hooks.get("http.request")!
      if (hook.providerID === providerID) await hook.run(event as never)
      return { body: await event.request.json(), untouched: event.request === original }
    },
    async frame(sessionID: string, kind = "primary") {
      const event = { sessionID, kind, frame: '{"type":"response.create","model":"gpt-5.6-sol"}' }
      await hooks.get("experimental.ws.send")!.run(event as never)
      return JSON.parse(event.frame)
    },
  }
}

test("unconfigured sessions leave request objects and provider defaults untouched", async () => {
  const fixture = await harness()
  assert.equal(await fixture.call("status", { sessionID: "ses_a" }), null)
  const result = await fixture.request("ses_a")
  assert.equal(result.untouched, true)
  assert.equal("access_programs" in result.body, false)
})

test("two sessions have independent choices, including simultaneous requests", async () => {
  const fixture = await harness()
  const modes = await Promise.all([
    fixture.call("set", { sessionID: "ses_a", mode: "blue" }),
    fixture.call("set", { sessionID: "ses_b", mode: "red" }),
  ])
  assert.deepEqual(modes, ["blue", "red"])
  const [a, b] = await Promise.all([fixture.request("ses_a"), fixture.request("ses_b")])
  assert.equal(a.body.access_programs.cyber, "daybreak_blue")
  assert.equal(b.body.access_programs.cyber, "daybreak_red")
  assert.equal(a.body.model, "gpt-5.6-sol")
  assert.deepEqual(a.body.reasoning, { effort: "high" })
})

test("standard is an explicit override, while reset restores provider defaults", async () => {
  const fixture = await harness()
  await fixture.call("set", { sessionID: "ses_a", mode: "blue" })
  await fixture.call("set", { sessionID: "ses_a", mode: "standard" })
  assert.equal((await fixture.request("ses_a")).body.access_programs.cyber, "standard")
  assert.equal(await fixture.call("reset", { sessionID: "ses_a" }), null)
  assert.equal((await fixture.request("ses_a")).untouched, true)
})

test("choices survive plugin re-creation and are visible to another location's instance", async () => {
  const original = await harness()
  await original.call("set", { sessionID: "ses_a", mode: "red" })
  const reloaded = await harness(original.values)
  assert.equal(await reloaded.call("status", { sessionID: "ses_a" }), "red")
  await original.call("set", { sessionID: "ses_a", mode: "blue" })
  assert.equal((await reloaded.request("ses_a")).body.access_programs.cyber, "daybreak_blue")
})

test("non-OpenAI and auxiliary-model requests remain untouched", async () => {
  const fixture = await harness()
  await fixture.call("set", { sessionID: "ses_a", mode: "red" })
  assert.equal((await fixture.request("ses_a", "anthropic")).untouched, true)
  for (const kind of ["title", "compaction"]) {
    assert.equal((await fixture.request("ses_a", "openai", kind)).untouched, true)
    assert.equal("access_programs" in (await fixture.frame("ses_a", kind)), false)
  }
  assert.equal(
    (await fixture.request("ses_a", "openai", "generate")).body.access_programs.cyber,
    "daybreak_red",
  )
})

test("WebSocket hooks read the same durable session choices as HTTP", async () => {
  const fixture = await harness()
  assert.equal("access_programs" in (await fixture.frame("ses_a")), false)
  await fixture.call("set", { sessionID: "ses_a", mode: "blue" })
  assert.equal((await fixture.frame("ses_a")).access_programs.cyber, "daybreak_blue")
  assert.equal("access_programs" in (await fixture.frame("ses_b")), false)
})

test("invalid modes or nonexistent sessions cannot write state", async () => {
  const fixture = await harness()
  await assert.rejects(fixture.call("set", { sessionID: "ses_a", mode: "other" }), /expected blue/)
  await assert.rejects(fixture.call("set", { sessionID: "ses_missing", mode: "blue" }), /Session not found/)
  await assert.rejects(fixture.call("status", {}), /session ID is required/)
  assert.equal(fixture.values.size, 0)
})

test("corrupt stored settings fail visibly and can be reset", async () => {
  const fixture = await harness(new Map([["session/ses_a", "invalid"]]))
  await assert.rejects(fixture.request("ses_a"), /invalid stored session setting/)
  await fixture.call("reset", { sessionID: "ses_a" })
  assert.equal((await fixture.request("ses_a")).untouched, true)
})
