import { type HierarchyStore } from './hierarchy.js'
import { type RootGoalReader } from './root-goal.js'

export type DoctorSeverity = 'info' | 'ok' | 'warning' | 'error'
export type DoctorCode =
  | 'HIERARCHY_EMPTY'
  | 'HIERARCHY_OK'
  | 'HIERARCHY_UNREADABLE'
  | 'ROOTS_NONE'
  | 'ROOT_OPEN'
  | 'ROOT_RETIRED'
  | 'ROOT_MISSING'
  | 'ROOT_UNVERIFIABLE'

export interface DoctorFinding {
  severity: DoctorSeverity
  code: DoctorCode
  message: string
  rootGoalId?: string
}

export interface HierarchyDoctorReport {
  ok: boolean
  revision?: number
  itemCount?: number
  rootGoalCount?: number
  findings: DoctorFinding[]
}

/** Reads companion state and root anchors without writing either worklist. */
export async function runHierarchyDoctor(
  store: HierarchyStore,
  roots: RootGoalReader
): Promise<HierarchyDoctorReport> {
  let document: Awaited<ReturnType<HierarchyStore['read']>>
  try {
    document = await store.read()
  } catch (error) {
    return {
      ok: false,
      findings: [
        {
          severity: 'error',
          code: 'HIERARCHY_UNREADABLE',
          message: `Cannot safely read companion hierarchy: ${messageOf(error)}. No files were changed.`,
        },
      ],
    }
  }

  const findings: DoctorFinding[] = []
  if (document.items.length === 0) {
    findings.push({
      severity: 'info',
      code: 'HIERARCHY_EMPTY',
      message:
        'No companion hierarchy items exist; treating this as an empty worklist.',
    })
  } else {
    findings.push({
      severity: 'ok',
      code: 'HIERARCHY_OK',
      message: `Companion hierarchy is valid (revision ${document.revision}, ${document.items.length} items).`,
    })
  }

  const rootIds = [
    ...new Set(document.items.map((item) => item.rootGoalId)),
  ].sort((left, right) => left.localeCompare(right))
  if (rootIds.length === 0) {
    findings.push({
      severity: 'info',
      code: 'ROOTS_NONE',
      message: 'No Stepstone root goals are referenced by companion items.',
    })
  }
  for (const rootGoalId of rootIds) {
    try {
      const root = await roots.resolveGoal(rootGoalId)
      if (root.state === 'open') {
        findings.push({
          severity: 'ok',
          code: 'ROOT_OPEN',
          rootGoalId,
          message: `Stepstone root goal ${rootGoalId} is open.`,
        })
      } else if (root.state === 'retired') {
        findings.push({
          severity: 'warning',
          code: 'ROOT_RETIRED',
          rootGoalId,
          message: `Stepstone root goal ${rootGoalId} is retired; companion items need review.`,
        })
      } else {
        findings.push({
          severity: 'error',
          code: 'ROOT_MISSING',
          rootGoalId,
          message: `Stepstone root goal ${rootGoalId} was not found; companion items need review.`,
        })
      }
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'ROOT_UNVERIFIABLE',
        rootGoalId,
        message: `Cannot verify Stepstone root goal ${rootGoalId}: ${messageOf(error)}. No files were changed.`,
      })
    }
  }

  return {
    ok: findings.every(
      (finding) =>
        finding.severity !== 'warning' && finding.severity !== 'error'
    ),
    revision: document.revision,
    itemCount: document.items.length,
    rootGoalCount: rootIds.length,
    findings,
  }
}

export function formatDoctorReport(report: HierarchyDoctorReport): string {
  const lines = report.findings.map(
    (finding) => `${finding.code}: ${finding.message}`
  )
  lines.push('Read-only: no files were changed.')
  return lines.join('\n')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
