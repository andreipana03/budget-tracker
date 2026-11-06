import { describe, expect, it } from 'vitest'

import { cn } from './utils'

describe('cn', () => {
  it('keeps a text style next to a text color', () => {
    expect(cn('text-body text-label-2')).toBe('text-body text-label-2')
    expect(cn('text-footnote', 'text-tint-text')).toBe('text-footnote text-tint-text')
    expect(cn('text-caption-2 text-on-tint')).toBe('text-caption-2 text-on-tint')
  })

  it('lets a later text style win over an earlier one', () => {
    expect(cn('text-body text-label', 'text-subhead')).toBe('text-label text-subhead')
    expect(cn('text-large-title', 'text-title-1')).toBe('text-title-1')
  })

  it('lets a later text color win over an earlier one', () => {
    expect(cn('text-body text-label', 'text-negative')).toBe('text-body text-negative')
    expect(cn('text-label-2', 'text-positive')).toBe('text-positive')
  })

  it('treats rounded-tile as a radius', () => {
    expect(cn('rounded-lg', 'rounded-tile')).toBe('rounded-tile')
    expect(cn('rounded-tile', 'rounded-full')).toBe('rounded-full')
  })

  it('merges background colors and font families', () => {
    expect(cn('bg-surface', 'bg-fill-4')).toBe('bg-fill-4')
    expect(cn('font-sans', 'font-rounded font-bold')).toBe('font-rounded font-bold')
    expect(cn('shadow-card', 'shadow-glass')).toBe('shadow-glass')
  })

  it('joins conditionals like clsx', () => {
    const off = Math.random() > 2
    expect(cn('a', off && 'b', { c: true, d: false }, undefined)).toBe('a c')
  })
})
