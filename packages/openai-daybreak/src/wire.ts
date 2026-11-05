import { programs, record, type Mode } from "./daybreak.js"

function withProgram(body: Record<string, unknown>, mode: Mode) {
  return {
    ...body,
    access_programs: {
      ...(body.access_programs === undefined ? {} : record(body.access_programs, "access_programs")),
      cyber: programs[mode],
    },
  }
}

/** Keep compression: ChatGPT-authenticated requests can rely on it for large contexts. */
export async function rewriteRequest(request: Request, mode: Mode): Promise<Request> {
  if (request.method !== "POST" || !/\/responses\/?$/.test(new URL(request.url).pathname)) {
    throw new Error("Daybreak: this session override requires the OpenAI Responses API.")
  }
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase()
  const zlib = process.getBuiltinModule("node:zlib")
  const bytes = Buffer.from(await request.clone().arrayBuffer())
  const decoded = (() => {
    if (!encoding || encoding === "identity") return bytes
    if (encoding === "gzip") return zlib.gunzipSync(bytes)
    if (encoding === "zstd" && zlib.zstdDecompressSync) return zlib.zstdDecompressSync(bytes)
    throw new Error(`Daybreak: cannot decode request content-encoding ${encoding}.`)
  })()
  const body = JSON.stringify(withProgram(record(JSON.parse(decoded.toString("utf8")), "request body"), mode))
  const encoded = (() => {
    if (encoding === "gzip") return zlib.gzipSync(body)
    if (encoding === "zstd" && zlib.zstdCompressSync) return zlib.zstdCompressSync(body)
    return Buffer.from(body)
  })()
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  return new Request(request, { headers, body: Uint8Array.from(encoded) })
}

export function rewriteFrame(frame: string, mode: Mode): string {
  const body = record(JSON.parse(frame), "WebSocket frame")
  if (body.type !== "response.create") return frame
  return JSON.stringify(withProgram(body, mode))
}
