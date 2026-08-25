# stepstone-hierarchy

> Persistent companion tasks and sub-tasks below authoritative Stepstone Project Goals.

```text
Stepstone Project Goal (read-only root)
└── Task (companion-owned)
    └── Sub-task (companion-owned)
```

This is a Pi package, not a Stepstone fork. Stepstone remains the source of truth
for roots and `.worklist/worklist.json`; this package stores only companion data
in `.worklist/hierarchy.json`.

## Requirements

- Pi compatible with `@earendil-works/pi-coding-agent` `0.80.x`
- Node.js 24 or newer
- The documented `stepstone` CLI available on `PATH`
- A trusted Git project with Stepstone Project Goals

Pi inherits the environment that launches it. Before starting Pi, verify that its
launcher can resolve the CLI:

```sh
command -v stepstone
```

If Stepstone was installed in Pi's package directory, start Pi with its public
CLI bin directory on `PATH`:

```sh
PATH="$HOME/.pi-dashboard/agent/npm/node_modules/.bin:$PATH" pi
```

Restart Pi after changing `PATH`. The hierarchy extension uses only the public
`stepstone` executable; it does not import Stepstone implementation files.

## Install

Published package:

```sh
pi install npm:stepstone-hierarchy
```

Local development package:

```sh
pnpm build
pi install -l /absolute/path/to/pi-stepstone-hierarchy
```

Pi loads the compiled package entry declared in `package.json`. Restart Pi after
installation, or use Pi's package-update workflow after rebuilding. Project-local
Pi packages run with your user permissions; install only code you trust.

## Pi interface

The package registers:

- `stepstone_hierarchy` — model tool for bounded reads and revision-checked
  companion mutations. Use it instead of editing `.worklist/hierarchy.json`.
- `/hierarchy [rootGoalId]` — display up to 25 companion task summaries,
  optionally scoped to one Stepstone root goal.

All mutations require the current hierarchy revision. Terminal lifecycle changes
(completion and archiving) require an interactive Pi confirmation and never mutate
the anchored Stepstone root.

## Development

```sh
pnpm install
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run
```

The package manifest loads `dist/pi-extension.mjs`; verify that artifact is in
`pnpm pack --dry-run` before publishing or testing a local install.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
