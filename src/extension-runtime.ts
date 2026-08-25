import { join } from 'node:path'
import {
  HierarchyService,
  type ConfirmationRequiredResponse,
  type ListHierarchyCommand,
} from './hierarchy-service.js'
import { HierarchyStore } from './hierarchy.js'
import { StepstoneCliRootGoalReader, type RootGoalReader } from './root-goal.js'

export type HierarchyAction =
  | {
      action: 'list'
      rootGoalId?: string
      status?: 'open' | 'done' | 'archived'
      cursor?: string
      limit?: number
    }
  | { action: 'get'; id: string }
  | { action: 'subtree'; id: string; maxDepth?: 0 | 1; limit?: number }
  | {
      action: 'create'
      expectedRevision: number
      kind: 'task' | 'subtask'
      rootGoalId: string
      parentId: string
      title: string
      description?: string
      dependsOn?: string[]
    }
  | {
      action: 'update'
      expectedRevision: number
      id: string
      title?: string
      description?: string
      dependsOn?: string[]
    }
  | {
      action: 'move'
      expectedRevision: number
      id: string
      parentId: string
      beforeId?: string
    }
  | {
      action: 'set_status'
      expectedRevision: number
      id: string
      status: 'open' | 'done' | 'archived'
    }

export type HierarchyActionResult =
  | { operation: 'list'; result: Awaited<ReturnType<HierarchyService['list']>> }
  | { operation: 'get'; result: Awaited<ReturnType<HierarchyService['get']>> }
  | {
      operation: 'subtree'
      result: Awaited<ReturnType<HierarchyService['subtree']>>
    }
  | {
      operation: 'create' | 'update' | 'move'
      result: Awaited<ReturnType<HierarchyService['create']>>
    }
  | {
      operation: 'set_status'
      result: Awaited<ReturnType<HierarchyService['setStatus']>>
    }
  | {
      operation: 'set_status'
      kind: 'cancelled'
      confirmation: ConfirmationRequiredResponse
    }

export type ConfirmLifecycle = (
  request: ConfirmationRequiredResponse
) => Promise<boolean>

export interface HierarchyRuntimeOptions {
  projectRoot: string
  rootGoals?: RootGoalReader
  service?: HierarchyService
  confirmLifecycle?: ConfirmLifecycle
}

/** Creates the sole extension-facing service and action dispatcher. */
export function createHierarchyRuntime(options: HierarchyRuntimeOptions): {
  service: HierarchyService
  execute(action: HierarchyAction): Promise<HierarchyActionResult>
} {
  const service =
    options.service ??
    new HierarchyService(
      new HierarchyStore(
        join(options.projectRoot, '.worklist', 'hierarchy.json'),
        options.rootGoals ?? new StepstoneCliRootGoalReader(options.projectRoot)
      )
    )

  return {
    service,
    async execute(action) {
      switch (action.action) {
        case 'list':
          return {
            operation: 'list',
            result: await service.list(listCommand(action)),
          }
        case 'get':
          return {
            operation: 'get',
            result: await service.get({ id: action.id }),
          }
        case 'subtree':
          return {
            operation: 'subtree',
            result: await service.subtree({
              id: action.id,
              maxDepth: action.maxDepth,
              limit: action.limit,
            }),
          }
        case 'create':
          return {
            operation: 'create',
            result: await service.create({
              expectedRevision: action.expectedRevision,
              input: {
                kind: action.kind,
                rootGoalId: action.rootGoalId,
                parentId: action.parentId,
                title: action.title,
                description: action.description,
                dependsOn: action.dependsOn,
              },
            }),
          }
        case 'update':
          return {
            operation: 'update',
            result: await service.update({
              expectedRevision: action.expectedRevision,
              id: action.id,
              input: {
                title: action.title,
                description: action.description,
                dependsOn: action.dependsOn,
              },
            }),
          }
        case 'move':
          return {
            operation: 'move',
            result: await service.move({
              expectedRevision: action.expectedRevision,
              id: action.id,
              input: { parentId: action.parentId, beforeId: action.beforeId },
            }),
          }
        case 'set_status':
          return executeStatus(service, action, options.confirmLifecycle)
        default:
          return unreachableAction(action)
      }
    },
  }
}

async function executeStatus(
  service: HierarchyService,
  action: Extract<HierarchyAction, { action: 'set_status' }>,
  confirmLifecycle: ConfirmLifecycle | undefined
): Promise<HierarchyActionResult> {
  const result = await service.setStatus({
    id: action.id,
    status: action.status,
    expectedRevision: action.expectedRevision,
  })
  if (!('kind' in result) || result.kind !== 'confirmation-required') {
    return { operation: 'set_status', result }
  }
  if (confirmLifecycle === undefined || !(await confirmLifecycle(result))) {
    return { operation: 'set_status', kind: 'cancelled', confirmation: result }
  }
  return {
    operation: 'set_status',
    result: await service.setStatus({
      id: action.id,
      status: action.status,
      expectedRevision: action.expectedRevision,
      confirmation: { approved: true, action: result.action },
    }),
  }
}

function unreachableAction(action: never): never {
  throw new Error(`Unsupported hierarchy action: ${JSON.stringify(action)}`)
}

function listCommand(
  action: Extract<HierarchyAction, { action: 'list' }>
): ListHierarchyCommand {
  return {
    rootGoalId: action.rootGoalId,
    status: action.status,
    cursor: action.cursor,
    limit: action.limit,
  }
}
