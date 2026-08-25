import { describe, expect, it, vi } from 'vitest'
import hierarchyExtension from './pi-extension.js'

describe('hierarchyExtension', () => {
  it('registers the namespaced model tool and read-only commands', () => {
    const registerTool = vi.fn()
    const registerCommand = vi.fn()
    hierarchyExtension({ registerTool, registerCommand } as never)

    expect(registerTool).toHaveBeenCalledTimes(1)
    expect(registerTool.mock.calls[0]?.[0]).toMatchObject({
      name: 'stepstone_hierarchy',
    })
    expect(registerCommand).toHaveBeenCalledWith(
      'hierarchy',
      expect.objectContaining({ description: expect.any(String) })
    )
    expect(registerCommand).toHaveBeenCalledWith(
      'hierarchy-doctor',
      expect.objectContaining({ description: expect.any(String) })
    )
  })
})
