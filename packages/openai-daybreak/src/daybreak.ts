export const modes = ["blue", "red", "standard"] as const
export type Mode = (typeof modes)[number]

export const programs = {
  blue: "daybreak_blue",
  red: "daybreak_red",
  standard: "standard",
} as const satisfies Record<Mode, string>

export const usage = "Usage: /daybreak [blue|red|standard|reset] (no argument shows this session's setting)"

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && modes.some((mode) => mode === value)
}

export function parseCommand(input: string | undefined): Mode | "status" | "reset" {
  const argument = input?.trim() ?? ""
  if (argument === "") return "status"
  if (argument === "reset" || isMode(argument)) return argument
  throw new Error(usage)
}

export function describeMode(mode: Mode | null): string {
  return mode === null
    ? "Daybreak: no session override (provider defaults)."
    : `Daybreak: ${mode} (${programs[mode]}). Applies to subsequent OpenAI Responses requests in this session.`
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Daybreak: ${label} must be a JSON object.`)
  }
  return value as Record<string, unknown>
}

export function readMode(value: unknown): Mode | null {
  if (value === null || isMode(value)) return value
  throw new Error("Daybreak: unexpected response from the server plugin.")
}
