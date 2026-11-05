import { Plugin } from "@opencode/plugin/tui"
import { runDaybreak } from "./tui-command.js"

export default Plugin.define({
  id: "oc-openai-daybreak.tui",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "oc-openai-daybreak.configure",
          title: "Daybreak: session settings",
          group: "OpenAI",
          palette: true,
          slash: { name: "daybreak", arguments: true },
          run: (input) => runDaybreak(context, input),
        },
      ],
    }))
  },
})
