import { RowAccessory } from '@/components/ui/List'
import { rowClasses } from '@/components/ui/row-classes'
import { formatDay } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Date row: "Today" / "Yesterday" / "Mon 16 Nov"; the native date picker sits on top of it. */
export function DateRow({ value, today, onChange }: { value: string; today: string; onChange: (date: string) => void }) {
  const label = value ? formatDay(value, today || undefined) : 'Choose'
  return (
    <label className={cn(rowClasses({ hasLeading: false, interactive: true }), 'relative')}>
      <span className="flex-none text-body">Date</span>
      <span className="min-w-0 flex-1" />
      <span className="truncate text-body text-label-2">{label}</span>
      <RowAccessory kind="disclosure" />
      <input
        type="date"
        aria-label={`Date: ${label}`}
        value={value}
        required
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value)
        }}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.()
          } catch {
            // not allowed here (e.g. inside an iframe): the native control still opens on tap
          }
        }}
        className="absolute inset-0 h-full w-full cursor-default text-[16px] opacity-0"
      />
    </label>
  )
}
