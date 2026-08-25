import { describe, expect, it } from 'vitest'
import { HIERARCHY_VERSION } from './index.js'

describe('public API', () => {
  it('exports the hierarchy model', () => {
    expect(HIERARCHY_VERSION).toBe(1)
  })
})
