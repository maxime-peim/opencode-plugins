# oc-openai-daybreak

Select OpenAI Daybreak **per session** in OpenCode V2, without editing model
configuration or creating variants for every model.

```text
/daybreak blue
/daybreak red
/daybreak standard
/daybreak           Show this session's setting
/daybreak reset     Remove the override and use provider defaults
```

Select your model normally. The plugin does not switch models or change reasoning
effort. Commands display a toast and do not send a prompt, invoke an LLM, or add
messages to the conversation.

## Install locally

Requires **OpenCode V2 2.2.5** (the tested version). Its experimental WebSocket
hook may change in future releases. Node 22.19+ is needed for development; tests
currently run on Node 25.

```sh
git clone git@github.com:maxime-peim/opencode-plugins.git ~/src/opencode-plugins
cd ~/src/opencode-plugins
npm ci
npm run build --workspace oc-openai-daybreak
```

Add the **absolute directory path** to the `plugins` array in your existing global
`~/.config/opencode/opencode.json(c)`. Preserve your other settings:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/home/YOU/src/opencode-plugins/packages/openai-daybreak"],
}
```

Register this package directory, not the monorepo root. This is a one-time plugin
registration, not a per-project or per-model setting. If you previously registered
the old standalone repository path, replace that entry with the package path above.
OpenCode reloads configuration automatically; `/reload` forces a reload. Both the
server and TUI parts load from the same entry. Open an existing session, select
your model with `/models`, then run `/daybreak blue`.

The package is not published to npm yet. Do not use its npm package name to install
it until a release has been published.

## Behavior

| Command              | Outgoing `access_programs.cyber`                                  |
| -------------------- | ----------------------------------------------------------------- |
| `/daybreak blue`     | `daybreak_blue`                                                   |
| `/daybreak red`      | `daybreak_red`                                                    |
| `/daybreak standard` | `standard` (explicitly requests standard safeguards)              |
| `/daybreak reset`    | No plugin override; existing provider/model configuration applies |

- Settings are keyed by session ID in OpenCode's durable plugin storage, on the
  connected server. They survive plugin reloads, server restarts, and resumes.
- Unconfigured sessions are **not modified**. Provider defaults may already select
  Daybreak for entitled accounts; unset does **not** mean explicit `standard`.
- New sessions, forks, and subagent sessions do not inherit another session's
  setting. Configure them individually if desired.
- Switching models keeps the session's chosen mode. Only the `openai` provider's
  Responses requests are affected. Other providers are untouched.
- Requests already sent are unchanged. A mode change affects subsequent requests,
  including later tool-loop steps; it does not cancel active work.
- The selected session's primary and transient-generation requests are covered.
  Title generation and compaction helpers are left alone: they may use different
  models with different program requirements.
- HTTP requests (including gzip/zstd) and `response.create` WebSocket frames are
  handled. The HTTP hook also covers WebSocket fallback. OpenCode versions may
  prefer HTTP when a provider has HTTP hooks.
- The plugin overrides only `access_programs.cyber`, preserving the rest of the
  body, model ID, reasoning settings, and other access-program fields.
- It does not manage credentials, request additional access, guess entitlement,
  fall back to another model/mode, or retry authorization errors itself.

### Access and model compatibility

You must already have the required OpenAI approval and project/account access.
The command selects an **API request value**, not an approval tier. For example,
some models require Red approval but accept `daybreak_blue`, not `daybreak_red`.
Use the value supported by your selected model. Unsupported values or missing
access are reported by OpenAI through OpenCode's normal error handling.

The toast confirms the local setting was saved, not that OpenAI granted access.
There are no entitlement probes or paid requests when changing modes. Live
Daybreak entitlement has not been tested with a real OpenAI account.

The plugin adds no models to OpenCode's catalog. Use a model already available
through your connected account. Custom provider IDs and the Chat Completions API
are not supported.

## Development and tests

Run these commands from the **monorepo root**. Dependencies and shared tools are
installed once using the root lockfile:

```sh
npm ci
npm run check --workspace oc-openai-daybreak
npm run build --workspace oc-openai-daybreak
npm run test:smoke --workspace oc-openai-daybreak
```

Use `npm run check` at the root to also check shared formatting and all plugins.

Unit tests cover command parsing, session isolation, durable-storage access,
provider scoping, reset vs. standard, HTTP/WebSocket payloads, compression, errors,
and TUI routing, including plain-object RPC error messages. The smoke test packs
and installs the distributable plugin, then
runs the installed `opencode` binary against an isolated home/config/database and
a localhost mock OpenAI Responses endpoint. It also checks that the real server
rejects invalid modes and missing/invalid session IDs without changing the session
setting. Extra input fields are stripped by OpenCode's JSON-Schema decoder.
It uses fake credentials and never sends requests to OpenAI. See its output for
whether the optional real TUI test ran (`tmux` is needed for that part).

`npm pack --workspace oc-openai-daybreak` builds this package with compiled
server/TUI/RPC exports and its own README and license. Its `dist/` directory is not
committed. No OpenCode checkout or Bun installation is needed for development.

See the [monorepo guide](../../README.md) for shared tooling and adding plugins.

RPC methods return just the mode (`"blue"`, `"red"`, `"standard"`, or `null`).
OpenCode validates the JSON Schemas at runtime but exposes their values as
`unknown` in TypeScript, so small boundary guards narrow them to `Mode | null`.

`npm audit --omit=dev` currently reports moderate advisories inherited through
`@opencode/plugin`'s dependencies, with no high or critical advisories. These are
not fixed by forcing untested overrides of OpenCode's dependency tree.

## References

- [OpenCode V2 plugins](https://opencode.ai/v2/docs/build/plugins)
- [OpenCode TUI plugins](https://opencode.ai/v2/docs/build/plugins/cli)
- [OpenAI Daybreak request parameters](https://developers.openai.com/api/docs/guides/daybreak)

## License

MIT
