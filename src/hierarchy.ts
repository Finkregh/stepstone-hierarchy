import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RootGoalReader } from './root-goal.js'

export const HIERARCHY_VERSION = 1 as const

export type WorkItemStatus = 'open' | 'done' | 'archived'
export type WorkItemKind = 'task' | 'subtask'

interface WorkItemBase {
  id: string
  rootGoalId: string
  parentId: string
  title: string
  description: string
  status: WorkItemStatus
  dependsOn: string[]
  createdAt: string
  updatedAt: string
}

export interface Task extends WorkItemBase {
  kind: 'task'
}

export interface Subtask extends WorkItemBase {
  kind: 'subtask'
}

export type WorkItem = Task | Subtask

export interface HierarchyWorklist {
  version: typeof HIERARCHY_VERSION
  revision: number
  items: WorkItem[]
}

export interface CreateItemInput {
  kind: WorkItemKind
  rootGoalId: string
  parentId: string
  title: string
  description?: string
  dependsOn?: string[]
}

export interface UpdateItemInput {
  title?: string
  description?: string
  dependsOn?: string[]
}

export interface MoveItemInput {
  parentId: string
  beforeId?: string
}

export class HierarchyError extends Error {
  constructor(
    readonly code:
      | 'CONFLICT'
      | 'INVALID_DOCUMENT'
      | 'INVALID_NESTING'
      | 'NOT_FOUND'
      | 'ROOT_GOAL_MISSING'
      | 'ROOT_GOAL_RETIRED'
      | 'DEPENDENCY_CYCLE'
      | 'DESCENDANTS_UNSETTLED',
    message: string
  ) {
    super(message)
    this.name = 'HierarchyError'
  }
}

const emptyWorklist = (): HierarchyWorklist => ({
  version: HIERARCHY_VERSION,
  revision: 0,
  items: [],
})

/**
 * Stores only companion-owned work. Its root references are checked through the
 * injected reader, keeping Stepstone's worklist entirely outside this store.
 */
export class HierarchyStore {
  private readonly lockPath: string

  constructor(
    readonly path: string,
    private readonly rootGoals: RootGoalReader,
    private readonly lockRetryMs = 10,
    private readonly lockTimeoutMs = 2_000
  ) {
    this.lockPath = `${path}.lock`
  }

  async read(): Promise<HierarchyWorklist> {
    return this.readDocument()
  }

  async create(
    input: CreateItemInput,
    expectedRevision: number
  ): Promise<WorkItem> {
    return this.mutate(expectedRevision, async (document) => {
      await this.assertRootExists(input.rootGoalId)
      this.assertParent(document, input.kind, input.rootGoalId, input.parentId)
      this.assertParentIsOpen(document, input.kind, input.parentId)

      const timestamp = new Date().toISOString()
      const item: WorkItem = {
        id: randomUUID(),
        kind: input.kind,
        rootGoalId: input.rootGoalId,
        parentId: input.parentId,
        title: nonEmpty(input.title, 'title'),
        description: input.description ?? '',
        status: 'open',
        dependsOn: unique(input.dependsOn ?? []),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      document.items.push(item)
      validateDocument(document)
      return item
    })
  }

  async update(
    id: string,
    input: UpdateItemInput,
    expectedRevision: number
  ): Promise<WorkItem> {
    return this.mutate(expectedRevision, async (document) => {
      const item = requiredItem(document, id)
      await this.assertRootIsOpen(item.rootGoalId)
      if (input.title !== undefined) item.title = nonEmpty(input.title, 'title')
      if (input.description !== undefined) item.description = input.description
      if (input.dependsOn !== undefined)
        item.dependsOn = unique(input.dependsOn)
      item.updatedAt = new Date().toISOString()
      validateDocument(document)
      return item
    })
  }

  async move(
    id: string,
    input: MoveItemInput,
    expectedRevision: number
  ): Promise<WorkItem> {
    return this.mutate(expectedRevision, async (document) => {
      const item = requiredItem(document, id)
      await this.assertRootIsOpen(item.rootGoalId)
      this.assertParent(document, item.kind, item.rootGoalId, input.parentId)
      this.assertParentIsOpen(document, item.kind, input.parentId)
      item.parentId = input.parentId
      item.updatedAt = new Date().toISOString()
      reorder(document.items, item, input.beforeId)
      validateDocument(document)
      return item
    })
  }

  async setStatus(
    id: string,
    status: WorkItemStatus,
    expectedRevision: number
  ): Promise<WorkItem> {
    return this.mutate(expectedRevision, async (document) => {
      const item = requiredItem(document, id)
      await this.assertRootIsOpen(item.rootGoalId)
      if (
        (status === 'done' || status === 'archived') &&
        hasUnsettledDescendant(document, item.id)
      ) {
        throw new HierarchyError(
          'DESCENDANTS_UNSETTLED',
          `Cannot ${status === 'done' ? 'complete' : 'archive'} ${item.id} while descendants remain open`
        )
      }
      if (status === 'open')
        this.assertParentIsOpen(document, item.kind, item.parentId)
      item.status = status
      item.updatedAt = new Date().toISOString()
      return item
    })
  }

  private async mutate<T>(
    expectedRevision: number,
    operation: (document: HierarchyWorklist) => Promise<T> | T
  ): Promise<T> {
    return this.withLock(async () => {
      const document = await this.readDocument()
      if (document.revision !== expectedRevision) {
        throw new HierarchyError(
          'CONFLICT',
          `Expected revision ${expectedRevision}, found ${document.revision}`
        )
      }
      const result = await operation(document)
      document.revision += 1
      await this.writeDocument(document)
      return result
    })
  }

  private assertParent(
    document: HierarchyWorklist,
    kind: WorkItemKind,
    rootGoalId: string,
    parentId: string
  ): void {
    if (kind === 'task') {
      if (parentId !== rootGoalId) {
        throw new HierarchyError(
          'INVALID_NESTING',
          'A task parent must be its Stepstone root goal'
        )
      }
      return
    }

    const parent = requiredItem(document, parentId)
    if (parent.kind !== 'task' || parent.rootGoalId !== rootGoalId) {
      throw new HierarchyError(
        'INVALID_NESTING',
        'A subtask parent must be a task under the same root'
      )
    }
  }

  private assertParentIsOpen(
    document: HierarchyWorklist,
    kind: WorkItemKind,
    parentId: string
  ): void {
    if (kind === 'task') return
    const parent = requiredItem(document, parentId)
    if (parent.status !== 'open') {
      throw new HierarchyError(
        'INVALID_NESTING',
        `Cannot add or reopen a subtask below settled task ${parent.id}`
      )
    }
  }

  private async assertRootExists(rootGoalId: string): Promise<void> {
    await this.assertRootIsOpen(rootGoalId)
  }

  private async assertRootIsOpen(rootGoalId: string): Promise<void> {
    const root = await this.rootGoals.resolveGoal(rootGoalId)
    if (root.state === 'open') return
    if (root.state === 'retired') {
      throw new HierarchyError(
        'ROOT_GOAL_RETIRED',
        `Stepstone root goal ${rootGoalId} is retired`
      )
    }
    throw new HierarchyError(
      'ROOT_GOAL_MISSING',
      `Stepstone root goal ${rootGoalId} was not found`
    )
  }

  private async readDocument(): Promise<HierarchyWorklist> {
    try {
      const content = await readFile(this.path, 'utf8')
      const document: unknown = JSON.parse(content)
      validateDocument(document)
      return document
    } catch (error) {
      if (isMissingFile(error)) return emptyWorklist()
      if (error instanceof HierarchyError) throw error
      throw new HierarchyError(
        'INVALID_DOCUMENT',
        `Unable to read hierarchy worklist: ${String(error)}`
      )
    }
  }

  private async writeDocument(document: HierarchyWorklist): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = join(
      dirname(this.path),
      `.${randomUUID()}.hierarchy.tmp`
    )
    await writeFile(
      temporaryPath,
      `${JSON.stringify(document, null, 2)}\n`,
      'utf8'
    )
    await rename(temporaryPath, this.path)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true })
    const startedAt = Date.now()
    let handle: Awaited<ReturnType<typeof open>> | undefined
    while (handle === undefined) {
      try {
        handle = await open(this.lockPath, 'wx')
      } catch (error) {
        if (
          !isAlreadyExists(error) ||
          Date.now() - startedAt >= this.lockTimeoutMs
        )
          throw error
        await delay(this.lockRetryMs)
      }
    }

    try {
      return await operation()
    } finally {
      await handle.close()
      await rm(this.lockPath, { force: true })
    }
  }
}

function validateDocument(value: unknown): asserts value is HierarchyWorklist {
  if (
    !isRecord(value) ||
    value.version !== HIERARCHY_VERSION ||
    !Number.isInteger(value.revision)
  ) {
    throw new HierarchyError(
      'INVALID_DOCUMENT',
      'Hierarchy worklist has an unsupported shape or version'
    )
  }
  if (!Array.isArray(value.items)) {
    throw new HierarchyError(
      'INVALID_DOCUMENT',
      'Hierarchy worklist items must be an array'
    )
  }

  // SAFETY: the structural guards above establish the document-level fields.
  const document = value as unknown as HierarchyWorklist
  const ids = new Set<string>()
  for (const item of document.items) {
    if (!isWorkItem(item) || ids.has(item.id)) {
      throw new HierarchyError(
        'INVALID_DOCUMENT',
        'Hierarchy items must have unique valid IDs'
      )
    }
    ids.add(item.id)
  }

  for (const item of document.items) {
    if (item.kind === 'task') {
      if (item.parentId !== item.rootGoalId) invalidNesting(item)
    } else {
      const parent = document.items.find(
        (candidate) => candidate.id === item.parentId
      )
      if (parent?.kind !== 'task' || parent.rootGoalId !== item.rootGoalId)
        invalidNesting(item)
    }
    for (const dependency of item.dependsOn) {
      if (!ids.has(dependency)) {
        throw new HierarchyError(
          'INVALID_DOCUMENT',
          `Dependency ${dependency} does not exist`
        )
      }
      if (
        dependency === item.id ||
        isDescendant(document, dependency, item.id)
      ) {
        throw new HierarchyError(
          'DEPENDENCY_CYCLE',
          `Dependency ${dependency} is self or descendant of ${item.id}`
        )
      }
    }
  }
}

function isWorkItem(value: unknown): value is WorkItem {
  if (!isRecord(value)) return false
  return (
    (value.kind === 'task' || value.kind === 'subtask') &&
    typeof value.id === 'string' &&
    typeof value.rootGoalId === 'string' &&
    typeof value.parentId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    (value.status === 'open' ||
      value.status === 'done' ||
      value.status === 'archived') &&
    Array.isArray(value.dependsOn) &&
    value.dependsOn.every((dependency) => typeof dependency === 'string') &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function requiredItem(document: HierarchyWorklist, id: string): WorkItem {
  const item = document.items.find((candidate) => candidate.id === id)
  if (item === undefined)
    throw new HierarchyError('NOT_FOUND', `Hierarchy item ${id} was not found`)
  return item
}

function reorder(
  items: WorkItem[],
  item: WorkItem,
  beforeId: string | undefined
): void {
  const previousIndex = items.indexOf(item)
  items.splice(previousIndex, 1)
  if (beforeId === undefined) {
    items.push(item)
    return
  }
  const anchorIndex = items.findIndex((candidate) => candidate.id === beforeId)
  if (anchorIndex === -1 || items[anchorIndex]?.parentId !== item.parentId) {
    throw new HierarchyError(
      'INVALID_NESTING',
      'The ordering anchor must be a sibling'
    )
  }
  items.splice(anchorIndex, 0, item)
}

function isDescendant(
  document: HierarchyWorklist,
  candidateId: string,
  ancestorId: string
): boolean {
  let current = document.items.find((item) => item.id === candidateId)
  while (current !== undefined) {
    if (current.parentId === ancestorId) return true
    current = document.items.find((item) => item.id === current?.parentId)
  }
  return false
}

function hasUnsettledDescendant(
  document: HierarchyWorklist,
  ancestorId: string
): boolean {
  return document.items.some(
    (item) =>
      isDescendant(document, item.id, ancestorId) && item.status === 'open'
  )
}

function nonEmpty(value: string, name: string): string {
  if (value.trim() === '')
    throw new HierarchyError('INVALID_DOCUMENT', `${name} must not be empty`)
  return value
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function invalidNesting(item: WorkItem): never {
  throw new HierarchyError(
    'INVALID_NESTING',
    `Invalid parent for ${item.kind} ${item.id}`
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return isErrno(error, 'ENOENT')
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return isErrno(error, 'EEXIST')
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
