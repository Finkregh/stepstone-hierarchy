import { expect, it, describe } from 'vitest'
import { hello } from './index.js'

describe('hello', () => {
  it('prints Hello world', () => {
    expect(hello('world')).toBe('Hello world!')
  })
})
