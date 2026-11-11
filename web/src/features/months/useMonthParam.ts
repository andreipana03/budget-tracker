import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/**
 * The budget month a screen shows, from `?month=YYYY-MM` (undefined = the household's
 * current month). Home and Budgets share it, so switching month on one keeps it on the
 * other when the link carries the param.
 */
export function useMonthParam(): { month: string | undefined; setMonth: (month: string | undefined) => void } {
  const [params, setParams] = useSearchParams()
  const month = params.get('month') ?? undefined
  const setMonth = useCallback(
    (next: string | undefined) => {
      setParams(
        (current) => {
          const copy = new URLSearchParams(current)
          if (next) copy.set('month', next)
          else copy.delete('month')
          return copy
        },
        { replace: false },
      )
    },
    [setParams],
  )
  return { month: /^\d{4}-\d{2}$/.test(month ?? '') ? month : undefined, setMonth }
}
