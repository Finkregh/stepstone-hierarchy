# Handover — pi-stepstone-hierarchy

## Purpose

`pi-stepstone-hierarchy` is a **project-local companion Pi extension** prototype for persistent child work below existing Stepstone Project Goals:

```text
Stepstone Project Goal (installed Stepstone; authoritative root)
└── Task (companion-owned)
    └── Sub-task (companion-owned)
```

It is not a fork or replacement of installed Stepstone. The design source of truth is the linked [hierarchical-worklist goals](../pi-stepstone/docs/hierarchical-worklist/00-goals.md) in the sibling `pi-stepstone` checkout.

## Non-negotiable boundaries

- Do **not** edit or patch `~/.pi-dashboard/agent/npm/node_modules/stepstone`.
- Do **not** replace the installed upstream Stepstone extension during the prototype.
- Stepstone remains authoritative for root Project Goals and its own `.worklist/worklist.json` data.
- Integrate only through documented/public Stepstone interfaces. Do not import its private `src/*` implementation.
- If Stepstone lacks a suitable public API, use a conservative **read-only CLI boundary** and record the gap as an upstream requirement; do not depend on internal implementation details.
- Store companion-owned work in a separate, versioned project file (candidate: `.worklist/hierarchy.json`) keyed by stable Stepstone goal IDs. It needs its own optimistic revision and must never corrupt or rewrite Stepstone’s worklist.
- Companion tasks/sub-tasks may never complete, archive, or otherwise mutate their anchored Stepstone root goal.
- Keep the default visible depth to three layers: `goal → task → sub-task`.

## Scaffold state

This project was scaffolded from `gh:brpaz/copier-typescript`.

- Package: `pi-stepstone-hierarchy`
- ESM TypeScript, pnpm (`pnpm@10.34.5`)
- Tooling: ESLint, Prettier, Vitest, tsdown, VitePress, Lefthook, GitHub Actions and Renovate templates
- Current repository: initialized locally on `main`, no remote configured; scaffolded files are currently untracked.

## Next implementation tasks

1. **Establish the Pi extension package shape.**
   - Add the Pi extension dependency/type support and a project-local extension entry point.
   - Add the `pi.extensions` manifest entry rather than modifying installed Stepstone.
   - Document how to load the companion locally (for example through Pi’s project-local extension discovery or an explicit local extension path).

2. **Discover and formalize the integration boundary.**
   - Inspect installed Stepstone’s exported/public package surface and CLI JSON outputs.
   - Prefer a documented versioned API if one is available.
   - Otherwise implement only a read-only adapter that resolves/list/checks root Project Goals through Stepstone’s CLI and treats CLI output as an external contract.
   - Add adapter tests using fixtures; do not couple tests to `node_modules/stepstone/src`.

3. **Implement the companion datasource and domain model.**
   - Define versioned `HierarchyWorklist`, `Task`, and `Subtask` TypeScript types.
   - Use stable child IDs, `rootGoalId`, `parentId`, status/timestamps, canonical sibling order, and a monotonic revision.
   - Implement atomic file writes and a lock appropriate for concurrent agent sessions.
   - Validate allowed nesting, parent cycles, self/descendant dependency cycles, missing roots, and stale expected-revision mutations.
   - Start with a focused test suite before Pi UI work.

4. **Expose a single companion mutation service.**
   - Route companion CLI/commands/model tool through one service.
   - Keep list/get responses bounded; request a subtree or details explicitly.
   - Preserve explicit confirmation for destructive lifecycle operations.

5. **Add the terminal hierarchy tree.**
   - Render read-only Stepstone roots with companion-owned children.
   - Clearly distinguish ownership.
   - Support keyboard expand/collapse, selection retention, add/edit, valid move/reorder, and guarded lifecycle requests.

6. **Defer these until the core prototype works.**
   - Configurable attributes: see [03-attributes.md](../pi-stepstone/docs/hierarchical-worklist/03-attributes.md).
   - Subagent handoff/reconciliation: see [04-subagent-handoff.md](../pi-stepstone/docs/hierarchical-worklist/04-subagent-handoff.md).
   - Web UI: see [05-web-ui.md](../pi-stepstone/docs/hierarchical-worklist/05-web-ui.md).

## Validation baseline

Before claiming a functional prototype, run the scaffold checks (after dependency installation):

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Add a focused integration test proving that absent, retired, or changed Stepstone root goals are rejected safely and that the companion datasource does not modify the Stepstone worklist.

## Potential upstream path

If the prototype proves valuable, propose native Stepstone support for hierarchy in its canonical datasource/shared application service. At that point, migrate child data through an explicit reviewed import; do not silently merge or rewrite existing Stepstone records.
