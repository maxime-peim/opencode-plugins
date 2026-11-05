import assert from "node:assert/strict"
import { test } from "node:test"
import { describeMode, parseCommand, readMode } from "../src/daybreak.js"

test("empty commands report status; supported modes and reset accept surrounding whitespace", () => {
  assert.equal(parseCommand(undefined), "status")
  assert.equal(parseCommand("  "), "status")
  for (const mode of ["blue", "red", "standard", "reset"] as const) {
    assert.equal(parseCommand(` ${mode}\n`), mode)
  }
})

test("invalid arguments do not silently select a mode", () => {
  for (const input of ["off", "BLUE", "blue red", "blue --global", "status"]) {
    assert.throws(() => parseCommand(input), /Usage: \/daybreak/)
  }
})

test("status distinguishes unset provider defaults from explicit standard", () => {
  assert.match(describeMode(null), /provider defaults/)
  assert.match(describeMode("standard"), /standard \(standard\)/)
  assert.match(describeMode("red"), /daybreak_red/)
})

test("RPC output is validated before displaying success", () => {
  for (const mode of ["blue", "red", "standard", null] as const) {
    assert.equal(readMode(mode), mode)
  }
  for (const value of [undefined, [], {}, { mode: "blue" }, "unknown", 0]) {
    assert.throws(() => readMode(value), /Daybreak:/)
  }
})
