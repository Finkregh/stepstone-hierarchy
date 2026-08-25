import { describe, expect, it } from 'vitest'
import {
  RootGoalReaderError,
  StepstoneCliRootGoalReader,
  type CommandResult,
  type CommandRunner,
} from './root-goal.js'

const showEnvelope = (status: string) =>
  JSON.stringify({
    ok: true,
    scope: 'project',
    action: 'show',
    result: { goal: { id: 'goal-a', status } },
    meta: { cliVersion: '0.10.2' },
  })

const notFoundEnvelope = JSON.stringify({
  ok: false,
  scope: 'project',
  action: 'show',
  error: { code: 'NOT_FOUND', message: 'Not found', retryable: false },
  meta: { cliVersion: '0.10.2' },
})

function runner(result: CommandResult): CommandRunner {
  return { run: async () => result }
}

describe('StepstoneCliRootGoalReader', () => {
  it.each([
    ['open', 'open'],
    ['done', 'retired'],
    ['archived', 'retired'],
  ] as const)('normalizes a %s root as %s', async (status, state) => {
    const reader = new StepstoneCliRootGoalReader(
      '/project',
      runner({ exitCode: 0, stdout: showEnvelope(status), stderr: '' })
    )

    await expect(reader.resolveGoal('goal-a')).resolves.toEqual({
      id: 'goal-a',
      state,
    })
  })

  it('uses only the documented read-only show command and JSON transport', async () => {
    let invocation:
      { command: string; args: readonly string[]; cwd: string } | undefined
    const reader = new StepstoneCliRootGoalReader('/project', {
      run: async (command, args, cwd) => {
        invocation = { command, args, cwd }
        return { exitCode: 0, stdout: showEnvelope('open'), stderr: '' }
      },
    })

    await reader.resolveGoal('goal-a')
    expect(invocation).toEqual({
      command: 'stepstone',
      args: ['project', 'show', 'goal-a', '--json', '--cwd', '/project'],
      cwd: '/project',
    })
  })

  it('maps only a validated NOT_FOUND response to missing', async () => {
    const reader = new StepstoneCliRootGoalReader(
      '/project',
      runner({ exitCode: 1, stdout: '', stderr: notFoundEnvelope })
    )

    await expect(reader.resolveGoal('removed')).resolves.toEqual({
      id: 'removed',
      state: 'missing',
    })
  })

  it('explains how to fix a missing Stepstone executable', async () => {
    const reader = new StepstoneCliRootGoalReader('/project', {
      run: async () => {
        throw Object.assign(new Error('spawn stepstone ENOENT'), {
          code: 'ENOENT',
        })
      },
    })

    await expect(reader.resolveGoal('goal-a')).rejects.toThrow(
      'Stepstone CLI was not found on PATH'
    )
  })

  it('keeps contextual errors for other runner failures', async () => {
    const reader = new StepstoneCliRootGoalReader('/project', {
      run: async () => {
        throw new Error('permission denied')
      },
    })

    await expect(reader.resolveGoal('goal-a')).rejects.toThrow(
      'Unable to run the Stepstone CLI: permission denied'
    )
  })

  it.each([
    { exitCode: 0, stdout: 'not json', stderr: '' },
    { exitCode: 0, stdout: showEnvelope('unknown'), stderr: '' },
    { exitCode: 1, stdout: '', stderr: JSON.stringify({ ok: false }) },
    { exitCode: 4, stdout: '', stderr: '' },
  ])(
    'fails closed for unavailable or unsupported CLI results',
    async (result) => {
      const reader = new StepstoneCliRootGoalReader('/project', runner(result))
      await expect(reader.resolveGoal('goal-a')).rejects.toBeInstanceOf(
        RootGoalReaderError
      )
    }
  )
})
