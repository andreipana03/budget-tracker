import { describe, expect, it } from 'vitest'

import { dueSoonText, intervalLabel, repeatText } from './subscription-text'

describe('repeatText', () => {
  it('uses the single word for every one', () => {
    expect(repeatText('monthly')).toBe('Monthly')
    expect(repeatText('monthly', 1)).toBe('Monthly')
    expect(repeatText('weekly', 1)).toBe('Weekly')
    expect(repeatText('yearly', 1)).toBe('Yearly')
  })
  it('says "Every N units" otherwise', () => {
    expect(repeatText('weekly', 2)).toBe('Every 2 weeks')
    expect(repeatText('monthly', 3)).toBe('Every 3 months')
    expect(repeatText('yearly', 2)).toBe('Every 2 years')
  })
  it('labels interval choices', () => {
    expect(intervalLabel('weekly', 1)).toBe('1 week')
    expect(intervalLabel('monthly', 6)).toBe('6 months')
  })
})

describe('dueSoonText', () => {
  const today = '2026-11-18'
  it('names what is due this week', () => {
    expect(
      dueSoonText(
        [
          { title: 'Netflix', nextDueOn: '2026-11-21' },
          { title: 'Digi Mobile', nextDueOn: '2026-11-25' },
        ],
        today,
      ),
    ).toBe('Netflix on Saturday · Digi Mobile on Wednesday')
  })
  it('handles today, tomorrow, overflow and nothing', () => {
    expect(
      dueSoonText(
        [
          { title: 'A', nextDueOn: today },
          { title: 'B', nextDueOn: '2026-11-19' },
          { title: 'C', nextDueOn: '2026-11-20' },
        ],
        today,
      ),
    ).toBe('A today · B tomorrow · 1 more')
    expect(dueSoonText([], today)).toBe('Nothing due this week')
  })
})
