// PLACEHOLDER — W-core replaces this file.
import { PlaceholderNote } from '@/app/Placeholder'
import { Screen } from '@/app/Screen'
import { GlassButton } from '@/components/ui/GlassButton'
import { formatEyebrow, formatMonthName, localToday } from '@/lib/format'

export function HomePage() {
  const today = localToday()
  return (
    <Screen
      title={formatMonthName(today)}
      eyebrow={formatEyebrow(today)}
      context={today.slice(0, 4)}
      topBarActions={<GlassButton icon="user-circle" label="Profile and Settings" to="/settings" />}
    >
      <PlaceholderNote>Home will show what’s left to spend and your pace.</PlaceholderNote>
    </Screen>
  )
}
