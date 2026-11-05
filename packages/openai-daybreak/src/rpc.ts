import { Rpc } from "@opencode/plugin/rpc"
import { modes } from "./daybreak.js"

const sessionID = { type: "string", minLength: 1 } as const
const mode = { type: "string", enum: [...modes] } as const
const input = {
  type: "object",
  properties: { sessionID },
  required: ["sessionID"],
  additionalProperties: false,
} as const
const output = { anyOf: [mode, { type: "null" }] } as const

export const Daybreak = Rpc.define({
  id: "oc-openai-daybreak",
  events: {},
  methods: {
    status: { input, output },
    set: {
      input: {
        ...input,
        properties: { sessionID, mode },
        required: ["sessionID", "mode"],
      },
      output,
    },
    reset: { input, output },
  },
})
