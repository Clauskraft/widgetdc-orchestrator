/**
 * Tests for utils.ts — the `cn()` utility function for Tailwind class merging.
 */
import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn() utility', () => {
  it('merges multiple class strings', () => {
    expect(cn('px-2 py-1', 'bg-blue-500', 'text-white')).toBe('px-2 py-1 bg-blue-500 text-white')
  })

  it('resolves Tailwind conflicts (p-2 vs px-2)', () => {
    // twMerge should resolve conflicting padding classes
    const result = cn('p-2', 'px-4')
    expect(result).toContain('px-4')
  })

  it('handles conditional classes with object syntax', () => {
    expect(cn('base', { conditional: true, excluded: false })).toBe('base conditional')
  })

  it('handles conditional classes with array syntax', () => {
    const includeFirst = true
    const includeSecond = false
    expect(cn('base', includeFirst && 'included', includeSecond && 'excluded')).toBe('base included')
  })

  it('handles null and undefined inputs gracefully', () => {
    expect(cn('base', null, undefined)).toBe('base')
  })

  it('handles empty input', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
  })

  it('handles nested arrays', () => {
    expect(cn('base', ['nested', 'array'])).toBe('base nested array')
  })

  it('overrides conflicting text color classes', () => {
    const result = cn('text-white', 'text-black')
    expect(result).toBe('text-black')
  })

  it('merges bg classes with conflict resolution', () => {
    const result = cn('bg-red-500', 'bg-blue-500')
    expect(result).toBe('bg-blue-500')
  })
})
