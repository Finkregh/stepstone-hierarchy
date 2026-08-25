import { spawn } from 'node:child_process'

export type RootGoalState = 'open' | 'retired' | 'missing'

export interface RootGoalResolution {
  id: string
  state: RootGoalState
}

/** Read-only semantic boundary for Stepstone Project Goals. */
export interface RootGoalReader {
  resolveGoal(id: string): Promise<RootGoalResolution>
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    cwd: string
  ): Promise<CommandResult>
}

export class RootGoalReaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RootGoalReaderError'
  }
}

/**
 * Reads one root at a time through Stepstone's documented CLI JSON boundary.
 * It never invokes a Stepstone mutation command or reads its worklist directly.
 */
export class StepstoneCliRootGoalReader implements RootGoalReader {
  constructor(
    private readonly cwd: string,
    private readonly runner: CommandRunner = new SpawnCommandRunner(),
    private readonly command = 'stepstone'
  ) {}

  async resolveGoal(id: string): Promise<RootGoalResolution> {
    let result: CommandResult
    try {
      result = await this.runner.run(
        this.command,
        ['project', 'show', id, '--json', '--cwd', this.cwd],
        this.cwd
      )
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw unavailable(
          'Stepstone CLI was not found on PATH. Ensure "stepstone" is available in the environment that launches Pi, then restart Pi.'
        )
      }
      throw unavailable(`Unable to run the Stepstone CLI: ${messageOf(error)}`)
    }

    if (result.exitCode === 0) return parseShowSuccess(result.stdout, id)
    if (result.exitCode === 1) return parseNotFound(result.stderr, id)
    throw unavailable(`Stepstone CLI failed with exit code ${result.exitCode}`)
  }
}

export class SpawnCommandRunner implements CommandRunner {
  run(
    command: string,
    args: readonly string[],
    cwd: string
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, shell: false })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.once('error', reject)
      child.once('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr })
      })
    })
  }
}

function parseShowSuccess(
  output: string,
  requestedId: string
): RootGoalResolution {
  const envelope = parseEnvelope(output)
  if (
    envelope.ok !== true ||
    envelope.scope !== 'project' ||
    envelope.action !== 'show' ||
    !isRecord(envelope.result) ||
    !isRecord(envelope.result.goal) ||
    typeof envelope.result.goal.id !== 'string' ||
    typeof envelope.result.goal.status !== 'string' ||
    !hasCliVersion(envelope)
  ) {
    throw unavailable(
      'Stepstone CLI returned an unsupported project show response'
    )
  }
  if (envelope.result.goal.id !== requestedId) {
    throw unavailable(
      'Stepstone CLI resolved the requested root to a different ID'
    )
  }

  switch (envelope.result.goal.status) {
    case 'open':
      return { id: requestedId, state: 'open' }
    case 'done':
    case 'archived':
      return { id: requestedId, state: 'retired' }
    default:
      throw unavailable(
        `Stepstone CLI returned unknown root status ${envelope.result.goal.status}`
      )
  }
}

function parseNotFound(
  output: string,
  requestedId: string
): RootGoalResolution {
  const envelope = parseEnvelope(output)
  if (
    envelope.ok !== false ||
    envelope.scope !== 'project' ||
    envelope.action !== 'show' ||
    !isRecord(envelope.error) ||
    envelope.error.code !== 'NOT_FOUND' ||
    !hasCliVersion(envelope)
  ) {
    throw unavailable('Stepstone CLI failed without a valid not-found response')
  }
  return { id: requestedId, state: 'missing' }
}

function parseEnvelope(output: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(output)
    if (!isRecord(parsed)) throw new Error('JSON response was not an object')
    return parsed
  } catch (error) {
    throw unavailable(
      `Stepstone CLI returned invalid JSON: ${messageOf(error)}`
    )
  }
}

function hasCliVersion(envelope: Record<string, unknown>): boolean {
  return isRecord(envelope.meta) && typeof envelope.meta.cliVersion === 'string'
}

function unavailable(message: string): RootGoalReaderError {
  return new RootGoalReaderError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
