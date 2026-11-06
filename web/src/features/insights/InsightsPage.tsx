// PLACEHOLDER — W-plan replaces this file.
import { useState } from 'react'

import { PlaceholderNote } from '@/app/Placeholder'
import { Screen } from '@/app/Screen'
import { GlassButton } from '@/components/ui/GlassButton'
import { Segmented } from '@/components/ui/Segmented'

const PERIODS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'six_months', label: '6 Months' },
  { value: 'year', label: 'Year' },
] as const

export function InsightsPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['value']>('six_months')
  return (
    <Screen
      title="Insights"
      topBarActions={<GlassButton icon="export" label="Share Insights" />}
      toolbarControls={<Segmented variant="toolbar" aria-label="Period" options={PERIODS} value={period} onChange={setPeriod} />}
    >
      <div className="flex flex-col gap-4">
        <Segmented aria-label="Period" options={PERIODS} value={period} onChange={setPeriod} className="lg:hidden" />
        <PlaceholderNote>Insights will show what changed in your spending.</PlaceholderNote>
      </div>
    </Screen>
  )
}
