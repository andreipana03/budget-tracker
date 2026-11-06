import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  Button,
  CATEGORY_ICON_CHOICES,
  CategoryTile,
  ConfirmDialog,
  List,
  ResponsiveSheet,
  SectionFooter,
  Segmented,
  SwitchRow,
  TextFieldRow,
  useToast,
} from '@/components/ui'
import { errorMessage, formErrors } from '@/features/auth/field-errors'
import { ApiError } from '@/lib/api/errors'
import { queryKeys, type Category } from '@/lib/api/queries'
import { CATEGORY_COLORS, EXPENSE_CATEGORY_COLORS, tileVar, type CategoryColor } from '@/lib/categories'
import { cn } from '@/lib/utils'

import { ActionRow, Groups, ListError } from './parts'
import { useResetOnOpen } from './use-reset-on-open'
import { refetchLatest, useDeleteCategory, useSaveCategory } from './useSettings'

type Kind = 'expense' | 'income'

interface Draft {
  kind: Kind
  name: string
  color: CategoryColor
  icon: string
  isFixed: boolean
}

/** Income is green first; expenses never get green (income) — blue and red aren't in the palette at all. */
const INCOME_COLORS: readonly CategoryColor[] = ['green', ...CATEGORY_COLORS.filter((c) => c !== 'green')]

function colorsFor(kind: Kind) {
  return kind === 'income' ? INCOME_COLORS : EXPENSE_CATEGORY_COLORS
}

/** New categories start on the spare hues (teal, yellow), then any hue not in use (design § 4.1). */
function suggestedColor(kind: Kind, existing: Category[]): CategoryColor {
  if (kind === 'income') return 'green'
  const used = new Set(existing.filter((c) => c.kind === 'expense').map((c) => c.color))
  return (['teal', 'yellow', ...EXPENSE_CATEGORY_COLORS] as CategoryColor[]).find((c) => !used.has(c)) ?? 'teal'
}

function draftFrom(category: Category | null, kind: Kind, existing: Category[]): Draft {
  if (category) return { kind: category.kind, name: category.name, color: category.color, icon: category.icon, isFixed: category.isFixed }
  return { kind, name: '', color: suggestedColor(kind, existing), icon: kind === 'income' ? 'hand-coins' : 'tag', isFixed: false }
}

const COLOR_NAMES: Record<CategoryColor, string> = {
  mint: 'Mint',
  orange: 'Orange',
  indigo: 'Indigo',
  cyan: 'Cyan',
  purple: 'Purple',
  pink: 'Pink',
  brown: 'Brown',
  gray: 'Gray',
  teal: 'Teal',
  yellow: 'Yellow',
  green: 'Green',
}

const FIELDS = ['name', 'color', 'icon', 'isFixed'] as const
type Field = (typeof FIELDS)[number]

/** Add / edit a category: Name, Color, Icon, Fixed (expenses). Delete archives when it has history. */
export function CategorySheet({
  open,
  onOpenChange,
  category,
  initialKind,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: Category | null
  initialKind: Kind
  existing: Category[]
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const save = useSaveCategory()
  const remove = useDeleteCategory()
  const [base, setBase] = useState<Category | null>(category)
  const [draft, setDraft] = useState<Draft>(() => draftFrom(category, initialKind, existing))
  const [initial, setInitial] = useState<Draft>(draft)
  const [errors, setErrors] = useState<Partial<Record<Field, string>> & { form?: string }>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newId, setNewId] = useState(() => crypto.randomUUID())

  useResetOnOpen(open, () => {
    const d = draftFrom(category, initialKind, existing)
    setBase(category)
    setDraft(d)
    setInitial(d)
    setErrors({})
    setNewId(crypto.randomUUID())
  })

  const editing = base !== null
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft)
  const busy = save.isPending || remove.isPending
  const canSave = draft.name.trim().length > 0 && (!editing || dirty) && !busy

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => {
      const next = { ...d, [key]: value }
      // Switching kind on a new category: pick that kind's default look.
      if (key === 'kind' && !editing) {
        const fresh = draftFrom(null, value as Kind, existing)
        return { ...fresh, name: d.name }
      }
      return next
    })
    setErrors((e) => ({ ...e, form: undefined, [key]: undefined }))
  }

  const submit = () => {
    if (!canSave) return
    const fields = { name: draft.name.trim(), color: draft.color, icon: draft.icon, isFixed: draft.kind === 'expense' && draft.isFixed }
    const input = base
      ? { id: base.id, update: { ...fields, sortOrder: base.sortOrder, archived: base.archived, rowVersion: base.rowVersion } }
      : { id: newId, create: { ...fields, kind: draft.kind } }
    save.mutate(input, {
      onSuccess: () => {
        onOpenChange(false)
        toast.show({ title: base ? 'Category saved' : 'Category added' })
      },
      onError: async (e) => {
        if (e instanceof ApiError && e.code === 'version_conflict' && base) {
          const latest = await refetchLatest<Category>(queryClient, queryKeys.categories, base.id, (d) => d as Category[] | undefined)
          if (latest) {
            const d = draftFrom(latest, latest.kind, existing)
            setBase(latest)
            setDraft(d)
            setInitial(d)
          }
          setErrors({ form: 'This category was changed on another device. Here’s the latest version: make your changes again.' })
          return
        }
        const mapped = formErrors(e, FIELDS)
        setErrors({ ...mapped.fields, form: mapped.form })
      },
    })
  }

  const doDelete = () => {
    if (!base) return
    setConfirmDelete(false)
    remove.mutate(base.id, {
      onSuccess: (result) => {
        onOpenChange(false)
        toast.show({ title: result.outcome === 'archived' ? 'Category archived (it has history)' : 'Category deleted' })
      },
      onError: (e) => setErrors({ form: errorMessage(e) }),
    })
  }

  const unarchive = () => {
    if (!base) return
    save.mutate(
      {
        id: base.id,
        update: {
          name: base.name,
          color: base.color,
          icon: base.icon,
          isFixed: base.isFixed,
          sortOrder: base.sortOrder,
          archived: false,
          rowVersion: base.rowVersion,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast.show({ title: 'Category restored' })
        },
        onError: (e) => setErrors({ form: errorMessage(e) }),
      },
    )
  }

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? 'Edit Category' : draft.kind === 'income' ? 'New Income Category' : 'New Category'}
        confirmLabel={editing ? 'Save Changes' : 'Add Category'}
        confirmVerb={editing ? 'save' : 'add'}
        onConfirm={submit}
        confirmDisabled={!canSave}
        isDirty={dirty}
        discardTitle={editing ? 'Discard your changes?' : 'Discard this category?'}
        footerLeading={
          editing && !base?.archived ? (
            <Button variant="destructive" onClick={() => setConfirmDelete(true)} className="lg:rounded-[8px] lg:px-4">
              Delete Category
            </Button>
          ) : undefined
        }
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Groups>
            {!editing && (
              <Segmented
                aria-label="Type"
                value={draft.kind}
                onChange={(k) => set('kind', k)}
                options={[
                  { value: 'expense', label: 'Expense' },
                  { value: 'income', label: 'Income' },
                ]}
              />
            )}

            <div className="flex flex-col items-center gap-2 pt-1" aria-hidden>
              <CategoryTile color={draft.color} icon={draft.icon} size={52} />
              <span className="max-w-full truncate text-headline">{draft.name.trim() || 'Category'}</span>
            </div>

            <div>
              <List>
                <TextFieldRow
                  label="Name"
                  placeholder={draft.kind === 'income' ? 'Scholarship' : 'Coffee'}
                  maxLength={40}
                  enterKeyHint="done"
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                  aria-invalid={errors.name ? true : undefined}
                />
              </List>
              {errors.name && <ListError>{errors.name}</ListError>}
            </div>

            <div>
              <List className="p-3 lg:p-3.5">
                <div
                  role="radiogroup"
                  aria-label="Color"
                  className={cn(
                    'grid justify-items-center gap-y-3 lg:flex lg:flex-wrap lg:justify-center lg:gap-2.5',
                    colorsFor(draft.kind).length % 5 === 0 ? 'grid-cols-5' : 'grid-cols-6',
                  )}
                >
                  {colorsFor(draft.kind).map((c) => {
                    const selected = draft.color === c
                    return (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={COLOR_NAMES[c]}
                        title={COLOR_NAMES[c]}
                        onClick={() => set('color', c)}
                        className={cn(
                          'pressable size-9 rounded-full lg:size-7',
                          selected && 'shadow-[0_0_0_2px_var(--sheet-surface),0_0_0_4px_var(--tint)]',
                        )}
                        style={{ background: tileVar(c) }}
                      />
                    )
                  })}
                </div>
              </List>
              {draft.kind === 'expense' && (
                <SectionFooter>Green is kept for income, so it’s not offered here.</SectionFooter>
              )}
            </div>

            <List className="p-2">
              <div role="radiogroup" aria-label="Icon" className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-1">
                {CATEGORY_ICON_CHOICES.map((name) => {
                  const selected = draft.icon === name
                  return (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={name.replace(/-/g, ' ')}
                      title={name.replace(/-/g, ' ')}
                      onClick={() => set('icon', name)}
                      className={cn(
                        'grid h-12 place-items-center rounded-[12px] hover:bg-fill-4',
                        selected && 'bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)] hover:bg-tint-soft',
                      )}
                    >
                      <CategoryTile color={selected ? draft.color : 'gray'} icon={name} />
                    </button>
                  )
                })}
              </div>
            </List>

            {draft.kind === 'expense' && (
              <div>
                <List>
                  <SwitchRow label="Fixed" checked={draft.isFixed} onCheckedChange={(v) => set('isFixed', v)} />
                </List>
                <SectionFooter>
                  For costs like rent or a phone plan: counted in full from the first day of the month, so they don’t change
                  your daily amount.
                </SectionFooter>
              </div>
            )}

            {errors.form && <ListError>{errors.form}</ListError>}

            {editing && base?.archived && (
              <List>
                <ActionRow onClick={unarchive} disabled={busy}>
                  Unarchive Category
                </ActionRow>
              </List>
            )}
            {editing && !base?.archived && (
              <List className="lg:hidden">
                <ActionRow destructive onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Delete Category
                </ActionRow>
              </List>
            )}
          </Groups>
          <button type="submit" hidden />
        </form>
      </ResponsiveSheet>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${base?.name ?? ''}”?`}
        message="If it has transactions, it’s archived instead so your history stays."
        confirmLabel="Delete Category"
        destructive
        onConfirm={doDelete}
      />
    </>
  )
}
