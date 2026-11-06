import { useDeferredValue, useMemo, useState } from 'react'

import { DetailRow, List, ResponsiveSheet, SearchField, Section, SectionFooter, useToast } from '@/components/ui'
import { errorMessage } from '@/features/auth/field-errors'
import { useCurrencies, type Household, type User } from '@/lib/api/queries'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Groups, ListError, OptionRow } from './parts'
import { useResetOnOpen } from './use-reset-on-open'
import {
  allTimeZones,
  matchesTimeZone,
  monthStartExample,
  regionName,
  regionOptions,
  timeZoneOffset,
  timeZoneParts,
} from './settings-logic'
import { useUpdateHousehold, useUpdateMe, type UpdateHouseholdBody } from './useSettings'

type Picker = 'currency' | 'monthStart' | 'timezone' | 'region' | null

/** Budget: home currency, month start day, time zone, number-format region. */
export function BudgetSection({ household, user }: { household: Household; user: User }) {
  const toast = useToast()
  const updateHousehold = useUpdateHousehold()
  const updateMe = useUpdateMe()
  const [picker, setPicker] = useState<Picker>(null)
  const [error, setError] = useState<string | null>(null)

  const saveHousehold = (body: UpdateHouseholdBody, done: string) => {
    setError(null)
    setPicker(null)
    updateHousehold.mutate(body, {
      onSuccess: () => toast.show({ title: done }),
      onError: (e) => setError(errorMessage(e)),
    })
  }

  const region = user.region
  const { city } = timeZoneParts(household.timezone)

  return (
    <Section title="Budget">
      <Groups>
        <div>
          <List>
            <DetailRow
              label="Home Currency"
              value={household.homeCurrency}
              onClick={household.canChangeHomeCurrency ? () => setPicker('currency') : undefined}
              accessory={household.canChangeHomeCurrency ? 'disclosure' : 'none'}
              aria-label={`Home Currency: ${household.homeCurrency}`}
            />
          </List>
          <SectionFooter>
            {household.canChangeHomeCurrency
              ? `Totals and budgets are in ${household.homeCurrency}. Accounts in other currencies are converted at the BNR rate.`
              : `Totals and budgets are in ${household.homeCurrency}. It can’t change once you’ve added transactions or subscriptions.`}
          </SectionFooter>
        </div>

        <div>
          <List>
            <DetailRow label="Month Starts On" value={`Day ${household.monthStartDay}`} onClick={() => setPicker('monthStart')} />
          </List>
          <SectionFooter>{monthStartExample(household.monthStartDay, household.currentMonth)}</SectionFooter>
        </div>

        <div>
          <List>
            <DetailRow label="Time Zone" value={city} onClick={() => setPicker('timezone')} />
            <DetailRow label="Number Format" value={regionName(region)} onClick={() => setPicker('region')} />
          </List>
          <SectionFooter>
            “Today” follows {household.timezone.replace(/_/g, ' ')}. Amounts look like{' '}
            <span className="tabular-nums">{formatMoney(123429, household.homeCurrency, { region })}</span>.
          </SectionFooter>
          {error && <ListError>{error}</ListError>}
        </div>
      </Groups>

      <CurrencySheet
        open={picker === 'currency'}
        onOpenChange={(o) => setPicker(o ? 'currency' : null)}
        value={household.homeCurrency}
        onSelect={(code) => code !== household.homeCurrency && saveHousehold({ homeCurrency: code }, 'Home currency changed')}
      />
      <MonthStartSheet
        open={picker === 'monthStart'}
        onOpenChange={(o) => setPicker(o ? 'monthStart' : null)}
        value={household.monthStartDay}
        month={household.currentMonth}
        onSelect={(day) => day !== household.monthStartDay && saveHousehold({ monthStartDay: day }, 'Month start changed')}
      />
      <RegionSheet
        open={picker === 'region'}
        onOpenChange={(o) => setPicker(o ? 'region' : null)}
        value={region}
        currency={household.homeCurrency}
        onSelect={(next) => {
          setPicker(null)
          if (next === region) return
          setError(null)
          updateMe.mutate(
            { region: next },
            {
              onSuccess: () => toast.show({ title: 'Number format changed' }),
              onError: (e) => setError(errorMessage(e)),
            },
          )
        }}
      />
      <TimeZoneSheet
        open={picker === 'timezone'}
        onOpenChange={(o) => setPicker(o ? 'timezone' : null)}
        value={household.timezone}
        onSelect={(tz) => tz !== household.timezone && saveHousehold({ timezone: tz }, 'Time zone changed')}
      />
    </Section>
  )
}

function CurrencySheet({
  open,
  onOpenChange,
  value,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onSelect: (code: string) => void
}) {
  const currencies = useCurrencies()
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Home Currency">
      {currencies.isError ? (
        <ListError>Couldn’t load the currencies. Check your connection and try again.</ListError>
      ) : (
        <List role="radiogroup" aria-label="Home Currency">
          {(currencies.data ?? [{ code: value, name: value, minorUnits: 2 }]).map((c) => (
            <OptionRow key={c.code} title={c.name} trailing={c.code} selected={c.code === value} onSelect={() => onSelect(c.code)} />
          ))}
        </List>
      )}
      <SectionFooter>Pick it before you add transactions: it can’t change after that.</SectionFooter>
    </ResponsiveSheet>
  )
}

function MonthStartSheet({
  open,
  onOpenChange,
  value,
  month,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: number
  month: string
  onSelect: (day: number) => void
}) {
  const [draft, setDraft] = useState(value)
  useResetOnOpen(open, () => setDraft(value))

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Month Starts On"
      confirmLabel="Save Month Start"
      onConfirm={() => onSelect(draft)}
      confirmDisabled={draft === value}
    >
      <List className="p-3 lg:p-4">
        <div role="radiogroup" aria-label="Day of the month" className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
            <button
              key={day}
              type="button"
              role="radio"
              aria-checked={day === draft}
              onClick={() => setDraft(day)}
              className={cn(
                'pressable mx-auto grid size-11 place-items-center rounded-full text-body tabular-nums lg:size-9',
                day === draft ? 'bg-tint font-semibold text-on-tint' : 'hover:bg-fill-4',
              )}
            >
              {day}
            </button>
          ))}
        </div>
      </List>
      <SectionFooter>{monthStartExample(draft, month)} Budgets and the pace bar follow this.</SectionFooter>
    </ResponsiveSheet>
  )
}

function TimeZoneSheet({
  open,
  onOpenChange,
  value,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onSelect: (tz: string) => void
}) {
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const zones = useMemo(() => (open ? allTimeZones([value]) : []), [open, value])
  // The current zone leads the list until someone searches.
  const matches = useMemo(() => {
    const found = zones.filter((z) => matchesTimeZone(z, deferred))
    return deferred.trim() ? found : [value, ...found.filter((z) => z !== value)]
  }, [zones, deferred, value])
  useResetOnOpen(open, () => setQuery(''))

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Time Zone">
      <SearchField label="Search time zones" value={query} onValueChange={setQuery} className="mb-4" />
      {matches.length === 0 ? (
        <p className="m-0 py-10 text-center text-subhead text-label-2">No time zones match “{query}”.</p>
      ) : (
        <List role="radiogroup" aria-label="Time Zone">
          {matches.map((z) => {
            const { city, area } = timeZoneParts(z)
            return (
              <OptionRow
                key={z}
                title={city}
                subtitle={area || undefined}
                trailing={timeZoneOffset(z)}
                selected={z === value}
                onSelect={() => onSelect(z)}
              />
            )
          })}
        </List>
      )}
    </ResponsiveSheet>
  )
}

function RegionSheet({
  open,
  onOpenChange,
  value,
  currency,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  currency: string
  onSelect: (region: string) => void
}) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Number Format">
      <List role="radiogroup" aria-label="Number Format">
        {regionOptions(value).map((r) => (
          <OptionRow
            key={r.value}
            title={r.label}
            trailing={formatMoney(123429, currency, { region: r.value })}
            selected={r.value === value}
            onSelect={() => onSelect(r.value)}
          />
        ))}
      </List>
      <SectionFooter>Numbers and amounts follow the region you pick. The app stays in English.</SectionFooter>
    </ResponsiveSheet>
  )
}
