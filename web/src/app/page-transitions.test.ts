import { describe, expect, it } from 'vitest'

import { tabRootIndex } from './nav'
import { settleDuration, shouldCommitSwipe } from './page-swipe'
import { pageDepth, transitionBetween } from './page-transitions'

describe('pageDepth', () => {
  it('puts tab roots at 0 and pushed screens deeper', () => {
    expect(pageDepth('/')).toBe(0)
    expect(pageDepth('/insights/')).toBe(0)
    expect(pageDepth('/activity/0193-abc')).toBe(1)
    expect(pageDepth('/budgets/cat-1')).toBe(1)
    expect(pageDepth('/subscriptions')).toBe(1)
    expect(pageDepth('/settings')).toBe(1)
    expect(pageDepth('/settings/accounts')).toBe(2)
    expect(pageDepth('/status')).toBe(2)
  })

  it('knows nothing about auth pages and unknown paths', () => {
    expect(pageDepth('/sign-in')).toBeNull()
    expect(pageDepth('/dev/kit')).toBeNull()
    expect(pageDepth('/nope/deeper/still')).toBeNull()
  })
})

describe('transitionBetween', () => {
  it('slides tab to tab in tab order', () => {
    expect(transitionBetween('/', '/activity')).toBe('forward')
    expect(transitionBetween('/', '/insights')).toBe('forward')
    expect(transitionBetween('/budgets', '/activity')).toBe('back')
  })

  it('treats a tab tap from a pushed screen as a tab switch', () => {
    expect(transitionBetween('/activity/1', '/budgets')).toBe('forward')
    expect(transitionBetween('/subscriptions', '/')).toBe('back')
  })

  it('pushes and pops within a tab', () => {
    expect(transitionBetween('/activity', '/activity/1')).toBe('push')
    expect(transitionBetween('/activity/1', '/activity')).toBe('pop')
    expect(transitionBetween('/', '/settings')).toBe('push')
    expect(transitionBetween('/settings/accounts', '/settings')).toBe('pop')
    expect(transitionBetween('/insights', '/subscriptions')).toBe('push')
    expect(transitionBetween('/', '/subscriptions')).toBe('push') // Home › Upcoming
  })

  it('fades between siblings and skips same-screen and auth navigations', () => {
    expect(transitionBetween('/settings/accounts', '/settings/categories')).toBe('fade')
    expect(transitionBetween('/activity', '/activity')).toBe('none')
    expect(transitionBetween('/', '/sign-in')).toBe('none')
  })
})

describe('tabRootIndex', () => {
  it('only matches a tab root exactly', () => {
    expect(tabRootIndex('/')).toBe(0)
    expect(tabRootIndex('/budgets')).toBe(2)
    expect(tabRootIndex('/budgets/cat-1')).toBe(-1)
    expect(tabRootIndex('/subscriptions')).toBe(-1)
    expect(tabRootIndex('/settings')).toBe(-1)
  })
})

describe('page swipe', () => {
  const W = 390

  it('switches past 40% of the width, either way', () => {
    expect(shouldCommitSwipe(-170, 0, W)).toBe(true)
    expect(shouldCommitSwipe(170, 0, W)).toBe(true)
    expect(shouldCommitSwipe(-140, 0, W)).toBe(false)
  })

  it('switches on a flick in the drag direction, not against it', () => {
    expect(shouldCommitSwipe(-60, -0.8, W)).toBe(true)
    expect(shouldCommitSwipe(-60, 0.8, W)).toBe(false) // flicked back
    expect(shouldCommitSwipe(-12, -2, W)).toBe(false) // too short to mean it
  })

  it('settles within 140–320ms, faster after a fast flick', () => {
    expect(settleDuration(W, 0, W)).toBe(300)
    expect(settleDuration(200, 2, W)).toBe(140)
    expect(settleDuration(20, 0, W)).toBe(140)
  })
})
