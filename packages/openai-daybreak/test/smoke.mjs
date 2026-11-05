import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { gunzipSync, zstdDecompressSync } from "node:zlib"

// All state, credentials, and network inference endpoints are private test fixtures.
const packageDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)))
const temporary = process.env.TMPDIR || "/tmp/opencode"
await mkdir(temporary, { recursive: true })
const root = await mkdtemp(join(temporary, "oc-daybreak-smoke-"))
const home = join(root, "home")
const project = join(root, "project")
const otherProject = join(root, "other-project")
const config = join(root, "config")
for (const directory of [home, project, otherProject, config]) await mkdir(directory, { recursive: true })

const captured = []
let rejectRed = false
const mock = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/v1/responses")
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    const encoding = request.headers["content-encoding"]
    const decoded =
      encoding === "zstd" ? zstdDecompressSync(bytes) : encoding === "gzip" ? gunzipSync(bytes) : bytes
    const body = JSON.parse(decoded.toString())
    captured.push({ body, encoding, sessionID: request.headers["x-opencode-session-id"] })
    if (rejectRed && body.access_programs?.cyber === "daybreak_red") {
      response.writeHead(403, { "content-type": "application/json" })
      response.end(
        JSON.stringify({ error: { message: "Fixture access denied", code: "access_program_not_enabled" } }),
      )
      return
    }
    const id = `resp_fixture_${captured.length}`
    const item = {
      id: `msg_fixture_${captured.length}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "OK", annotations: [] }],
    }
    const events = [
      { type: "response.created", response: { id, model: body.model, status: "in_progress", output: [] } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, status: "in_progress", content: [] },
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        item_id: item.id,
        content_index: 0,
        delta: "OK",
      },
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          id,
          model: body.model,
          status: "completed",
          output: [item],
          usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
        },
      },
    ]
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""))
  } catch (error) {
    response.writeHead(500)
    response.end(String(error))
  }
})
mock.listen(0, "127.0.0.1")
await once(mock, "listening")
const mockURL = `http://127.0.0.1:${mock.address().port}`
const env = {
  PATH: process.env.PATH,
  HOME: home,
  SHELL: "/bin/sh",
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  TMPDIR: join(root, "tmp"),
  XDG_CONFIG_HOME: join(root, "xdg-config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_STATE_HOME: join(root, "state"),
  OPENCODE_TEST_HOME: home,
  OPENCODE_CONFIG_DIR: config,
  OPENCODE_CONFIG_PROJECT_DISABLE: "1",
  OPENCODE_DB: join(root, "test.db"),
  OPENCODE_PASSWORD: "local-fixture-password",
  OPENAI_API_KEY: "local-fixture-key-not-a-real-credential",
}
await mkdir(env.TMPDIR)

// Exercise the distributable package, not only workspace-linked source files.
const [packed] = JSON.parse(
  execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
    cwd: packageDirectory,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
)
const installed = join(root, "installed")
const installLog = execFileSync(
  "npm",
  [
    "install",
    "--prefix",
    installed,
    "--ignore-scripts",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    join(root, packed.filename),
  ],
  { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 },
)
await writeFile(join(root, "install.log"), installLog)

const settings = {
  $schema: "https://opencode.ai/config.json",
  plugins: [join(installed, "node_modules", "oc-openai-daybreak")],
  model: "openai/daybreak-test",
  update: "disable",
  warming: false,
  snapshots: false,
  providers: {
    openai: {
      settings: { baseURL: `${mockURL}/v1`, transport: "http", encoding: "zstd" },
      models: {
        "daybreak-test": {
          modelID: "gpt-5.6-sol",
          name: "Local Daybreak fixture",
          settings: { reasoningEffort: "high" },
          limit: { context: 200000, output: 32000 },
        },
      },
    },
  },
}
await writeFile(join(config, "opencode.json"), JSON.stringify(settings))

let server
let endpoint
let serverLog = ""
let tmuxStarted = false
let successful = false
const socket = join(root, "tmux.sock")
const timeout = setTimeout(() => {
  console.error(`Smoke test timed out. Fixtures: ${root}`)
  server?.kill("SIGKILL")
  process.exitCode = 1
}, 180000)
timeout.unref()

async function eventually(check, description, milliseconds = 30000) {
  const deadline = Date.now() + milliseconds
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await delay(150)
  }
  throw new Error(`Timed out: ${description}`, { cause: lastError })
}

async function api(path, method = "GET", body) {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString("base64")}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`)
  return text ? JSON.parse(text) : undefined
}

async function startServer() {
  serverLog = ""
  server = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  server.on("error", (error) => {
    serverLog += String(error)
  })
  for (const output of [server.stdout, server.stderr]) {
    output.on("data", (chunk) => {
      serverLog += chunk.toString()
    })
  }
  await eventually(() => {
    if (server.exitCode !== null) throw new Error(serverLog)
    const match = serverLog.match(/http:\/\/127\.0\.0\.1:\d+/)
    if (!match) return false
    endpoint = match[0]
    return true
  }, "isolated server startup")
  await eventually(() => api("/api/info"), "isolated server readiness")
}

async function stopServer() {
  if (!server || server.exitCode !== null) return
  const exited = once(server, "exit")
  server.kill("SIGTERM")
  await Promise.race([
    exited,
    delay(5000).then(() => {
      if (server.exitCode === null) server.kill("SIGKILL")
    }),
  ])
  await exited
}

function locationQuery(directory) {
  return `?${new URLSearchParams({ "location[directory]": directory })}`
}

async function rpc(method, session, mode) {
  const result = await api(
    `/api/rpc/oc-openai-daybreak/${method}${locationQuery(session.location.directory)}`,
    "POST",
    { input: { sessionID: session.id, ...(mode === undefined ? {} : { mode }) } },
  )
  return result.output
}

async function testInvalidRpcInputs(session) {
  const before = await rpc("status", session)
  const requests = captured.length
  const cases = [
    ["set", { sessionID: session.id, mode: "purple" }],
    ["set", { sessionID: session.id, mode: null }],
    ["set", { sessionID: session.id }],
    ...["status", "set", "reset"].flatMap((method) => {
      const fields = method === "set" ? { mode: "blue" } : {}
      return [
        [method, fields],
        [method, { ...fields, sessionID: "" }],
        [method, { ...fields, sessionID: 123 }],
      ]
    }),
  ]
  for (const [method, input] of cases) {
    await assert.rejects(
      api(`/api/rpc/oc-openai-daybreak/${method}${locationQuery(session.location.directory)}`, "POST", {
        input,
      }),
      /400 .*rpc\.invalid_input/s,
      `RPC ${method} must reject ${JSON.stringify(input)}`,
    )
  }
  assert.equal(await rpc("status", session), before)
  // OpenCode's JSON-Schema decoder strips excess fields rather than rejecting them.
  for (const [method, fields, expected] of [
    ["status", {}, before],
    ["set", { mode: "standard" }, "standard"],
    ["reset", {}, null],
  ]) {
    const result = await api(
      `/api/rpc/oc-openai-daybreak/${method}${locationQuery(session.location.directory)}`,
      "POST",
      { input: { sessionID: session.id, ...fields, unexpected: true } },
    )
    assert.equal(result.output, expected)
  }
  if (before !== null) await rpc("set", session, before)
  assert.equal(await rpc("status", session), before)
  assert.equal(captured.length, requests, "Invalid RPC inputs must not invoke a model")
  console.log("PASS real-server RPC validation rejects malformed inputs and safely strips extra fields")
}

async function generate(session, expectedProgram) {
  const start = captured.length
  await api(`/api/session/${session.id}/generate`, "POST", { prompt: "Reply with OK. This is a local test." })
  assert.equal(captured.length, start + 1)
  const request = captured.at(-1)
  assert.equal(request.body.access_programs?.cyber, expectedProgram)
  assert.equal(request.body.model, "gpt-5.6-sol")
  assert.equal(request.body.reasoning.effort, "high")
  assert.equal(request.encoding, "zstd")
}

function tmux(...args) {
  return execFileSync("tmux", ["-S", socket, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

async function testTui(session) {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" })
  } catch {
    console.log("SKIP real TUI test: tmux is not installed")
    return
  }
  const before = captured.length
  await rpc("reset", session)
  tmux(
    "new-session",
    "-d",
    "-s",
    "daybreak",
    "-x",
    "140",
    "-y",
    "40",
    "-c",
    project,
    `exec opencode --server ${endpoint} --session ${session.id}`,
  )
  tmuxStarted = true
  await eventually(() => tmux("capture-pane", "-p").includes("Daybreak smoke A"), "real TUI session view")
  for (const mode of ["blue", "red", "standard"]) {
    tmux("send-keys", "-l", `/daybreak ${mode}`)
    await eventually(
      () => tmux("capture-pane", "-p").includes(`/daybreak ${mode}`),
      `TUI input ready for ${mode}`,
    )
    tmux("send-keys", "Enter")
    await eventually(async () => (await rpc("status", session)) === mode, `TUI /daybreak ${mode}`)
  }
  tmux("send-keys", "-l", "/daybreak blue red")
  tmux("send-keys", "Enter")
  await eventually(() => tmux("capture-pane", "-p").includes("Usage:"), "invalid-argument toast")
  assert.equal(await rpc("status", session), "standard")
  tmux("send-keys", "-l", "/daybreak reset")
  await eventually(() => tmux("capture-pane", "-p").includes("/daybreak reset"), "TUI reset input ready")
  tmux("send-keys", "Enter")
  await eventually(async () => (await rpc("status", session)) === null, "TUI /daybreak reset")
  tmux("send-keys", "-l", "/daybreak ")
  await eventually(() => tmux("capture-pane", "-p").includes("/daybreak"), "TUI status input ready")
  tmux("send-keys", "Enter")
  await eventually(() => tmux("capture-pane", "-p").includes("no session override"), "TUI /daybreak status")
  assert.equal(captured.length, before, "Changing Daybreak modes must not invoke a model")
  await writeFile(join(root, "tui.txt"), tmux("capture-pane", "-p"))
  tmux("kill-server")
  tmuxStarted = false
  console.log("PASS real TUI /daybreak blue|red|standard, reset, status, and validation; zero model calls")
}

try {
  await startServer()
  await eventually(async () => {
    const plugins = await api(`/api/plugin${locationQuery(project)}`)
    await writeFile(join(root, "plugins.json"), JSON.stringify(plugins, null, 2))
    return plugins.data.find(
      (plugin) => plugin.id === "oc-openai-daybreak" && plugin.state.status === "active",
    )
  }, "plugin package activation")
  console.log("PASS npm-packed and installed plugin loaded by installed OpenCode")

  const create = async (directory, title) =>
    (
      await api("/api/session", "POST", {
        title,
        location: { directory },
        model: { providerID: "openai", id: "daybreak-test" },
      })
    ).data
  const a = await create(project, "Daybreak smoke A")
  const b = await create(otherProject, "Daybreak smoke B")
  assert.equal(await rpc("status", a), null)
  await generate(a, undefined)

  assert.equal(await rpc("set", a, "blue"), "blue")
  await testInvalidRpcInputs(a)
  await generate(a, "daybreak_blue")
  await generate(b, undefined)
  await rpc("set", b, "red")
  await generate(b, "daybreak_red")
  await generate(a, "daybreak_blue")
  console.log(
    "PASS real compressed provider requests, program mapping, model/effort preservation, cross-project isolation",
  )

  await api(`/api/session/${a.id}/prompt`, "POST", { text: "Reply with OK. Do not use tools." })
  await api(`/api/experimental/session/${a.id}/wait`, "POST")
  assert.equal(captured.at(-1).body.access_programs.cyber, "daybreak_blue")
  console.log("PASS primary agent-loop request uses the session override")

  rejectRed = true
  await assert.rejects(generate(b, "daybreak_red"), /Fixture access denied|access_program_not_enabled|403/)
  rejectRed = false
  assert.equal(await rpc("status", b), "red")
  console.log("PASS provider access denial is surfaced, with no mode fallback")

  await testTui(a)
  await rpc("set", a, "standard")
  await generate(a, "standard")
  await stopServer()
  await startServer()
  assert.equal(await rpc("status", a), "standard")
  assert.equal(await rpc("status", b), "red")
  await generate(a, "standard")
  assert.equal(await rpc("reset", a), null)
  await generate(a, undefined)
  console.log("PASS explicit standard, reset, and persistence across a real server restart")
  successful = true
} catch (error) {
  console.error(error)
  console.error(`Smoke fixtures retained at ${root}`)
  await writeFile(join(root, "server.log"), serverLog)
  if (tmuxStarted) {
    await writeFile(join(root, "tui.txt"), tmux("capture-pane", "-p"))
  }
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  if (tmuxStarted) tmux("kill-server")
  await stopServer()
  mock.closeAllConnections()
  await new Promise((done) => mock.close(done))
  if (successful) await rm(root, { recursive: true, force: true })
}
