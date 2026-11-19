import { Plugin } from "@opencode/plugin"
import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { attachAutoUpdate } from "./auto-update.js"
import { commandPrefix, loadInstallation, shiftMentions } from "./installation.js"

export default Plugin.define({
  id: "oc-understand-anything",
  async setup(ctx) {
    const skills = (await ctx.skill.list()).data
    const main = skills.find((skill) => skill.id === "understand")
    if (
      ctx.options.root !== undefined &&
      (typeof ctx.options.root !== "string" || !isAbsolute(ctx.options.root))
    ) {
      throw new Error("Understand Anything: options.root must be an absolute plugin directory path.")
    }
    // Native skill sources may not be registered yet while plugins are starting.
    const root =
      ctx.options.root ??
      (main
        ? dirname(dirname(dirname(await realpath(main.path))))
        : join(homedir(), ".understand-anything-plugin"))
    const installation = await loadInstallation(root, skills)
    const existing = new Set((await ctx.command.list()).data.map((command) => command.name))

    await ctx.agent.transform((editor) => {
      for (const worker of installation.agents) {
        if (editor.get(worker.id)) continue
        editor.update(worker.id, (agent) => {
          agent.mode = "subagent"
          agent.description = worker.description
          agent.system = worker.system
          agent.permissions.push({ action: "subagent", resource: "*", effect: "deny" })
        })
      }
    })
    await ctx.command.transform((editor) => {
      for (const skill of installation.commands) {
        if (existing.has(skill.id)) continue
        editor.add({
          name: skill.id,
          description: skill.description,
          async execute({ sessionID, prompt, delivery }) {
            const prefix = commandPrefix(skill.id, skill.path, installation.root)
            await ctx.session.switchAgent({ sessionID, agent: "build" })
            await ctx.session.prompt({
              ...prompt,
              sessionID,
              delivery,
              text: prefix + prompt.text,
              files: shiftMentions(prompt.files, prefix.length),
              agents: shiftMentions(prompt.agents, prefix.length),
              skills: [
                ...(shiftMentions(prompt.skills, prefix.length) ?? []),
                ...((prompt.skills ?? []).some((entry) => entry.id === skill.id) ? [] : [{ id: skill.id }]),
              ],
            })
          },
        })
      }
    })
    await attachAutoUpdate(ctx, installation.root)
  },
})
