import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runHierarchyDoctor } from './hierarchy-doctor.js'
import { HierarchyStore } from './hierarchy.js'
import type { RootGoalReader } from './root-goal.js'

async function temporaryStore(roots: RootGoalReader) {
  const directory = await mkdtemp(join(tmpdir(), 'hierarchy-doctor-'))
  const path = join(directory, '.worklist', 'hierarchy.json')
  return { path, store: new HierarchyStore(path, roots) }
}

describe('runHierarchyDoctor', () => {
  it('reports a missing companion file as a healthy empty worklist without writing it', async () => {
    const { path, store } = await temporaryStore({
      resolveGoal: async (id) => ({ id, state: 'open' }),
    })

    await expect(
      runHierarchyDoctor(store, {
        resolveGoal: async (id) => ({ id, state: 'open' }),
      })
    ).resolves.toMatchObject({
      ok: true,
      revision: 0,
      itemCount: 0,
      rootGoalCount: 0,
      findings: [{ code: 'HIERARCHY_EMPTY' }, { code: 'ROOTS_NONE' }],
    })
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('continues root checks and reports retired, missing, and unverifiable anchors', async () => {
    const states: ReadonlyMap<string, 'open' | 'retired' | 'missing'> = new Map(
      [
        ['open-root', 'open'],
        ['retired-root', 'retired'],
        ['missing-root', 'missing'],
      ]
    )
    const roots: RootGoalReader = {
      resolveGoal: async (id) => {
        if (id === 'broken-root') throw new Error('Stepstone unavailable')
        return { id, state: states.get(id) ?? 'missing' }
      },
    }
    const { store } = await temporaryStore({
      resolveGoal: async (id) => ({ id, state: 'open' }),
    })
    let revision = 0
    for (const rootGoalId of [
      'retired-root',
      'open-root',
      'missing-root',
      'broken-root',
    ]) {
      await store.create(
        { kind: 'task', rootGoalId, parentId: rootGoalId, title: rootGoalId },
        revision
      )
      revision += 1
    }

    const report = await runHierarchyDoctor(store, roots)
    expect(report.ok).toBe(false)
    expect(report.findings.map((finding) => finding.code)).toEqual([
      'HIERARCHY_OK',
      'ROOT_UNVERIFIABLE',
      'ROOT_MISSING',
      'ROOT_OPEN',
      'ROOT_RETIRED',
    ])
  })
})
