# Understand Anything for OpenCode V2

Adds slash commands, native worker agents, and opt-in automatic updates for an
existing [Understand Anything](https://github.com/Egonex-AI/Understand-Anything)
installation. This is an OpenCode adapter, not a bundled copy or fork of UA.

## Install locally

Requires OpenCode V2, Node.js 22.19+, and UA's OpenCode skills already installed.
UA's analysis workflows also require pnpm 10+ and Python 3.

From this repository:

```sh
npm ci
npm run build --workspace oc-understand-anything
```

Add this package directory to your existing global OpenCode configuration,
preserving your other settings:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/home/YOU/src/opencode-plugins/packages/understand-anything"],
}
```

Replace `/home/YOU` with your own home directory. OpenCode reloads configuration
automatically; use `/reload` to force it.

The adapter resolves UA's location from the active `understand` skill, including
symlinked installations. During startup, before native skills are registered,
it falls back to the installer's universal `~/.understand-anything-plugin`
symlink. No usernames or UA checkout paths normally need configuring. A custom
layout can set `options.root` to the absolute `understand-anything-plugin`
directory using OpenCode's object-form plugin entry.

If the installation is missing or is not UA, plugin loading fails with an
installation error rather than advertising broken commands.

## Commands and workers

All installed `understand` and `understand-*` skills become commands. UA 2.9.8
currently provides:

- `/understand`
- `/understand-chat`
- `/understand-dashboard`
- `/understand-diff`
- `/understand-domain`
- `/understand-explain`
- `/understand-figma`
- `/understand-knowledge`
- `/understand-onboard`

Arguments, quoting, attachments, and queued/steering delivery are preserved.
Commands select **Build** in the current session; your global default agent and
selected model are unchanged. Orchestration stays in the primary session so UA
can launch workers without exceeding OpenCode's default subagent depth.

UA's Markdown agents become `understand-anything/<worker-name>` subagents. They
inherit the selected model and cannot delegate. Agent instructions are read from
UA, not duplicated here. Existing commands or namespaced agents with matching
IDs are preserved.

After updating UA, run `/reload` to refresh the adapter's command and worker
registrations.

## Automatic updates

Run `/understand --auto-update` to opt in for a project; disable it with
`/understand --no-auto-update`.

Before each primary Build step, the adapter reuses UA's read-only freshness
checker and injects its update instructions when necessary. This covers the
first request in a session, commits made in OpenCode, and external commits noticed
on the next request. It does not install Git hooks or start extra model turns.

Plan sessions and child workers never trigger automatic updates. Generated-file
updates still use normal OpenCode tool permissions. Checker failures produce a
warning instead of failing an unrelated user request.

## Limits and safety

- UA is an agent workflow: initial analysis can consume substantial tokens and
  writes `.ua/` (or the existing legacy `.understand-anything/` directory).
- Do not run two UA workflows against the same project simultaneously: upstream
  shares one intermediate directory.
- UA's current viewer requires `knowledge-graph.json`. Standalone domain
  extraction still works, but viewing it requires a baseline `/understand`
  graph. The adapter reports this rather than fabricating a graph.
- `/understand-figma` requires `FIGMA_TOKEN` in the shell environment and makes
  requests to Figma. Never put the token in OpenCode configuration or prompts.
- The dashboard runs on localhost and requires its tokenized URL.
- This adapter does not install dependencies, build UA, analyze projects, or
  enable automatic updates during plugin setup.

Validated with OpenCode 2.3.2 and UA 2.9.8. The SDK dependency follows the same
2.2.x range as this repository's Daybreak plugin.

## Development

```sh
npm run check --workspace oc-understand-anything
npm run build --workspace oc-understand-anything
npm pack --workspace oc-understand-anything
```

Unit tests use disposable local fixtures, not a real UA checkout, account, or
model provider. The package includes its compiled server part, README, and MIT
license; generated `dist/` stays out of version control.
