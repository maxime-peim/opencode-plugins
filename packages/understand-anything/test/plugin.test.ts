import assert from "node:assert/strict"
import { Agent, Skill, type Plugin } from "@opencode/plugin"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import plugin from "../src/index.js"
import { attachAutoUpdate, updateContext } from "../src/auto-update.js"
import { loadInstallation } from "../src/installation.js"

type CommandEditor = Parameters<Parameters<Plugin.Context["command"]["transform"]>[0]>[0]
type Command = Parameters<CommandEditor["add"]>[0]
type AgentEditor = Parameters<Parameters<Plugin.Context["agent"]["transform"]>[0]>[0]
type AgentDraft = Parameters<Parameters<AgentEditor["update"]>[1]>[0]
type HookEvent = { sessionID: string; agent: string; system: { type: "text"; text: string }[] }

const skillIDs = [
  "understand",
  "understand-chat",
  "understand-dashboard",
  "understand-diff",
  "understand-domain",
  "understand-explain",
  "understand-figma",
  "understand-knowledge",
  "understand-onboard",
]
const workerIDs = [
  "architecture-analyzer",
  "article-analyzer",
  "assemble-reviewer",
  "code-lesson-writer",
  "container-namer",
  "design-analyzer",
  "domain-analyzer",
  "file-analyzer",
  "graph-reviewer",
  "knowledge-graph-guide",
  "project-scanner",
  "tour-builder",
]

async function fixture(t: TestContext) {
  const temporary = process.env.TMPDIR || "/tmp/opencode"
  await mkdir(temporary, { recursive: true })
  const directory = await mkdtemp(join(temporary, "oc-ua-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, "UA source with spaces")
  const project = join(directory, "project with spaces")
  await mkdir(join(root, "agents"), { recursive: true })
  await mkdir(join(root, "hooks"))
  await mkdir(join(project, ".ua"), { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@understand-anything/skill" }))
  const skills = []
  for (const id of skillIDs) {
    const path = join(root, "skills", id, "SKILL.md")
    await mkdir(join(root, "skills", id), { recursive: true })
    await writeFile(path, `---\nname: ${id}\n---\n\n# ${id}\n\nFollow the fixture workflow.\n`)
    skills.push({ id, path, description: `UA ${id}` })
  }
  for (const id of workerIDs) {
    await writeFile(
      join(root, "agents", `${id}.md`),
      `---\nname: ${id}\nmodel: inherit\ndescription: |\n  Upstream metadata.\n---\n\n# ${id}\n\nPerform the ${id} workflow.\n\nPreserve validation and error handling.\n`,
    )
  }
  await writeFile(
    join(root, "hooks/session-start-stale-check.mjs"),
    `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const data = existsSync(".understand-anything") ? ".understand-anything" : ".ua";
writeFileSync(".checker-called", "yes");
const meta = JSON.parse(readFileSync(data + "/meta.json", "utf8"));
if (meta.stale) process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: "Knowledge graph is stale: read auto-update-prompt.md" } }));
`,
  )
  await writeFile(join(project, ".ua/config.json"), '{"autoUpdate":true}')
  await writeFile(join(project, ".ua/meta.json"), '{"stale":true}')
  return { directory, root, project, skills }
}

function mock(
  skills: Awaited<ReturnType<typeof fixture>>["skills"],
  project: string,
  options: Plugin.Context["options"] = {},
) {
  const commands = new Map<string, Command>()
  const agents = new Map<string, AgentDraft>()
  const hooks = new Map<string, (event: HookEvent) => Promise<void>>()
  const prompts: Record<string, unknown>[] = []
  const switches: unknown[] = []
  const state: { parentID?: string; fail?: boolean } = {}
  const ctx = {
    options,
    skill: { list: async () => ({ data: skills }) },
    command: {
      list: async () => ({ data: [...commands.values()] }),
      transform: async (callback: (editor: CommandEditor) => void) =>
        callback({
          add: (definition) => {
            commands.set(definition.name, definition)
          },
        }),
    },
    agent: {
      transform: async (callback: (editor: AgentEditor) => void) =>
        callback({
          list: () => [...agents.values()],
          get: (id) => agents.get(id),
          default: () => {
            throw new Error("Must not change the global default")
          },
          remove: (id) => {
            agents.delete(id)
          },
          update: (id, update) => {
            const value = agents.get(id) ?? Agent.Info.default(Agent.ID.make(id))
            update(value)
            agents.set(id, value)
          },
        }),
    },
    session: {
      hook: async (name: string, callback: (event: HookEvent) => Promise<void>) => {
        hooks.set(name, callback)
      },
      get: async () => {
        if (state.fail) throw new Error("fixture failure")
        return { parentID: state.parentID, location: { directory: project } }
      },
      switchAgent: async (input: unknown) => {
        switches.push(input)
      },
      prompt: async (input: Record<string, unknown>) => {
        prompts.push(input)
      },
    },
  } as unknown as Plugin.Context
  return { ctx, commands, agents, hooks, prompts, switches, state }
}

test("resolve a symlinked UA installation and register all commands and namespaced workers", async (t) => {
  const f = await fixture(t)
  const link = join(f.directory, "skill link")
  await symlink(join(f.root, "skills/understand"), link, "dir")
  f.skills[0]!.path = join(link, "SKILL.md")
  const m = mock(f.skills, f.project)
  await plugin.setup(m.ctx)
  assert.deepEqual([...m.commands.keys()], skillIDs)
  assert.equal(m.agents.size, workerIDs.length)
  for (const id of workerIDs) {
    const agent = m.agents.get(`understand-anything/${id}`)!
    assert.equal(agent.mode, "subagent")
    assert.equal(agent.model, undefined)
    assert.match(agent.system!, /Preserve validation and error handling/)
    assert.ok(agent.system!.includes(f.root))
    assert.doesNotMatch(agent.system!, /model: inherit/)
    assert.ok(agent.permissions.some((rule) => rule.action === "subagent" && rule.effect === "deny"))
  }
  assert.ok(m.hooks.has("context"))
})

test("commands preserve literal arguments, attachments, mentions, selected skills, and delivery", async (t) => {
  const f = await fixture(t)
  const m = mock(f.skills, f.project)
  await plugin.setup(m.ctx)
  const text = '@input "path with spaces" --language zh --exclude "tests/*,docs/*" !`do-not-run`'
  const sessionID = "fixture" as Parameters<Command["execute"]>[0]["sessionID"]
  const mention = { start: 0, end: 6, text: "@input" }
  const prompt = {
    text,
    files: [{ uri: "file:///fixture/input.txt", mention }],
    agents: [{ name: "explore", mention }],
    skills: [{ id: Skill.ID.make("understand-chat"), mention }],
  }
  await m.commands.get("understand-chat")!.execute({ sessionID, prompt, delivery: "queue" })
  const sent = m.prompts[0]!
  const prefixLength = String(sent.text).length - text.length
  assert.ok(String(sent.text).endsWith(text))
  assert.match(String(sent.text), /understand-anything\/<UA agent name>/)
  const shifted = { ...mention, start: prefixLength, end: prefixLength + 6 }
  assert.deepEqual(sent.files, [{ uri: "file:///fixture/input.txt", mention: shifted }])
  assert.deepEqual(sent.agents, [{ name: "explore", mention: shifted }])
  assert.deepEqual(sent.skills, [{ id: "understand-chat", mention: shifted }])
  assert.equal(sent.delivery, "queue")
  assert.deepEqual(m.switches, [{ sessionID: "fixture", agent: "build" }])
  assert.equal(prompt.text, text)
  assert.equal(prompt.files[0]!.mention.start, 0)
  await m.commands.get("understand")!.execute({ sessionID, prompt: { text: "" }, delivery: "steer" })
  assert.deepEqual(m.prompts[1]!.skills, [{ id: "understand" }])
  assert.equal(m.prompts[1]!.delivery, "steer")
})

test("existing command and namespaced agent definitions are not overwritten", async (t) => {
  const f = await fixture(t)
  const m = mock(f.skills, f.project)
  const custom = { name: "understand-chat", execute: async () => {} }
  const worker = Agent.Info.default(Agent.ID.make("understand-anything/file-analyzer"))
  m.commands.set(custom.name, custom)
  m.agents.set(worker.id, worker)
  await plugin.setup(m.ctx)
  assert.equal(m.commands.get(custom.name), custom)
  assert.equal(m.agents.get(worker.id), worker)
  assert.equal(worker.mode, "primary")
})

test("missing or unrelated UA installations fail before registration", async (t) => {
  const f = await fixture(t)
  await assert.rejects(loadInstallation(join(f.directory, "missing")), /install the UA skills/)
  await writeFile(join(f.root, "package.json"), '{"name":"unrelated"}')
  const m = mock(f.skills, f.project)
  await assert.rejects(async () => {
    await plugin.setup(m.ctx)
  }, /not from a UA installation/)
  assert.equal(m.commands.size, 0)
  assert.equal(m.agents.size, 0)
  assert.equal(m.hooks.size, 0)
})

test("startup works before the native skill registry is ready", async (t) => {
  const f = await fixture(t)
  const m = mock([], f.project, { root: f.root })
  await plugin.setup(m.ctx)
  assert.deepEqual([...m.commands.keys()], skillIDs)
  assert.equal(m.agents.size, workerIDs.length)
})

test("custom roots must be absolute path strings", async (t) => {
  const f = await fixture(t)
  for (const root of [false, 42, null, "", "relative/ua"]) {
    const m = mock(f.skills, f.project, { root })
    await assert.rejects(async () => {
      await plugin.setup(m.ctx)
    }, /absolute plugin directory/)
    assert.equal(m.commands.size, 0)
    assert.equal(m.agents.size, 0)
  }
})

test("automatic checking is opt-in and rejects malformed, null, disabled, or missing configs", async (t) => {
  const f = await fixture(t)
  const config = join(f.project, ".ua/config.json")
  for (const value of ["invalid", "null", "false", "[]", '{"autoUpdate":false}', '{"autoUpdate":"true"}']) {
    await writeFile(config, value)
    assert.equal(await updateContext(f.project, f.root), undefined)
  }
  await rm(config)
  assert.equal(await updateContext(f.project, f.root), undefined)
  assert.equal(existsSync(join(f.project, ".checker-called")), false)
})

test("checker results and legacy data-directory precedence are preserved", async (t) => {
  const f = await fixture(t)
  assert.match((await updateContext(f.project, f.root))!, /Knowledge graph is stale/)
  await writeFile(join(f.project, ".ua/meta.json"), '{"stale":false}')
  assert.equal(await updateContext(f.project, f.root), undefined)
  await mkdir(join(f.project, ".understand-anything"))
  await writeFile(join(f.project, ".understand-anything/config.json"), '{"autoUpdate":false}')
  assert.equal(await updateContext(f.project, f.root), undefined)
  await writeFile(join(f.project, ".understand-anything/config.json"), '{"autoUpdate":true}')
  await writeFile(join(f.project, ".understand-anything/meta.json"), '{"stale":true}')
  assert.match((await updateContext(f.project, f.root))!, /continue any update already in progress/)
  assert.equal(await readFile(join(f.project, ".checker-called"), "utf8"), "yes")
})

test("only primary Build steps check freshness; failures warn without rejecting the request", async (t) => {
  const f = await fixture(t)
  const m = mock(f.skills, f.project)
  await attachAutoUpdate(m.ctx, f.root)
  const hook = m.hooks.get("context")!
  const event: HookEvent = { sessionID: "fixture", agent: "plan", system: [] }
  await hook(event)
  assert.equal(event.system.length, 0)
  event.agent = "build"
  m.state.parentID = "parent"
  await hook(event)
  assert.equal(event.system.length, 0)
  m.state.parentID = undefined
  await hook(event)
  assert.match(event.system[0]!.text, /Knowledge graph is stale/)
  assert.match(event.system[0]!.text, /understand-anything\/<UA agent name>/)
  m.state.fail = true
  await hook(event)
  assert.match(event.system[1]!.text, /freshness check failed: fixture failure/)
})
