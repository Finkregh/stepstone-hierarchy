import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { StringEnum } from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import {
  createHierarchyRuntime,
  type HierarchyAction,
} from './extension-runtime.js'
import { formatDoctorReport, runHierarchyDoctor } from './hierarchy-doctor.js'
import { HierarchyStore } from './hierarchy.js'
import { StepstoneCliRootGoalReader } from './root-goal.js'
import { HierarchyTreeComponent, loadHierarchyTree } from './hierarchy-tui.js'

const execFileAsync = promisify(execFile)

const Status = StringEnum(['open', 'done', 'archived'] as const)
const Kind = StringEnum(['task', 'subtask'] as const)
const Action = Type.Union([
  Type.Object({
    action: Type.Literal('list'),
    rootGoalId: Type.Optional(Type.String()),
    status: Type.Optional(Status),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }),
  Type.Object({ action: Type.Literal('get'), id: Type.String() }),
  Type.Object({
    action: Type.Literal('subtree'),
    id: Type.String(),
    maxDepth: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1)])),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }),
  Type.Object({
    action: Type.Literal('create'),
    expectedRevision: Type.Integer({ minimum: 0 }),
    kind: Kind,
    rootGoalId: Type.String(),
    parentId: Type.String(),
    title: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    dependsOn: Type.Optional(Type.Array(Type.String())),
  }),
  Type.Object({
    action: Type.Literal('update'),
    expectedRevision: Type.Integer({ minimum: 0 }),
    id: Type.String(),
    title: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    dependsOn: Type.Optional(Type.Array(Type.String())),
  }),
  Type.Object({
    action: Type.Literal('move'),
    expectedRevision: Type.Integer({ minimum: 0 }),
    id: Type.String(),
    parentId: Type.String(),
    beforeId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal('set_status'),
    expectedRevision: Type.Integer({ minimum: 0 }),
    id: Type.String(),
    status: Status,
  }),
])

export default function hierarchyExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'stepstone_hierarchy',
    label: 'Stepstone Hierarchy',
    description:
      'Read and manage companion-owned tasks beneath read-only Stepstone project goals.',
    promptSnippet:
      'Read and manage companion-owned tasks below Stepstone project goals.',
    promptGuidelines: [
      'Use stepstone_hierarchy rather than editing .worklist/hierarchy.json; never use it to mutate a Stepstone root goal.',
    ],
    parameters: Action,
    async execute(_toolCallId, action, _signal, _onUpdate, ctx) {
      const projectRoot = await resolveProjectRoot(ctx.cwd)
      const runtime = createHierarchyRuntime({
        projectRoot,
        confirmLifecycle: async (request) => {
          if (!ctx.hasUI) return false
          return ctx.ui.confirm(
            request.action === 'complete'
              ? 'Complete companion task?'
              : 'Archive companion task?',
            `${request.item.title}\n\nThis affects only companion task ${request.item.id}.`
          )
        },
      })
      const result = await runtime.execute(action as HierarchyAction)
      return {
        content: [{ type: 'text', text: formatResult(result) }],
        details: result,
      }
    },
  })

  pi.registerCommand('hierarchy-doctor', {
    description:
      'Diagnose companion hierarchy data and referenced Stepstone roots without changing either worklist',
    handler: async (_args, ctx) => {
      try {
        const projectRoot = await resolveProjectRoot(ctx.cwd)
        const roots = new StepstoneCliRootGoalReader(projectRoot)
        const report = await runHierarchyDoctor(
          new HierarchyStore(joinHierarchyPath(projectRoot), roots),
          roots
        )
        if (ctx.hasUI)
          ctx.ui.notify(
            formatDoctorReport(report),
            report.ok ? 'info' : 'warning'
          )
      } catch (error) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `DOCTOR_FAILED: ${error instanceof Error ? error.message : String(error)}. No files were changed.`,
            'warning'
          )
        }
      }
    },
  })

  pi.registerCommand('hierarchy', {
    description:
      'List bounded companion hierarchy task summaries, optionally for one root goal',
    handler: async (args, ctx) => {
      const projectRoot = await resolveProjectRoot(ctx.cwd)
      const rootGoalId = args.trim() || undefined
      const runtime = createHierarchyRuntime({
        projectRoot,
        confirmLifecycle: async (request) =>
          ctx.ui.confirm(
            request.action === 'complete'
              ? 'Complete companion task?'
              : 'Archive companion task?',
            `${request.item.title}\n\nThis affects only companion task ${request.item.id}.`
          ),
      })
      const load = () => loadHierarchyTree(runtime.service, rootGoalId)
      if (ctx.mode === 'tui') {
        const snapshot = await load()
        await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
          const component = new HierarchyTreeComponent({
            snapshot,
            theme,
            requestRender: () => tui.requestRender(),
            onClose: () => done(),
            onRefresh: load,
            onDetails: (node) => {
              const ownership =
                node.type === 'root'
                  ? 'Stepstone root — read-only'
                  : 'Companion-owned item'
              ctx.ui.notify(`${ownership}\n${node.id}`, 'info')
            },
            onAdd: async (node, expectedRevision) => {
              const title = await ctx.ui.input(
                node.type === 'root'
                  ? 'Add companion task'
                  : 'Add companion subtask',
                node.type === 'root' ? 'Task title' : 'Subtask title'
              )
              if (title === undefined) return undefined
              const trimmedTitle = title.trim()
              if (trimmedTitle === '') throw new Error('Title is required.')
              const result = await runtime.execute(
                node.type === 'root'
                  ? {
                      action: 'create',
                      expectedRevision,
                      kind: 'task',
                      rootGoalId: node.rootGoalId,
                      parentId: node.rootGoalId,
                      title: trimmedTitle,
                    }
                  : {
                      action: 'create',
                      expectedRevision,
                      kind: 'subtask',
                      rootGoalId: node.rootGoalId,
                      parentId: node.id,
                      title: trimmedTitle,
                    }
              )
              if (result.operation !== 'create')
                throw new Error('Create did not return an item.')
              return result.result.item.id
            },
            onSetStatus: async (node, status, expectedRevision) => {
              const result = await runtime.execute({
                action: 'set_status',
                expectedRevision,
                id: node.id,
                status,
              })
              if ('kind' in result && result.kind === 'cancelled') return false
              if (!('result' in result) || result.operation !== 'set_status') {
                throw new Error('Status change was not applied.')
              }
              if ('kind' in result.result)
                throw new Error('Status change requires confirmation.')
              return true
            },
          })
          return component
        })
        return
      }
      const result = await runtime.execute({
        action: 'list',
        rootGoalId,
        limit: 25,
      })
      if (result.operation !== 'list') return
      if (ctx.hasUI) ctx.ui.notify(formatResult(result), 'info')
    },
  })
}

function joinHierarchyPath(projectRoot: string): string {
  return `${projectRoot}/.worklist/hierarchy.json`
}

async function resolveProjectRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd }
    )
    const root = stdout.trim()
    if (root === '') throw new Error('empty Git root')
    return await realpath(root)
  } catch {
    throw new Error('stepstone_hierarchy requires a Git repository')
  }
}

export function formatResult(
  result: Awaited<
    ReturnType<ReturnType<typeof createHierarchyRuntime>['execute']>
  >
): string {
  if ('kind' in result && result.kind === 'cancelled') {
    return 'Lifecycle change cancelled; no companion data was changed.'
  }
  if (result.operation === 'list') {
    const items = result.result.items
      .map((item) => `[${item.status}] ${item.id} ${item.title}`)
      .join('\n')
    return `${result.result.revision}: ${items || 'No companion items'}`
  }
  if (
    result.operation === 'set_status' &&
    'result' in result &&
    'kind' in result.result
  ) {
    return `Confirmation required to ${result.result.action} ${result.result.item.id}.`
  }
  if (
    'result' in result &&
    'item' in result.result &&
    'revision' in result.result
  ) {
    const { item, revision } = result.result
    switch (result.operation) {
      case 'create':
        return `Created ${item.kind} "${item.title}" (${item.id}) under ${item.parentId}; hierarchy revision is ${revision}.`
      case 'update':
        return `Updated "${item.title}" (${item.id}); hierarchy revision is ${revision}.`
      case 'move':
        return `Moved "${item.title}" (${item.id}) under ${item.parentId}; hierarchy revision is ${revision}.`
      case 'set_status':
        return `Marked "${item.title}" (${item.id}) as ${item.status}; hierarchy revision is ${revision}.`
      case 'get':
        return `Retrieved "${item.title}" (${item.id}) at hierarchy revision ${revision}.`
      default:
        return `${result.operation} completed.`
    }
  }
  return `${result.operation} completed.`
}
