import {
  HierarchyError,
  type CreateItemInput,
  type HierarchyStore,
  type MoveItemInput,
  type UpdateItemInput,
  type WorkItem,
  type WorkItemKind,
  type WorkItemStatus,
} from './hierarchy.js'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export interface WorkItemSummary {
  id: string
  kind: WorkItemKind
  rootGoalId: string
  parentId: string
  title: string
  status: WorkItemStatus
  updatedAt: string
}

export interface ListHierarchyCommand {
  rootGoalId?: string
  status?: WorkItemStatus
  cursor?: string
  limit?: number
}

export interface ListHierarchyResponse {
  revision: number
  items: WorkItemSummary[]
  nextCursor?: string
}

export interface GetHierarchyCommand {
  id: string
}

export interface GetHierarchyResponse {
  revision: number
  item: WorkItem
}

export interface GetSubtreeCommand {
  id: string
  maxDepth?: 0 | 1
  limit?: number
}

export interface WorkItemTree {
  item: WorkItem
  children: WorkItemTree[]
}

export interface GetSubtreeResponse {
  revision: number
  tree: WorkItemTree
  truncated: boolean
}

export interface RevisionedCommand {
  expectedRevision: number
}

export interface CreateHierarchyCommand extends RevisionedCommand {
  input: CreateItemInput
}

export interface UpdateHierarchyCommand extends RevisionedCommand {
  id: string
  input: UpdateItemInput
}

export interface MoveHierarchyCommand extends RevisionedCommand {
  id: string
  input: MoveItemInput
}

export type LifecycleConfirmation =
  { approved: false } | { approved: true; action: 'complete' | 'archive' }

export interface SetStatusCommand extends RevisionedCommand {
  id: string
  status: WorkItemStatus
  confirmation?: LifecycleConfirmation
}

export interface MutationResponse {
  item: WorkItem
  revision: number
}

export interface ConfirmationRequiredResponse {
  kind: 'confirmation-required'
  action: 'complete' | 'archive'
  item: WorkItemSummary
  expectedRevision: number
}

export type StatusResponse = MutationResponse | ConfirmationRequiredResponse

/**
 * The only command façade for companion callers. It bounds read payloads and
 * enforces explicit user approval before terminal lifecycle changes.
 */
export class HierarchyService {
  constructor(private readonly store: HierarchyStore) {}

  async list(
    command: ListHierarchyCommand = {}
  ): Promise<ListHierarchyResponse> {
    const limit = validLimit(command.limit)
    const document = await this.store.read()
    const offset = decodeCursor(command.cursor, document.revision)
    const items = document.items.filter(
      (item) =>
        (command.rootGoalId === undefined ||
          item.rootGoalId === command.rootGoalId) &&
        (command.status === undefined || item.status === command.status)
    )
    const page = items.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    const response: ListHierarchyResponse = {
      revision: document.revision,
      items: page.map(summary),
    }
    if (nextOffset < items.length) {
      response.nextCursor = encodeCursor(document.revision, nextOffset)
    }
    return response
  }

  async get(command: GetHierarchyCommand): Promise<GetHierarchyResponse> {
    const document = await this.store.read()
    return {
      revision: document.revision,
      item: requiredItem(document.items, command.id),
    }
  }

  async subtree(command: GetSubtreeCommand): Promise<GetSubtreeResponse> {
    const limit = validLimit(command.limit)
    const maxDepth = command.maxDepth ?? 1
    const document = await this.store.read()
    const root = requiredItem(document.items, command.id)
    let count = 0
    let truncated = false

    const visit = (item: WorkItem, depth: number): WorkItemTree => {
      count += 1
      const children: WorkItemTree[] = []
      const directChildren = document.items.filter(
        (candidate) => candidate.parentId === item.id
      )
      if (depth === maxDepth) {
        if (directChildren.length > 0) truncated = true
        return { item, children }
      }
      for (const child of directChildren) {
        if (count >= limit) {
          truncated = true
          break
        }
        children.push(visit(child, depth + 1))
      }
      return { item, children }
    }

    return { revision: document.revision, tree: visit(root, 0), truncated }
  }

  async create(command: CreateHierarchyCommand): Promise<MutationResponse> {
    validRevision(command.expectedRevision)
    const item = await this.store.create(
      command.input,
      command.expectedRevision
    )
    return committed(item, command.expectedRevision)
  }

  async update(command: UpdateHierarchyCommand): Promise<MutationResponse> {
    validRevision(command.expectedRevision)
    const item = await this.store.update(
      command.id,
      command.input,
      command.expectedRevision
    )
    return committed(item, command.expectedRevision)
  }

  async move(command: MoveHierarchyCommand): Promise<MutationResponse> {
    validRevision(command.expectedRevision)
    const item = await this.store.move(
      command.id,
      command.input,
      command.expectedRevision
    )
    return committed(item, command.expectedRevision)
  }

  async setStatus(command: SetStatusCommand): Promise<StatusResponse> {
    validRevision(command.expectedRevision)
    if (!isStatus(command.status)) {
      throw new HierarchyError(
        'INVALID_DOCUMENT',
        `Invalid work item status ${String(command.status)}`
      )
    }
    if (command.status === 'done' || command.status === 'archived') {
      const action = command.status === 'done' ? 'complete' : 'archive'
      if (
        command.confirmation?.approved !== true ||
        command.confirmation.action !== action
      ) {
        const document = await this.store.read()
        if (document.revision !== command.expectedRevision) {
          throw new HierarchyError(
            'CONFLICT',
            `Expected revision ${command.expectedRevision}, found ${document.revision}`
          )
        }
        return {
          kind: 'confirmation-required',
          action,
          item: summary(requiredItem(document.items, command.id)),
          expectedRevision: command.expectedRevision,
        }
      }
    }
    const item = await this.store.setStatus(
      command.id,
      command.status,
      command.expectedRevision
    )
    return committed(item, command.expectedRevision)
  }
}

function committed(item: WorkItem, expectedRevision: number): MutationResponse {
  return { item, revision: expectedRevision + 1 }
}

function summary(item: WorkItem): WorkItemSummary {
  const { id, kind, rootGoalId, parentId, title, status, updatedAt } = item
  return { id, kind, rootGoalId, parentId, title, status, updatedAt }
}

function requiredItem(items: WorkItem[], id: string): WorkItem {
  const item = items.find((candidate) => candidate.id === id)
  if (item === undefined)
    throw new HierarchyError('NOT_FOUND', `Hierarchy item ${id} was not found`)
  return item
}

function validLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new HierarchyError(
      'INVALID_DOCUMENT',
      `limit must be an integer from 1 to ${MAX_LIMIT}`
    )
  }
  return limit
}

function validRevision(revision: number): void {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new HierarchyError(
      'INVALID_DOCUMENT',
      'expectedRevision must be a non-negative integer'
    )
  }
}

function encodeCursor(revision: number, offset: number): string {
  return Buffer.from(JSON.stringify({ revision, offset })).toString('base64url')
}

function decodeCursor(cursor: string | undefined, revision: number): number {
  if (cursor === undefined) return 0
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as Cursor
    if (
      !isCursor(decoded) ||
      decoded.revision !== revision ||
      decoded.offset < 0
    ) {
      throw new Error('invalid cursor')
    }
    return decoded.offset
  } catch {
    throw new HierarchyError(
      'CONFLICT',
      'Cursor does not match the current hierarchy revision'
    )
  }
}

interface Cursor {
  revision: number
  offset: number
}

function isCursor(value: Cursor): boolean {
  return Number.isInteger(value.revision) && Number.isInteger(value.offset)
}

function isStatus(value: unknown): value is WorkItemStatus {
  return value === 'open' || value === 'done' || value === 'archived'
}
