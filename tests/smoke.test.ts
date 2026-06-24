import { describe, it, expect } from 'vitest'

// Sanity check that the Vitest runner is wired up. Real coverage starts at
// milestone 2 (tenant isolation), which is the gate before any features.
describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
