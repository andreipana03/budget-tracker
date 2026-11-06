// PLACEHOLDER — W-auth replaces this file (it also owns /settings/* sub-routes).
import { PlaceholderNote } from '@/app/Placeholder'
import { Screen } from '@/app/Screen'

export function SettingsPage() {
  return (
    <Screen title="Settings" back={{ to: '/', label: 'Back to Home' }}>
      <PlaceholderNote>Settings are coming next.</PlaceholderNote>
    </Screen>
  )
}
