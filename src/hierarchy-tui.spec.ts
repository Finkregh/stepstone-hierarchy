import { describe, expect, it } from 'vitest'
import {
  buildHierarchyTree,
  visibleHierarchyRows,
  type HierarchyTreeNode,
} from './hierarchy-tui.js'

const roots = (nodes: HierarchyTreeNode[]) => nodes

describe('hierarchy terminal tree projection', () => {
  it('groups canonical companion items beneath read-only synthetic roots', () => {
    const tree = buildHierarchyTree([
      {
        id: 'task-1',
        kind: 'task',
        rootGoalId: 'goal-a',
        parentId: 'goal-a',
        title: 'Task',
        status: 'open',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'subtask-1',
        kind: 'subtask',
        rootGoalId: 'goal-a',
        parentId: 'task-1',
        title: 'Subtask',
        status: 'done',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    expect(tree).toMatchObject([
      {
        type: 'root',
        id: 'goal-a',
        children: [
          {
            type: 'task',
            id: 'task-1',
            children: [{ type: 'subtask', id: 'subtask-1' }],
          },
        ],
      },
    ])
  })

  it('keeps selection traversal deterministic when ancestors collapse', () => {
    const tree = roots([
      {
        id: 'goal-a',
        type: 'root',
        title: 'Stepstone root: goal-a',
        rootGoalId: 'goal-a',
        children: [
          {
            id: 'task-1',
            type: 'task',
            title: 'Task',
            rootGoalId: 'goal-a',
            parentId: 'goal-a',
            status: 'open',
            children: [
              {
                id: 'subtask-1',
                type: 'subtask',
                title: 'Subtask',
                rootGoalId: 'goal-a',
                parentId: 'task-1',
                status: 'open',
                children: [],
              },
            ],
          },
        ],
      },
    ])

    expect(
      visibleHierarchyRows(tree, new Set(['goal-a', 'task-1'])).map(
        (row) => row.node.id
      )
    ).toEqual(['goal-a', 'task-1', 'subtask-1'])
    expect(
      visibleHierarchyRows(tree, new Set(['goal-a'])).map((row) => row.node.id)
    ).toEqual(['goal-a', 'task-1'])
  })
})
