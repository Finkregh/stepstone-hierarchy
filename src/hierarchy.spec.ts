import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HierarchyError, HierarchyStore } from './hierarchy.js'
import type { RootGoalReader } from './root-goal.js'

const roots = (ids: string[]): RootGoalReader => ({
  resolveGoal: async (id) => ({
    id,
    state: ids.includes(id) ? 'open' : 'missing',
  }),
})

async function createStore(rootIds = ['goal-a']) {
  const directory = await mkdtemp(join(tmpdir(), 'hierarchy-'))
  const path = join(directory, '.worklist', 'hierarchy.json')
  return { path, store: new HierarchyStore(path, roots(rootIds)) }
}

describe('HierarchyStore', () => {
  it('persists a task and a subtask without changing the Stepstone worklist', async () => {
    const { path, store } = await createStore()
    const task = await store.create(
      {
        kind: 'task',
        rootGoalId: 'goal-a',
        parentId: 'goal-a',
        title: 'Implement store',
      },
      0
    )
    const subtask = await store.create(
      {
        kind: 'subtask',
        rootGoalId: 'goal-a',
        parentId: task.id,
        title: 'Add tests',
      },
      1
    )

    const document = await store.read()
    expect(document).toMatchObject({ version: 1, revision: 2 })
    expect(document.items.map((item) => item.id)).toEqual([task.id, subtask.id])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(document)
  })

  it('rejects missing roots and invalid nesting before writing', async () => {
    const { store } = await createStore()
    await expect(
      store.create(
        {
          kind: 'task',
          rootGoalId: 'retired',
          parentId: 'retired',
          title: 'Orphaned',
        },
        0
      )
    ).rejects.toMatchObject({ code: 'ROOT_GOAL_MISSING' })
    await expect(
      store.create(
        {
          kind: 'subtask',
          rootGoalId: 'goal-a',
          parentId: 'goal-a',
          title: 'Invalid',
        },
        0
      )
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await store.read()).toEqual({ version: 1, revision: 0, items: [] })
  })

  it('rejects a retired root and changed roots before every mutation', async () => {
    let state: 'open' | 'retired' | 'missing' = 'open'
    const directory = await mkdtemp(join(tmpdir(), 'hierarchy-'))
    const store = new HierarchyStore(
      join(directory, '.worklist', 'hierarchy.json'),
      {
        resolveGoal: async (id) => ({ id, state }),
      }
    )
    const task = await store.create(
      {
        kind: 'task',
        rootGoalId: 'goal-a',
        parentId: 'goal-a',
        title: 'Parent',
      },
      0
    )

    state = 'retired'
    await expect(
      store.update(task.id, { title: 'Changed' }, 1)
    ).rejects.toMatchObject({
      code: 'ROOT_GOAL_RETIRED',
    })
    state = 'missing'
    await expect(
      store.move(task.id, { parentId: 'goal-a' }, 1)
    ).rejects.toMatchObject({
      code: 'ROOT_GOAL_MISSING',
    })
    expect(await store.read()).toMatchObject({
      revision: 1,
      items: [{ title: 'Parent' }],
    })
  })

  it('prevents open subtasks below a settled task', async () => {
    const { store } = await createStore()
    const parent = await store.create(
      {
        kind: 'task',
        rootGoalId: 'goal-a',
        parentId: 'goal-a',
        title: 'Parent',
      },
      0
    )
    await store.setStatus(parent.id, 'done', 1)

    await expect(
      store.create(
        {
          kind: 'subtask',
          rootGoalId: 'goal-a',
          parentId: parent.id,
          title: 'Child',
        },
        2
      )
    ).rejects.toMatchObject({ code: 'INVALID_NESTING' })
  })

  it('rejects stale revisions and prevents unsettled descendants from closing a task', async () => {
    const { store } = await createStore()
    const task = await store.create(
      {
        kind: 'task',
        rootGoalId: 'goal-a',
        parentId: 'goal-a',
        title: 'Parent',
      },
      0
    )
    await store.create(
      {
        kind: 'subtask',
        rootGoalId: 'goal-a',
        parentId: task.id,
        title: 'Child',
      },
      1
    )

    await expect(
      store.update(task.id, { title: 'Stale update' }, 0)
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(store.setStatus(task.id, 'done', 2)).rejects.toMatchObject({
      code: 'DESCENDANTS_UNSETTLED',
    })
  })

  it('rejects self and descendant dependencies', async () => {
    const { store } = await createStore()
    const task = await store.create(
      {
        kind: 'task',
        rootGoalId: 'goal-a',
        parentId: 'goal-a',
        title: 'Parent',
      },
      0
    )
    const child = await store.create(
      {
        kind: 'subtask',
        rootGoalId: 'goal-a',
        parentId: task.id,
        title: 'Child',
      },
      1
    )

    await expect(
      store.update(task.id, { dependsOn: [child.id] }, 2)
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HierarchyError && error.code === 'DEPENDENCY_CYCLE'
    )
    await expect(
      store.update(child.id, { dependsOn: [child.id] }, 2)
    ).rejects.toMatchObject({
      code: 'DEPENDENCY_CYCLE',
    })
  })

  it('allows a task to move only to its anchored root and subtask only to a sibling task', async () => {
    const { store } = await createStore()
    const first = await store.create(
      {
        kind: 'task',
        rootGoalId: 'goal-a',
        parentId: 'goal-a',
        title: 'First',
      },
      0
    )
    const second = await store.create(
      {
        kind: 'task',
        rootGoalId: 'goal-a',
        parentId: 'goal-a',
        title: 'Second',
      },
      1
    )
    const child = await store.create(
      {
        kind: 'subtask',
        rootGoalId: 'goal-a',
        parentId: first.id,
        title: 'Child',
      },
      2
    )

    await store.move(child.id, { parentId: second.id }, 3)
    await expect(
      store.move(first.id, { parentId: second.id }, 4)
    ).rejects.toMatchObject({
      code: 'INVALID_NESTING',
    })
  })
})
