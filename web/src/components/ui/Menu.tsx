import { Menu as BaseMenu } from '@base-ui/react/menu'
import { Popover as BasePopover } from '@base-ui/react/popover'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Icon, type IconName } from './Icon'

/* Menus and popovers are functional-layer chrome: glass-strong (design § 4.5). */
const POPUP =
  'glass glass-strong rounded-sm p-1 text-label outline-none origin-(--transform-origin) ' +
  'transition-[scale,opacity] duration-(--dur-fast) ease-out data-starting-style:scale-95 data-starting-style:opacity-0 ' +
  'data-ending-style:scale-95 data-ending-style:opacity-0'

const ITEM =
  'flex w-full min-h-11 cursor-default items-center gap-2.5 rounded-[7px] px-3 text-body outline-none select-none ' +
  'data-highlighted:bg-fill-3 data-disabled:opacity-40 lg:min-h-7 lg:px-2.5'

/**
 * Styled Base UI Menu parts. Keyboard, focus and aria come from Base UI.
 *
 *   <Menu.Root>
 *     <Menu.Trigger className="…">All Accounts <Icon name="caret-up-down" /></Menu.Trigger>
 *     <MenuPopup>
 *       <MenuRadioGroup value={v} onValueChange={setV}>
 *         <MenuRadioItem value="all">All Accounts</MenuRadioItem>
 *       </MenuRadioGroup>
 *       <MenuSeparator />
 *       <MenuItem icon="trash" destructive onClick={…}>Delete</MenuItem>
 *     </MenuPopup>
 *   </Menu.Root>
 */
export const Menu = BaseMenu

export function MenuPopup({
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  className,
}: {
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  className?: string
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side} align={align} sideOffset={sideOffset} className="z-60 outline-none">
        <BaseMenu.Popup className={cn(POPUP, 'min-w-[220px] max-w-[calc(100vw-32px)] lg:min-w-[180px]', className)}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export function MenuItem({
  icon,
  destructive,
  children,
  className,
  ...rest
}: { icon?: IconName; destructive?: boolean; children: ReactNode } & Omit<ComponentProps<typeof BaseMenu.Item>, 'children'>) {
  return (
    <BaseMenu.Item className={cn(ITEM, destructive && 'text-negative', className)} {...rest}>
      <span className="flex-1">{children}</span>
      {icon && <Icon name={icon} className="text-[17px]" />}
    </BaseMenu.Item>
  )
}

export const MenuRadioGroup = BaseMenu.RadioGroup

export function MenuRadioItem({
  children,
  className,
  ...rest
}: { children: ReactNode } & Omit<ComponentProps<typeof BaseMenu.RadioItem>, 'children'>) {
  return (
    <BaseMenu.RadioItem className={cn(ITEM, 'pl-2', className)} {...rest}>
      <span className="grid w-4 place-items-center">
        <BaseMenu.RadioItemIndicator>
          <Icon name="check" className="text-[14px] text-tint-text" />
        </BaseMenu.RadioItemIndicator>
      </span>
      <span className="flex-1">{children}</span>
    </BaseMenu.RadioItem>
  )
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-2 my-1 h-px scale-y-50 bg-separator" />
}

/**
 * Styled Base UI Popover (glass-strong). Desktop month picker and similar.
 *
 *   <Popover.Root>
 *     <Popover.Trigger>November</Popover.Trigger>
 *     <PopoverPopup title="Choose Month">…</PopoverPopup>
 *   </Popover.Root>
 */
export const Popover = BasePopover

export function PopoverPopup({
  children,
  title,
  side = 'bottom',
  align = 'start',
  sideOffset = 8,
  className,
}: {
  children: ReactNode
  /** Rendered as the popover's labelled title (visually hidden when `hideTitle`). */
  title?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  className?: string
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} className="z-60 outline-none">
        <BasePopover.Popup className={cn(POPUP, 'rounded-md p-3', className)}>
          {title && <BasePopover.Title className="m-0 mb-2 px-1 text-headline">{title}</BasePopover.Title>}
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}
