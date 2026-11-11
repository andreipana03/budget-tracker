import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AddSheetProvider, useAddSheet } from '@/app/add-sheet'
import { AppShell } from '@/app/AppShell'
import { RegionProvider } from '@/lib/format'

import { BudgetRow } from './BudgetRow'
import { CategoryTile } from './CategoryTile'
import { HeroAmount, Money } from './Money'
import { PaceBar } from './PaceBar'
import { Row } from './List'
import { Segmented } from './Segmented'
import { EmptyState, InlineError } from './States'
import { ToastProvider } from './Toast'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function wrap(ui: ReactNode) {
  return render(
    <RegionProvider region="RO">
      <MemoryRouter>{ui}</MemoryRouter>
    </RegionProvider>,
  )
}

describe('Money', () => {
  it('formats in the region with signs and tone', () => {
    wrap(
      <>
        <Money minor={6430} currency="RON" />
        <Money minor={85000} currency="RON" kind="income" />
        <Money minor={2750} currency="RON" over />
      </>,
    )
    expect(screen.getByText('64,30 lei')).toBeTruthy()
    expect(screen.getByText('+850,00 lei').className).toContain('text-positive')
    expect(screen.getByText('27,50 lei over').className).toContain('text-negative')
  })

  it('gives the hero amount one readable string', () => {
    wrap(<HeroAmount minor={76571} currency="RON" />)
    expect(screen.getByText('765,71 lei').className).toContain('sr-only')
  })
})

describe('PaceBar', () => {
  it('is an image with a sentence label', () => {
    wrap(
      <PaceBar
        segments={[{ color: 'indigo', amountMinor: 29500 }, { color: 'mint', amountMinor: 24640 }]}
        spentMinor={123429}
        budgetMinor={200000}
        currency="RON"
        marker={0.67}
      />,
    )
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Spent 1.234,29 lei of 2.000,00 lei. If you spent evenly you’d be at 1.340 lei today.'.replace('’', "'"),
    )
    expect(screen.getByText('Today')).toBeTruthy()
  })
})

describe('BudgetRow', () => {
  it('says over budget in words, not only color', () => {
    wrap(
      <BudgetRow name="Eating Out" color="orange" icon="fork-knife" spentMinor={32750} limitMinor={30000} currency="RON" status="over" elapsed={0.6} />,
    )
    expect(screen.getByText('27,50 lei over')).toBeTruthy()
    expect(screen.getByText(/Over budget · 327,50 of 300 lei/)).toBeTruthy()
  })

  it('shows what is left when on track', () => {
    wrap(
      <BudgetRow name="Groceries" color="mint" icon="shopping-cart" spentMinor={24640} limitMinor={60000} currency="RON" status="on_track" elapsed={0.6} />,
    )
    expect(screen.getByText('353,60 lei')).toBeTruthy()
    expect(screen.getByText('246,40 of 600 lei')).toBeTruthy()
  })
})

describe('Row and tiles', () => {
  it('renders a link row with a decorative tile', () => {
    const { container } = wrap(
      <Row leading={<CategoryTile color="yellow" icon="gift" size={40} />} title="Lidl" subtitle="Groceries · ING Card" to="/activity/1" />,
    )
    expect(screen.getByRole('link').getAttribute('href')).toBe('/activity/1')
    const tile = container.querySelector('[aria-hidden]') as HTMLElement
    expect(tile.className).toContain('text-tile-glyph-dark')
    expect(tile.style.background).toBe('var(--hue-yellow-tile)')
  })
})

describe('Segmented', () => {
  it('marks the selected segment with aria-pressed', () => {
    const onChange = vi.fn()
    wrap(
      <Segmented
        aria-label="Show"
        value={'all' as 'all' | 'income'}
        onChange={onChange}
        options={[
          { value: 'all', label: 'All' },
          { value: 'income', label: 'Income' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Income' }))
    expect(onChange).toHaveBeenCalledWith('income')
  })
})

describe('States', () => {
  it('offers Try Again and the primary action', () => {
    const retry = vi.fn()
    const add = vi.fn()
    wrap(
      <>
        <InlineError what="your budgets" onRetry={retry} />
        <EmptyState title="No Expenses Yet" message="Add your first expense with the + button." action={{ label: 'Add Expense', onClick: add }} />
      </>,
    )
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t load your budgets.')
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }))
    expect(retry).toHaveBeenCalled()
    expect(add).toHaveBeenCalled()
  })
})

describe('AppShell', () => {
  function renderShell(path = '/budgets') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const holder: { api: ReturnType<typeof useAddSheet> | null } = { api: null }
    function Probe() {
      const api = useAddSheet()
      useEffect(() => {
        holder.api = api
      })
      return <p>Budgets screen</p>
    }
    const router = createMemoryRouter(
      [{ path: '/', element: <AppShell />, children: [{ path: 'budgets', element: <Probe /> }, { path: 'activity', element: <p>Activity screen</p> }] }],
      { initialEntries: [path] },
    )
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    render(
      <QueryClientProvider client={client}>
        <RegionProvider region="RO">
          <ToastProvider>
            <AddSheetProvider>
              <RouterProvider router={router} />
            </AddSheetProvider>
          </ToastProvider>
        </RegionProvider>
      </QueryClientProvider>,
    )
    return { router, getApi: () => holder.api }
  }

  it('selects the current tab and section', () => {
    renderShell()
    expect(screen.getByRole('tab', { name: 'Budgets' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('link', { name: 'Budgets' }).getAttribute('aria-current')).toBe('page')
  })

  it('opens the Add sheet with N and navigates with ⌘2', async () => {
    const { router, getApi } = renderShell()
    act(() => {
      fireEvent.keyDown(window, { key: 'n', code: 'KeyN' })
    })
    expect(getApi()?.state.isOpen).toBe(true)
    act(() => getApi()?.close())
    await act(async () => {
      fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true })
    })
    expect(router.state.location.pathname).toBe('/activity')
  })
})
