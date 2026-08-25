import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createHierarchyRuntime,
  type HierarchyActionResult,
} from './extension-runtime.js'
import type { WorkItem } from './hierarchy.js'
import type { RootGoalReader } from './root-goal.js'

const roots: RootGoalReader = {
  resolveGoal: async (id) => ({ id, state: 'open' }),
}

async function createRuntime(
  confirmLifecycle?: (request: {
    action: 'complete' | 'archive'
  }) => Promise<boolean>
) {
  const root = await mkdtemp(join(tmpdir(), 'hierarchy-runtime-'))
  return createHierarchyRuntime({
    projectRoot: root,
    rootGoals: roots,
    confirmLifecycle,
  })
}

describe('createHierarchyRuntime', () => {
  it('dispatches only bounded service operations', async () => {
    const runtime = await createRuntime()
    const created = await runtime.execute({
      action: 'create',
      expectedRevision: 0,
      kind: 'task',
      rootGoalId: 'goal-a',
      parentId: 'goal-a',
      title: 'Task',
    })
    const listed = await runtime.execute({ action: 'list', limit: 1 })

    expect(created).toMatchObject({
      operation: 'create',
      result: { revision: 1, item: { title: 'Task' } },
    })
    expect(listed).toMatchObject({
      operation: 'list',
      result: { revision: 1, items: [{ title: 'Task' }] },
    })
    expect(listResult(listed).items[0]).not.toHaveProperty('description')
  })

  it('does not complete a task when lifecycle approval is absent or declined', async () => {
    const runtime = await createRuntime()
    const created = await runtime.execute({
      action: 'create',
      expectedRevision: 0,
      kind: 'task',
      rootGoalId: 'goal-a',
      parentId: 'goal-a',
      title: 'Task',
    })

    const cancelled = await runtime.execute({
      action: 'set_status',
      expectedRevision: 1,
      id: itemResult(created).id,
      status: 'done',
    })
    expect(cancelled).toMatchObject({
      operation: 'set_status',
      kind: 'cancelled',
    })
    await expect(
      runtime.execute({ action: 'get', id: itemResult(created).id })
    ).resolves.toMatchObject({
      operation: 'get',
      result: { item: { status: 'open' } },
    })
  })

  it('consumes a UI lifecycle approval bound to the requested action', async () => {
    const runtime = await createRuntime(
      async (request) => request.action === 'complete'
    )
    const created = await runtime.execute({
      action: 'create',
      expectedRevision: 0,
      kind: 'task',
      rootGoalId: 'goal-a',
      parentId: 'goal-a',
      title: 'Task',
    })

    await expect(
      runtime.execute({
        action: 'set_status',
        expectedRevision: 1,
        id: itemResult(created).id,
        status: 'done',
      })
    ).resolves.toMatchObject({
      operation: 'set_status',
      result: { revision: 2, item: { status: 'done' } },
    })
  })
})

function itemResult(result: HierarchyActionResult): WorkItem {
  if (
    (result.operation !== 'create' &&
      result.operation !== 'update' &&
      result.operation !== 'move') ||
    !('item' in result.result)
  ) {
    throw new Error('Expected a hierarchy mutation result')
  }
  return result.result.item
}

function listResult(result: HierarchyActionResult): { items: unknown[] } {
  if (result.operation !== 'list')
    throw new Error('Expected a hierarchy list result')
  return result.result
}
