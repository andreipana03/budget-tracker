// PLACEHOLDER — W-plan replaces this file.
import { PlaceholderNote } from '@/app/Placeholder'
import { Screen, ToolbarButton, ToolbarGroup } from '@/app/Screen'
import { GlassButton } from '@/components/ui/GlassButton'

export function BudgetsPage() {
  return (
    <Screen
      title="Budgets"
      topBarActions={<GlassButton text="Edit" />}
      toolbarControls={
        <ToolbarGroup>
          <ToolbarButton icon="pencil-simple">Edit Budgets</ToolbarButton>
        </ToolbarGroup>
      }
    >
      <PlaceholderNote>Budgets will show each limit and how you’re pacing.</PlaceholderNote>
    </Screen>
  )
}
