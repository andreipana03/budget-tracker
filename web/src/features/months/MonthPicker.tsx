// PLACEHOLDER — agent W-core implements this (popover on desktop, sheet on compact,
// months from GET /months grouped by year with what was spent). Keep the props.

export type MonthPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 'YYYY-MM' currently shown (undefined = current month). */
  selected: string | undefined
  /** Called with 'YYYY-MM'; the picker closes itself. */
  onSelect: (month: string) => void
}

export function MonthPicker(_props: MonthPickerProps) {
  return null
}
