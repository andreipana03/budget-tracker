import { describe, expect, it } from 'vitest'

import {
  biggestDayBody,
  biggestDayTitle,
  changeBody,
  changeTitle,
  chartBars,
  chartDescription,
  headlineSentence,
  renewsWhen,
  subscriptionsBody,
  subscriptionsTitle,
  supportingLine,
  type Insights,
  type InsightsBar,
} from './insights-text'

const RO = { region: 'RO' }
const cat = (name: string) => ({
  id: name,
  kind: 'expense' as const,
  name,
  color: 'orange' as const,
  icon: 'fork-knife',
  isFixed: false,
})

const months: InsightsBar[] = [
  ['2026-06-01', 181200],
  ['2026-07-01', 205000],
  ['2026-08-01', 167000],
  ['2026-09-01', 231000],
  ['2026-10-01', 196000],
  ['2026-11-01', 123429],
].map(([startsOn, spentMinor], i) => ({
  startsOn: startsOn as string,
  endsBefore: '',
  spentMinor: spentMinor as number,
  isCurrent: i === 5,
  projectedMinor: i === 5 ? 197000 : null,
}))

function insights(over: Partial<Insights> = {}): Insights {
  return {
    period: 'six_months',
    homeCurrency: 'RON',
    startsOn: '2026-06-01',
    endsBefore: '2026-12-01',
    bars: months,
    averageMinor: 198700,
    headline: { currentMinor: 123429, previousMinor: 134200, changeRatio: -0.08, comparedTo: '2026-10-01' },
    byCategory: [],
    subscriptions: { perMonthMinor: 16287, activeCount: 6, isApproximate: true },
    ...over,
  }
}

describe('headlineSentence', () => {
  const h = { currentMinor: 123429, previousMinor: 134200, comparedTo: '2026-10-01' }
  it('states less than the previous month', () => {
    expect(headlineSentence('six_months', { ...h, changeRatio: -0.08 }, 'RON', RO)).toBe(
      'You’ve spent 8% less than at this point in October.',
    )
  })
  it('states more than last week', () => {
    expect(headlineSentence('week', { ...h, comparedTo: '2026-11-09', changeRatio: 0.12 }, 'RON', RO)).toBe(
      'You’ve spent 12% more than at this point last week.',
    )
  })
  it('month period compares with the previous month', () => {
    expect(headlineSentence('month', { ...h, changeRatio: 0.256 }, 'RON', RO)).toBe(
      'You’ve spent 26% more than at this point in October.',
    )
  })
  it('says about the same under 1%', () => {
    expect(headlineSentence('year', { ...h, changeRatio: 0.004 }, 'RON', RO)).toBe(
      'About the same as at this point in October.',
    )
    expect(headlineSentence('week', { ...h, changeRatio: -0.009 }, 'RON', RO)).toBe(
      'About the same as at this point last week.',
    )
  })
  it('never says 0% once past the threshold', () => {
    expect(headlineSentence('month', { ...h, changeRatio: 0.01 }, 'RON', RO)).toBe(
      'You’ve spent 1% more than at this point in October.',
    )
  })
  it('falls back to the amount without previous data', () => {
    expect(headlineSentence('month', { ...h, previousMinor: null, changeRatio: null }, 'RON', RO)).toBe(
      'You’ve spent 1.234 lei so far.',
    )
  })
})

describe('supportingLine', () => {
  it('6 months: projection and average month', () => {
    expect(supportingLine(insights(), '2026-11-18', RO)).toBe(
      'On pace for about 1.970 lei · your average month is 1.987 lei',
    )
  })
  it('6 months without projection: just the average', () => {
    const bars = months.map((b) => ({ ...b, projectedMinor: null }))
    expect(supportingLine(insights({ bars }), '2026-11-18', RO)).toBe('Your average month is 1.987 lei')
  })
  it('month: so far and the same point last month', () => {
    const i = insights({ period: 'month', startsOn: '2026-11-01', bars: [], averageMinor: null })
    expect(supportingLine(i, '2026-11-18', RO)).toBe('1.234 lei so far · 1.342 lei by 18 Oct')
  })
  it('week: offsets into the previous week', () => {
    const i = insights({
      period: 'week',
      startsOn: '2026-11-16',
      bars: [],
      headline: { currentMinor: 50000, previousMinor: 42000, changeRatio: 0.19, comparedTo: '2026-11-09' },
    })
    expect(supportingLine(i, '2026-11-18', RO)).toBe('500 lei so far · 420 lei by 11 Nov')
  })
  it('without previous data: only so far', () => {
    const i = insights({
      period: 'week',
      startsOn: '2026-11-16',
      headline: { currentMinor: 50000, previousMinor: null, changeRatio: null, comparedTo: '2026-11-09' },
    })
    expect(supportingLine(i, '2026-11-18', RO)).toBe('500 lei so far')
  })
})

describe('chartBars', () => {
  const day = (startsOn: string, isCurrent = false): InsightsBar => ({
    startsOn,
    endsBefore: '',
    spentMinor: 100,
    isCurrent,
    projectedMinor: null,
  })
  it('week: weekday names, Monday first', () => {
    const bars = ['2026-11-16', '2026-11-17', '2026-11-22'].map((d) => day(d))
    expect(chartBars('week', bars).map((b) => b.label)).toEqual(['Mon', 'Tue', 'Sun'])
    expect(chartBars('week', bars)[0].name).toBe('Monday, 16 November')
  })
  it('month: day numbers', () => {
    const bars = [day('2026-11-01'), day('2026-11-09'), day('2026-11-30', true)]
    const out = chartBars('month', bars)
    expect(out.map((b) => b.label)).toEqual(['1', '9', '30'])
    expect(out[2].current).toBe(true)
    expect(out[1].name).toBe('9 Nov')
  })
  it('six months: short month names, projection only on the current bar', () => {
    const out = chartBars('six_months', months)
    expect(out.map((b) => b.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'])
    expect(out[5]).toMatchObject({ current: true, projectedMinor: 197000, name: 'November 2026' })
    expect(out[0].projectedMinor).toBeNull()
  })
  it('year: letters when compact, short names otherwise', () => {
    const bars = [day('2025-12-01'), day('2026-01-01'), day('2026-11-01', true)]
    expect(chartBars('year', bars, { compact: true }).map((b) => b.label)).toEqual(['D', 'J', 'N'])
    expect(chartBars('year', bars).map((b) => b.label)).toEqual(['Dec', 'Jan', 'Nov'])
  })
  it('describes the range', () => {
    expect(chartDescription('six_months', months)).toBe('Monthly spending, June to November 2026.')
    expect(chartDescription('year', [day('2025-12-01'), day('2026-11-01')])).toBe(
      'Monthly spending, December 2025 to November 2026.',
    )
    expect(chartDescription('week', [day('2026-11-16')])).toBe('Daily spending, week of 16 Nov.')
  })
})

describe('highlights', () => {
  const change = {
    category: cat('Eating Out'),
    currentMinor: 32750,
    previousMinor: 24800,
    changeRatio: 0.32,
    comparedTo: '2026-10-01',
    spark: [],
  }
  it('biggest change', () => {
    expect(changeTitle('six_months', change)).toBe('Up 32% from October')
    expect(changeTitle('week', { ...change, changeRatio: -0.12 })).toBe('Down 12% from last week')
    expect(changeBody('six_months', change, 'RON', RO)).toBe(
      '327,50 lei so far, against 248 lei by this point last month.',
    )
    expect(changeBody('week', change, 'RON', RO)).toBe('327,50 lei so far, against 248 lei by this point last week.')
  })
  it('biggest day', () => {
    const d = { date: '2026-11-13', spentMinor: 21460, topCategories: [cat('Shopping'), cat('Eating Out')] }
    expect(biggestDayTitle(d, '2026-11-18')).toBe('Friday, 13 November')
    expect(biggestDayTitle({ ...d, date: '2025-12-05' }, '2026-11-18')).toBe('Friday, 5 December 2025')
    expect(biggestDayBody(d, 'RON', RO)).toBe('214,60 lei, mostly Shopping and Eating Out.')
    expect(biggestDayBody({ ...d, topCategories: [cat('Eating Out')] }, 'RON', RO)).toBe(
      '214,60 lei, mostly Eating Out.',
    )
  })
  it('subscriptions', () => {
    const s = { perMonthMinor: 16287, activeCount: 6, isApproximate: true }
    expect(subscriptionsTitle(s, 'RON', RO)).toBe('≈ 162,87 lei a month')
    expect(subscriptionsTitle({ ...s, isApproximate: false }, 'RON', RO)).toBe('162,87 lei a month')
    expect(subscriptionsBody(s, '2026-11-18')).toBe('6 active.')
    const next = { title: 'Netflix', kind: 'expense', nextDueOn: '2026-11-21' } as never
    expect(subscriptionsBody({ ...s, next }, '2026-11-18')).toBe('6 active · Netflix renews on Saturday.')
  })
  it('renewal wording', () => {
    expect(renewsWhen('2026-11-18', '2026-11-18')).toBe('today')
    expect(renewsWhen('2026-11-19', '2026-11-18')).toBe('tomorrow')
    expect(renewsWhen('2026-11-24', '2026-11-18')).toBe('on Tuesday')
    expect(renewsWhen('2026-12-02', '2026-11-18')).toBe('on 2 Dec')
  })
})
