import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { routeTier, TIER_THRESHOLDS } from './tier-router.js'

describe('routeTier', () => {
  it('routes score 0.90 to l4', () => assert.equal(routeTier(0.90), 'l4'))
  it('routes score 0.85 to l4 (inclusive)', () => assert.equal(routeTier(0.85), 'l4'))
  it('routes score 0.84 to l3', () => assert.equal(routeTier(0.84), 'l3'))
  it('routes score 0.70 to l3 (inclusive)', () => assert.equal(routeTier(0.70), 'l3'))
  it('routes score 0.69 to l2', () => assert.equal(routeTier(0.69), 'l2'))
  it('routes undefined score to l2', () => assert.equal(routeTier(undefined), 'l2'))
  it('routes 0 to l2', () => assert.equal(routeTier(0), 'l2'))
})
