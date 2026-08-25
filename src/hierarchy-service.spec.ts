import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HierarchyError, HierarchyStore } from './hierarchy.js'
import { HierarchyService } from './hierarchy-service.js'
import type { RootGoalReader } from './root-goal.js'

const roots: RootGoalReader = {
  resolveGoal: async (id) => ({ id, state: 'open' }),
}

async function createService() {
  const directory = await mkdtemp(join(tmpdir(), 'hierarchy-service-'))
  const store = new HierarchyStore(
    join(directory, '.worklist', 'hierarchy.json'),
    roots
  )
  return { store, service: new HierarchyService(store) }
}

async function task(service: HierarchyService, revision = 0, title = 'Task') {
  return service.create({
    expectedRevision: revision,
    input: { kind: 'task', rootGoalId: 'goal-a', parentId: 'goal-a', title },
  })
}

describe('HierarchyService', () => {
  it('returns bounded summaries in canonical order and invalidates stale cursors', async () => {
    const { service } = await createService()
    for (let index = 0; index < 3; index += 1)
      await task(service, index, `Task ${index}`)

    const first = await service.list({ limit: 2 })
    expect(first.items.map((item) => item.title)).toEqual(['Task 0', 'Task 1'])
    expect(first.items[0]).not.toHaveProperty('description')
    expect(first.nextCursor).toBeDefined()

    const second = await service.list({ cursor: first.nextCursor })
    expect(second.items.map((item) => item.title)).toEqual(['Task 2'])
    await task(service, 3, 'Task 3')
    await expect(
      service.list({ cursor: first.nextCursor })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('returns explicit details and a bounded subtree', async () => {
    const { service } = await createService()
    const parent = await task(service)
    const child = await service.create({
      expectedRevision: 1,
      input: {
        kind: 'subtask',
        rootGoalId: 'goal-a',
        parentId: parent.item.id,
        title: 'Child',
        description: 'Details stay out of list responses',
      },
    })

    await expect(service.get({ id: child.item.id })).resolves.toMatchObject({
      revision: 2,
      item: { description: 'Details stay out of list responses' },
    })
    await expect(
      service.subtree({ id: parent.item.id, maxDepth: 0 })
    ).resolves.toMatchObject({
      tree: { children: [] },
      truncated: true,
    })
    await expect(
      service.subtree({ id: parent.item.id, limit: 1 })
    ).resolves.toMatchObject({
      tree: { children: [] },
      truncated: true,
    })
  })

  it('returns a confirmation request without mutating terminal lifecycle state', async () => {
    const { service, store } = await createService()
    const created = await task(service)

    await expect(
      service.setStatus({
        id: created.item.id,
        status: 'done',
        expectedRevision: 1,
      })
    ).resolves.toMatchObject({
      kind: 'confirmation-required',
      action: 'complete',
      expectedRevision: 1,
    })
    expect(await store.read()).toMatchObject({
      revision: 1,
      items: [{ status: 'open' }],
    })

    await expect(
      service.setStatus({
        id: created.item.id,
        status: 'done',
        expectedRevision: 1,
        confirmation: { approved: true, action: 'complete' },
      })
    ).resolves.toMatchObject({ revision: 2, item: { status: 'done' } })
  })

  it('rejects incorrect lifecycle approval and invalid external inputs', async () => {
    const { service } = await createService()
    const created = await task(service)
    await expect(
      service.setStatus({
        id: created.item.id,
        status: 'archived',
        expectedRevision: 1,
        confirmation: { approved: true, action: 'complete' },
      })
    ).resolves.toMatchObject({
      kind: 'confirmation-required',
      action: 'archive',
    })
    await expect(service.list({ limit: 101 })).rejects.toBeInstanceOf(
      HierarchyError
    )
    await expect(
      service.create({ expectedRevision: -1, input: created.item })
    ).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
    })
  })
})
