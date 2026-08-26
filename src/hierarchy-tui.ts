import { Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { HierarchyService, WorkItemSummary } from './hierarchy-service.js'

const TREE_MAX_ITEMS = 100

export interface HierarchyTreeNode {
  id: string
  key: string
  type: 'root' | 'task' | 'subtask'
  title: string
  status?: WorkItemSummary['status']
  parentId?: string
  rootGoalId: string
  children: HierarchyTreeNode[]
}

export interface HierarchyTreeSnapshot {
  revision: number
  itemCount: number
  truncated: boolean
  roots: HierarchyTreeNode[]
}

export interface VisibleHierarchyRow {
  node: HierarchyTreeNode
  depth: number
}

interface TreeTheme {
  fg(
    color:
      'accent' | 'dim' | 'error' | 'muted' | 'success' | 'text' | 'warning',
    text: string
  ): string
  bold(text: string): string
}

interface HierarchyTreeOptions {
  snapshot: HierarchyTreeSnapshot
  theme: TreeTheme
  requestRender(): void
  onClose(): void
  onRefresh(): Promise<HierarchyTreeSnapshot>
  onDetails(node: HierarchyTreeNode): void
  onAdd(
    node: HierarchyTreeNode,
    expectedRevision: number
  ): Promise<string | undefined>
  onSetStatus(
    node: HierarchyTreeNode,
    status: 'open' | 'done' | 'archived',
    expectedRevision: number
  ): Promise<boolean>
}

/** Loads a bounded, consistent companion snapshot through the public service. */
export async function loadHierarchyTree(
  service: HierarchyService,
  rootGoalId?: string
): Promise<HierarchyTreeSnapshot> {
  const items: WorkItemSummary[] = []
  let cursor: string | undefined
  let revision: number | undefined
  let truncated = false
  do {
    const page = await service.list({
      rootGoalId,
      cursor,
      limit: Math.min(100, TREE_MAX_ITEMS - items.length),
    })
    if (revision !== undefined && revision !== page.revision) {
      throw new Error('Hierarchy changed while loading; refresh and retry.')
    }
    revision = page.revision
    items.push(...page.items)
    cursor = page.nextCursor
    truncated = cursor !== undefined && items.length >= TREE_MAX_ITEMS
  } while (cursor !== undefined && !truncated)

  return {
    revision: revision ?? 0,
    itemCount: items.length,
    truncated,
    roots: buildHierarchyTree(items),
  }
}

export function buildHierarchyTree(
  items: WorkItemSummary[]
): HierarchyTreeNode[] {
  const byId = new Map<string, HierarchyTreeNode>()
  const roots = new Map<string, HierarchyTreeNode>()

  for (const item of items) {
    if (!roots.has(item.rootGoalId)) {
      roots.set(item.rootGoalId, {
        id: item.rootGoalId,
        key: `root:${item.rootGoalId}`,
        type: 'root',
        title: `Stepstone root: ${item.rootGoalId}`,
        rootGoalId: item.rootGoalId,
        children: [],
      })
    }
    byId.set(item.id, {
      id: item.id,
      key: `item:${item.id}`,
      type: item.kind,
      title: item.title,
      status: item.status,
      parentId: item.parentId,
      rootGoalId: item.rootGoalId,
      children: [],
    })
  }

  for (const item of items) {
    const node = byId.get(item.id)
    if (node === undefined) continue
    const parent =
      item.kind === 'task'
        ? roots.get(item.rootGoalId)
        : byId.get(item.parentId)
    parent?.children.push(node)
  }

  return [...roots.values()]
}

export function visibleHierarchyRows(
  roots: HierarchyTreeNode[],
  expandedIds: ReadonlySet<string>
): VisibleHierarchyRow[] {
  const rows: VisibleHierarchyRow[] = []
  const visit = (node: HierarchyTreeNode, depth: number) => {
    rows.push({ node, depth })
    if (!expandedIds.has(node.key)) return
    for (const child of node.children) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  return rows
}

export class HierarchyTreeComponent {
  private snapshot: HierarchyTreeSnapshot
  private expandedIds: Set<string>
  private selectedId?: string
  private loading = false
  private error?: string

  constructor(private readonly options: HierarchyTreeOptions) {
    this.snapshot = options.snapshot
    this.expandedIds = new Set(allExpandableIds(options.snapshot.roots))
    this.selectedId = visibleHierarchyRows(
      this.snapshot.roots,
      this.expandedIds
    )[0]?.node.id
  }

  handleInput(data: string): void {
    if (this.loading) return
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.options.onClose()
      return
    }
    if (matchesKey(data, Key.up) || data === 'k') this.selectOffset(-1)
    else if (matchesKey(data, Key.down) || data === 'j') this.selectOffset(1)
    else if (matchesKey(data, Key.home) || data === 'g') this.selectIndex(0)
    else if (matchesKey(data, Key.end) || data === 'G')
      this.selectIndex(this.rows().length - 1)
    else if (matchesKey(data, Key.right) || data === 'l')
      this.openOrEnterChild()
    else if (matchesKey(data, Key.left) || data === 'h')
      this.closeOrSelectParent()
    else if (matchesKey(data, Key.space)) this.toggleSelected()
    else if (matchesKey(data, Key.enter)) {
      const selected = this.selectedRow()?.node
      if (selected !== undefined) this.options.onDetails(selected)
    } else if (data === 'a') this.add()
    else if (data === 'd') this.setStatus('done')
    else if (data === 'x') this.setStatus('archived')
    else if (data === 'o') this.setStatus('open')
    else if (data === 'r') this.refresh()
    this.options.requestRender()
  }

  render(width: number): string[] {
    const rows = this.rows()
    const lines = [
      this.options.theme.fg(
        'accent',
        this.options.theme.bold(
          `Hierarchy — ${this.snapshot.itemCount} companion item${this.snapshot.itemCount === 1 ? '' : 's'} · revision ${this.snapshot.revision}`
        )
      ),
    ]
    if (this.error !== undefined)
      lines.push(this.options.theme.fg('error', this.error))
    if (this.loading)
      lines.push(this.options.theme.fg('warning', 'Refreshing hierarchy…'))
    if (this.snapshot.truncated)
      lines.push(
        this.options.theme.fg(
          'warning',
          `Showing first ${TREE_MAX_ITEMS} items; scope by root for more.`
        )
      )
    if (rows.length === 0)
      lines.push(this.options.theme.fg('dim', 'No companion hierarchy items.'))
    for (const row of rows) lines.push(this.renderRow(row))
    lines.push(
      this.options.theme.fg(
        'dim',
        '↑↓ navigate · ←→ collapse/open · a add · d done · x archive · o reopen · enter details · r refresh · esc close'
      )
    )
    return lines.map((line) => truncateToWidth(line, width))
  }

  invalidate(): void {}

  private rows(): VisibleHierarchyRow[] {
    return visibleHierarchyRows(this.snapshot.roots, this.expandedIds)
  }

  private selectedRow(): VisibleHierarchyRow | undefined {
    return this.rows().find((row) => row.node.key === this.selectedId)
  }

  private selectOffset(offset: number): void {
    const rows = this.rows()
    const index = rows.findIndex((row) => row.node.key === this.selectedId)
    this.selectIndex(Math.max(0, Math.min(rows.length - 1, index + offset)))
  }

  private selectIndex(index: number): void {
    this.selectedId = this.rows()[index]?.node.key
  }

  private toggleSelected(): void {
    const node = this.selectedRow()?.node
    if (node === undefined || node.children.length === 0) return
    if (this.expandedIds.has(node.key)) this.expandedIds.delete(node.key)
    else this.expandedIds.add(node.key)
  }

  private openOrEnterChild(): void {
    const node = this.selectedRow()?.node
    if (node === undefined || node.children.length === 0) return
    if (!this.expandedIds.has(node.key)) {
      this.expandedIds.add(node.key)
      return
    }
    this.selectedId = node.children[0]?.key
  }

  private closeOrSelectParent(): void {
    const row = this.selectedRow()
    if (row === undefined) return
    if (row.node.children.length > 0 && this.expandedIds.has(row.node.key)) {
      this.expandedIds.delete(row.node.key)
      return
    }
    if (row.node.parentId !== undefined)
      this.selectedId = `item:${row.node.parentId}`
    else if (row.node.type !== 'root')
      this.selectedId = `root:${row.node.rootGoalId}`
  }

  private add(): void {
    const node = this.selectedRow()?.node
    if (node === undefined) return
    if (node.type === 'subtask') {
      this.error = 'Subtasks cannot have children.'
      return
    }
    if (node.type === 'task' && node.status !== 'open') {
      this.error = 'A settled task cannot accept a subtask.'
      return
    }
    this.runMutation(() => this.options.onAdd(node, this.snapshot.revision))
  }

  private setStatus(status: 'open' | 'done' | 'archived'): void {
    const node = this.selectedRow()?.node
    if (node === undefined) return
    if (node.type === 'root') {
      this.error = 'Stepstone roots are read-only through this extension.'
      return
    }
    if (node.status === status) {
      this.error = `Item is already ${status}.`
      return
    }
    this.runMutation(() =>
      this.options.onSetStatus(node, status, this.snapshot.revision)
    )
  }

  private runMutation(
    operation: () => Promise<string | boolean | undefined>
  ): void {
    if (this.loading) return
    this.loading = true
    this.error = undefined
    this.options.requestRender()
    void operation().then(
      (selection) => {
        this.loading = false
        if (selection === false || selection === undefined) {
          this.options.requestRender()
          return
        }
        this.refresh(
          typeof selection === 'string' ? selection : this.selectedId
        )
      },
      (error: unknown) => {
        this.loading = false
        this.error = error instanceof Error ? error.message : String(error)
        this.options.requestRender()
      }
    )
  }

  private refresh(preferredSelection = this.selectedId): void {
    if (this.loading) return
    this.loading = true
    this.error = undefined
    void this.options.onRefresh().then(
      (snapshot) => {
        const selected = preferredSelection
        this.snapshot = snapshot
        this.expandedIds = new Set(allExpandableIds(snapshot.roots))
        const rows = this.rows()
        this.selectedId = rows.some((row) => row.node.key === selected)
          ? selected
          : rows[0]?.node.key
        this.loading = false
        this.options.requestRender()
      },
      (error: unknown) => {
        this.loading = false
        this.error = error instanceof Error ? error.message : String(error)
        this.options.requestRender()
      }
    )
  }

  private renderRow(row: VisibleHierarchyRow): string {
    const { node, depth } = row
    const selected = node.key === this.selectedId
    const prefix = selected ? this.options.theme.fg('accent', '› ') : '  '
    const indent = '  '.repeat(depth)
    const expand =
      node.children.length === 0
        ? '  '
        : this.expandedIds.has(node.key)
          ? '▾ '
          : '▸ '
    if (node.type === 'root') {
      return `${prefix}${indent}${this.options.theme.fg('muted', `${expand}◇ ${node.title} · read-only`)}`
    }
    const status =
      node.status === 'done' ? '✓' : node.status === 'archived' ? '–' : '○'
    const color =
      node.status === 'done'
        ? 'success'
        : node.status === 'archived'
          ? 'dim'
          : 'text'
    return `${prefix}${indent}${expand}${this.options.theme.fg(color, `${status} ${node.title}`)}`
  }
}

function allExpandableIds(roots: HierarchyTreeNode[]): string[] {
  const ids: string[] = []
  const visit = (node: HierarchyTreeNode) => {
    if (node.children.length > 0) ids.push(node.key)
    for (const child of node.children) visit(child)
  }
  for (const root of roots) visit(root)
  return ids
}
