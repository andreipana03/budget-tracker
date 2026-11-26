import { useState, type RefObject } from 'react'

import { Icon } from '@/components/ui/Icon'
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '@/components/ui/Menu'
import { currencySymbol, useRegion } from '@/lib/format'

import { amountDisplayParts } from './amount-entry'

/**
 * The amount being typed (design § 6.11): SF Rounded 60px (51 on desktop), decimals at
 * 0.62em, a blue blinking caret and the currency pill. A transparent native input sits
 * on top so the keyboard (inputmode="decimal"), paste and screen readers work as usual;
 * the styled text mirrors it. Without `currencies` the pill only shows the currency (a
 * transfer's amount is always in its account's currency).
 */
export function AmountEntry({
  inputRef,
  text,
  onTextChange,
  decimalSep,
  groupSep,
  currency,
  currencies,
  onCurrencyChange,
  label,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  text: string
  onTextChange: (raw: string) => void
  decimalSep: string
  groupSep: string
  currency: string
  /** Account currencies first, then the others. Leave out for a fixed currency. */
  currencies?: { first: string[]; rest: { code: string; name: string }[] }
  onCurrencyChange?: (code: string) => void
  /** Accessible name of the input. Default "Amount in {currency}". */
  label?: string
}) {
  const region = useRegion()
  const [focused, setFocused] = useState(false)
  const parts = amountDisplayParts(text, decimalSep, groupSep)
  const symbol = currencySymbol(currency, { region })

  return (
    <div className="flex items-center justify-center">
      <style>{'@keyframes bt-caret-blink { 50% { opacity: 0 } } @media (prefers-reduced-motion: reduce) { .bt-caret { animation: none !important } }'}</style>
      <label className="relative inline-flex cursor-text items-baseline font-rounded text-[3.53rem] leading-none font-bold tracking-[-0.02em] tabular-nums lg:text-[3rem]">
        <span aria-hidden className="inline-flex items-baseline">
          {text ? (
            <>
              {parts.integer}
              {parts.separator && (
                <span className="text-[0.62em] tracking-normal">
                  {parts.separator}
                  {parts.fraction}
                </span>
              )}
            </>
          ) : (
            !focused && <span className="text-placeholder">0</span>
          )}
          <span
            className="bt-caret mr-0.5 ml-[3px] h-[0.86em] w-[3px] self-center rounded-[2px] bg-tint"
            style={{ animation: focused ? 'bt-caret-blink 1.1s steps(1) infinite' : undefined, opacity: focused ? 1 : 0 }}
          />
          {!text && focused && <span className="text-placeholder">0</span>}
        </span>
        <input
          ref={inputRef}
          aria-label={label ?? `Amount in ${currency}`}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-0 h-full w-full min-w-16 cursor-text border-0 bg-transparent p-0 text-[16px] text-transparent caret-transparent opacity-0 outline-none"
        />
      </label>
      {!currencies || !onCurrencyChange ? (
        <span className="ml-2 inline-flex h-8 flex-none items-center self-center rounded-full bg-fill-3 px-3 text-subhead font-semibold text-label">
          {symbol}
        </span>
      ) : (
        <Menu.Root>
          <Menu.Trigger
            aria-label={`Currency: ${currency}`}
            className="ml-2 inline-flex h-8 flex-none items-center gap-1 self-center rounded-full bg-fill-3 px-3 text-subhead font-semibold text-label hover:bg-fill-2 data-popup-open:bg-fill-2"
          >
            {symbol}
            <Icon name="caret-down" className="text-[12px] text-label-2" />
          </Menu.Trigger>
          <MenuPopup align="center" className="max-h-[50dvh] overflow-y-auto">
            <MenuRadioGroup value={currency} onValueChange={(v) => onCurrencyChange(v as string)}>
              {currencies.first.map((code) => (
                <MenuRadioItem key={code} value={code}>
                  {code} · {currencySymbol(code, { region })}
                </MenuRadioItem>
              ))}
              {currencies.rest.length > 0 && <MenuSeparator />}
              {currencies.rest.map((c) => (
                <MenuRadioItem key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu.Root>
      )}
    </div>
  )
}
