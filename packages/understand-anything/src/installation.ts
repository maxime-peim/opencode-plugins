import { readFile, readdir, realpath } from "node:fs/promises"
import { dirname, join } from "node:path"

export async function loadInstallation(
  directory: string,
  skills: readonly { id: string; path: string; description?: string }[] = [],
) {
  let root: string
  let manifest: { name?: unknown } | null
  try {
    root = await realpath(directory)
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  } catch (cause) {
    throw new Error(
      `Understand Anything: install the UA skills first or set options.root to its plugin directory (${directory}).`,
      { cause },
    )
  }
  if (manifest?.name !== "@understand-anything/skill") {
    throw new Error("Understand Anything: the active understand skill is not from a UA installation.")
  }

  const files = await readdir(join(root, "agents"), { withFileTypes: true })
  const agents = await Promise.all(
    files
      .filter((file) => file.isFile() && file.name.endsWith(".md"))
      .map(async (file) => {
        const id = file.name.slice(0, -3)
        const markdown = await readFile(join(root, "agents", file.name), "utf8")
        const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim()
        const paragraph = body.split(/\r?\n\s*\r?\n/).find((part) => !part.startsWith("#"))
        return {
          id: `understand-anything/${id}`,
          description: paragraph?.replace(/\s+/g, " ").slice(0, 300) || `UA worker: ${id}`,
          system: `UA plugin root: ${root}. Resolve bundled resources from this installation and use absolute paths in shell commands.\n\n${body}`,
        }
      }),
  )
  const entries = await readdir(join(root, "skills"), { withFileTypes: true })
  const commands = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const path = join(root, "skills", entry.name, "SKILL.md")
        const content = await readFile(path, "utf8")
        const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim()
        const paragraph = body.split(/\r?\n\s*\r?\n/).find((part) => !part.startsWith("#"))
        return {
          id: entry.name,
          path,
          description:
            skills.find((skill) => skill.id === entry.name)?.description ??
            paragraph?.replace(/\s+/g, " ").slice(0, 300) ??
            `Understand Anything: ${entry.name}`,
        }
      }),
  )
  commands.sort((a, b) => a.id.localeCompare(b.id))
  return { root, agents, commands }
}

export function commandPrefix(id: string, skillPath: string, root: string) {
  return `Load the ${id} skill and follow it. If its output is truncated, read the rest of its SKILL.md before proceeding.

OpenCode compatibility:
- Keep orchestration in this primary Build session. Use native subagent workers named understand-anything/<UA agent name>, and wait for automatic completion notifications rather than polling.
- The UA plugin root is ${root}. Resolve bundled scripts and relative resources against this skill's directory, ${dirname(skillPath)}, not the analyzed project. Pass the resolved plugin, project, skill, and data paths to workers.
- UA slash commands mentioned in instructions are skill invocations, not shell commands. Omit the Claude-style understand-anything: prefix.
- For dashboard startup, use a short shell timeout to capture the tokenized localhost URL while the server continues in the background.
- Standalone domain extraction can save its domain graph, but UA's current viewer requires a baseline knowledge graph. Explain that limitation rather than fabricating a graph or launching a full analysis without permission.
- Do not run concurrent UA workflows against one project. Ask before saving onboarding documents. Never print or persist FIGMA_TOKEN.

Use the following text verbatim as the skill's arguments:
`
}

export function shiftMentions<T extends { mention?: { start: number; end: number; text: string } }>(
  values: readonly T[] | undefined,
  offset: number,
) {
  return values?.map((value) =>
    value.mention
      ? {
          ...value,
          mention: { ...value.mention, start: value.mention.start + offset, end: value.mention.end + offset },
        }
      : value,
  )
}
