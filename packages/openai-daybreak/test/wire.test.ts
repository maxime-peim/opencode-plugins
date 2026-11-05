import assert from "node:assert/strict"
import { test } from "node:test"
import { gzipSync, gunzipSync, zstdCompressSync, zstdDecompressSync } from "node:zlib"
import { modes, programs } from "../src/daybreak.js"
import { rewriteFrame, rewriteRequest } from "../src/wire.js"

const payload = {
  model: "gpt-5.6-sol",
  input: [{ role: "user", content: "A local fixture, not a provider request" }],
  reasoning: { effort: "high" },
  stream: true,
  access_programs: { other: "keep", cyber: "previous" },
}

for (const mode of modes) {
  test(`HTTP sets ${mode} without changing model, reasoning, or other request fields`, async () => {
    const original = new Request("https://api.openai.test/v1/responses", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json", "content-length": "123", "x-example": "keep" },
    })
    const rewritten = await rewriteRequest(original, mode)
    assert.deepEqual(await rewritten.json(), {
      ...payload,
      access_programs: { other: "keep", cyber: programs[mode] },
    })
    assert.equal(rewritten.headers.has("content-length"), false)
    assert.equal(rewritten.headers.get("x-example"), "keep")
    assert.equal(rewritten.url, original.url)
    assert.deepEqual(await original.json(), payload)
  })
}

for (const encoding of ["gzip", "zstd"] as const) {
  test(`HTTP preserves ${encoding} request encoding`, async () => {
    const original = new Request("https://chatgpt.test/backend-api/codex/responses", {
      method: "POST",
      body: Uint8Array.from(
        encoding === "gzip" ? gzipSync(JSON.stringify(payload)) : zstdCompressSync(JSON.stringify(payload)),
      ),
      headers: { "content-type": "application/json", "content-encoding": encoding },
    })
    const rewritten = await rewriteRequest(original, "blue")
    const bytes = Buffer.from(await rewritten.arrayBuffer())
    const decoded = encoding === "gzip" ? gunzipSync(bytes) : zstdDecompressSync(bytes)
    assert.equal(rewritten.headers.get("content-encoding"), encoding)
    assert.deepEqual(JSON.parse(decoded.toString()), {
      ...payload,
      access_programs: { other: "keep", cyber: "daybreak_blue" },
    })
  })
}

test("HTTP creates access_programs when absent", async () => {
  const request = new Request("https://api.openai.test/v1/responses/", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5.6-sol" }),
  })
  assert.deepEqual(await (await rewriteRequest(request, "red")).json(), {
    model: "gpt-5.6-sol",
    access_programs: { cyber: "daybreak_red" },
  })
})

test("HTTP does not silently ignore unsupported endpoints", async () => {
  for (const path of ["/v1/chat/completions", "/v1/responses/compact"]) {
    const request = new Request(`https://api.openai.test${path}`, { method: "POST", body: "{}" })
    await assert.rejects(rewriteRequest(request, "blue"), /requires the OpenAI Responses API/)
  }
})

test("HTTP rejects unsupported compression instead of sending an unmodified request", async () => {
  const request = new Request("https://api.openai.test/v1/responses", {
    method: "POST",
    body: "{}",
    headers: { "content-encoding": "deflate" },
  })
  await assert.rejects(rewriteRequest(request, "blue"), /cannot decode request content-encoding deflate/)
})

test("malformed HTTP JSON and access programs fail rather than dropping the override", async () => {
  for (const body of ["invalid", "[]", "null", '{"access_programs":null}', '{"access_programs":[]}']) {
    const request = new Request("https://api.openai.test/v1/responses", { method: "POST", body })
    await assert.rejects(rewriteRequest(request, "blue"))
  }
})

test("WebSocket response.create uses the same program mapping", () => {
  for (const mode of modes) {
    const frame = JSON.stringify({ type: "response.create", ...payload })
    assert.deepEqual(JSON.parse(rewriteFrame(frame, mode)), {
      type: "response.create",
      ...payload,
      access_programs: { other: "keep", cyber: programs[mode] },
    })
  }
})

test("other WebSocket frames are preserved byte for byte", () => {
  const frame = ' { "type": "response.cancel" } '
  assert.equal(rewriteFrame(frame, "standard"), frame)
})
