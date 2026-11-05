# opencode-plugins

Independent plugins for **OpenCode V2**, maintained in an npm-workspaces monorepo.
Each plugin has its own package, version, documentation, tests, and exports. The
repository root is private development tooling, **not an installable plugin**.

## Plugins

| Package              | Directory                                                      | Purpose                                                         |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| `oc-openai-daybreak` | [packages/openai-daybreak](packages/openai-daybreak/README.md) | Per-session `/daybreak blue\|red\|standard` controls for OpenAI |

No packages have been published to npm yet. Use the local installation below.
See each plugin's README for its OpenCode compatibility and access requirements.

## Install a plugin locally

Requires Node.js 22.19+ and npm with workspace support. The current tests run on
Node.js 25; the Daybreak smoke test uses OpenCode 2.2.5 and optionally `tmux`.

```sh
git clone git@github.com:maxime-peim/opencode-plugins.git ~/src/opencode-plugins
cd ~/src/opencode-plugins
npm ci
npm run build --workspace oc-openai-daybreak
```

Add the **absolute package directory**, not this repository root, to the `plugins`
array in your existing global `~/.config/opencode/opencode.json(c)`. Keep your
other configuration and plugin entries:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/home/YOU/src/opencode-plugins/packages/openai-daybreak"],
}
```

Replace `/home/YOU` with your actual home directory. Each plugin is enabled
independently; one entry loads all the parts that package exports (server, TUI,
and any other supported parts). OpenCode reloads configuration automatically;
use `/reload` to force a reload.

If you previously registered the standalone Daybreak repository or this
monorepo's root, **replace the old plugin path** with the package path above.
Daybreak's package and plugin IDs have not changed, so its persisted session
settings remain associated with the same plugin.

## Layout

```text
opencode-plugins/
├── packages/
│   └── openai-daybreak/
│       ├── package.json       # Plugin identity, dependencies, exports, scripts
│       ├── README.md          # Plugin-specific setup and behavior
│       ├── LICENSE           # Included in the standalone package
│       ├── src/
│       ├── test/
│       ├── tsconfig.json
│       └── tsconfig.test.json
├── package.json              # Private workspace root and shared dev tools
├── package-lock.json         # Single lockfile for every workspace
├── tsconfig.base.json        # Shared TypeScript compiler options
├── .prettierrc.json          # Shared formatting
└── LICENSE
```

Build output stays inside each package's ignored `dist/` directory. Do not add
package-local lockfiles or commit generated output.

## Development

Run these commands from the repository root:

```sh
npm ci
npm run check
npm run build
npm run test:smoke
```

- `check` runs workspace type checks, repository-wide formatting checks, and unit
  tests.
- `build` builds every workspace that defines a build script.
- `test:smoke` runs workspace smoke tests when provided. The Daybreak test packs
  and installs its distributable, launches an isolated OpenCode server, and uses
  fake credentials and a localhost mock provider. It does not alter global
  OpenCode configuration or use a real OpenAI account.
- `npm run format` formats the repository using the shared Prettier settings.

Target just one plugin using its package name:

```sh
npm run check --workspace oc-openai-daybreak
npm run build --workspace oc-openai-daybreak
npm run test:smoke --workspace oc-openai-daybreak
npm pack --workspace oc-openai-daybreak
```

The package-specific `check` runs type checking and unit tests; use the root
`check` to include repository-wide formatting. Packing runs the plugin's build
and includes only its distributable files, README, and license.

### Add another plugin

1. Create `packages/<plugin>/` with its own `package.json`, source, tests, README,
   and license.
2. Give it a unique package name and stable OpenCode plugin ID. Declare its
   runtime dependencies and export its server/TUI/RPC parts as needed.
3. Extend `../../tsconfig.base.json` from its package TypeScript configuration,
   setting `rootDir` and `outDir` locally. Reuse the shared compiler, test runner,
   and formatter instead of adding copies to each package.
4. Provide `build`, `typecheck`, and `test` scripts; add `test:smoke` when useful.
   Keep versions and releases independent from other plugins.
5. Run `npm install` from the root to update the shared lockfile, add the plugin
   to the table above, then run `npm run check` and the relevant smoke tests.

Use [OpenCode V2's plugin documentation](https://opencode.ai/v2/docs/build/plugins)
for package exports and APIs. Test packed/installed artifacts as well as source
before publishing a plugin. Publishing, if desired, targets individual workspace
packages, never the private root.

## License

MIT. See [LICENSE](LICENSE); each distributable plugin includes its own copy.
