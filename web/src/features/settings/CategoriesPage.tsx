import { useState } from 'react'

import { Screen, ToolbarButton, ToolbarGroup } from '@/app/Screen'
import { CategoryTile, GlassButton, InlineError, List, Pill, Row, Section, SkeletonRows } from '@/components/ui'
import { useCategories, type Category } from '@/lib/api/queries'

import { CategorySheet } from './CategorySheet'
import { SETTINGS_COLUMN } from './settings-logic'

/** Categories (/settings/categories): Expenses and Income, archived ones apart; add/edit in a sheet. */
export function CategoriesPage() {
  const categories = useCategories({ includeArchived: true })
  const [sheet, setSheet] = useState<{ open: boolean; category: Category | null; kind: 'expense' | 'income' }>({
    open: false,
    category: null,
    kind: 'expense',
  })

  const add = (kind: 'expense' | 'income' = 'expense') => setSheet({ open: true, category: null, kind })
  const all = categories.data ?? []
  const active = all.filter((c) => !c.archived)
  const expenses = active.filter((c) => c.kind === 'expense')
  const income = active.filter((c) => c.kind === 'income')
  const archived = all.filter((c) => c.archived)

  const row = (c: Category) => (
    <Row
      key={c.id}
      leading={<CategoryTile color={c.color} icon={c.icon} />}
      title={c.name}
      trailing={c.isFixed ? <Pill>Fixed</Pill> : c.archived ? (c.kind === 'income' ? 'Income' : 'Expense') : undefined}
      accessory="disclosure"
      onClick={() => setSheet({ open: true, category: c, kind: c.kind })}
      aria-label={`${c.name}${c.isFixed ? ', fixed' : ''}. Edit Category`}
    />
  )

  return (
    <Screen
      title="Categories"
      back={{ to: '/settings', label: 'Back to Settings' }}
      hideToolbarActions
      topBarActions={<GlassButton text="Add Category" onClick={() => add()} />}
      toolbarControls={
        <ToolbarGroup>
          <ToolbarButton icon="plus" onClick={() => add()}>
            Add Category
          </ToolbarButton>
        </ToolbarGroup>
      }
    >
      <div className={SETTINGS_COLUMN}>
        {categories.isError ? (
          <InlineError what="your categories" onRetry={() => void categories.refetch()} />
        ) : categories.isPending ? (
          <>
            <SkeletonRows count={6} />
            <SkeletonRows count={3} />
          </>
        ) : (
          <>
            <Section
              title="Expenses"
              action={{ label: 'Add', onClick: () => add('expense') }}
              footer="Fixed categories, like rent, are counted in full from the first day and don’t change your daily amount."
            >
              <List>{expenses.map(row)}</List>
            </Section>
            <Section title="Income" action={{ label: 'Add', onClick: () => add('income') }}>
              {income.length > 0 ? (
                <List>{income.map(row)}</List>
              ) : (
                <p className="m-0 px-4 text-subhead text-label-2">No income categories yet.</p>
              )}
            </Section>
            {archived.length > 0 && (
              <Section title="Archived" footer="Archived categories keep their history but aren’t offered for new transactions.">
                <List>{archived.map(row)}</List>
              </Section>
            )}
          </>
        )}
      </div>
      <CategorySheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        category={sheet.category}
        initialKind={sheet.kind}
        existing={active}
      />
    </Screen>
  )
}
