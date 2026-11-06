/**
 * Budget Tracker component kit (design § 6). Import from '@/components/ui'.
 * Every component mirrors DesignAssets/mockups/app/app.css; see each file's doc comment.
 * A live catalogue of every component and variant: /dev/kit (dev server only).
 */
export { BarChart, ChartLegend, type BarChartBar, type BarChartProps } from './BarChart'
export { BudgetRow, type BudgetRowProps, type BudgetStatus } from './BudgetRow'
export { Button, ButtonLink, type ButtonVariant } from './Button'
export { HighlightCard, HorizontalBar, SparkBars, StatCards, type StatItem } from './Cards'
export { CategoryTile, type TileSize } from './CategoryTile'
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog'
export { DetailRow, SelectRow, Switch, SwitchRow, TextFieldRow, type SelectOption } from './FormRows'
export { GlassButton } from './GlassButton'
export { Icon, type IconProps } from './Icon'
export {
  CATEGORY_ICON_CHOICES,
  DEFAULT_CATEGORY_ICONS,
  iconWeight,
  isIconName,
  type IconName,
  type IconVariant,
} from './icons'
export { Card, List, Row, RowAccessory, type RowProps } from './List'
export { rowClasses } from './row-classes'
export { Menu, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, Popover, PopoverPopup } from './Menu'
export { HeroAmount, Money, type HeroAmountProps, type MoneyProps } from './Money'
export { MiniPace, PaceBar, PaceLegend, type PaceBarProps, type PaceSegmentInput } from './PaceBar'
export { Pill } from './Pill'
export { ResponsiveSheet, type ResponsiveSheetProps } from './ResponsiveSheet'
export { SearchField } from './SearchField'
export { Section, SectionFooter, SectionHeader, type SectionAction } from './Section'
export { Segmented, type SegmentedOption } from './Segmented'
export { EmptyState, InlineError, SkeletonBlock, SkeletonRows } from './States'
export { ToastProvider } from './Toast'
export { useToast, type ToastOptions } from './use-toast'
