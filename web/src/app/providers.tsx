import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { useAuth } from '@/features/auth/auth-context'
import { isFinalError } from '@/lib/api/errors'
import { useCurrencies } from '@/lib/api/queries'
import { registerCurrencies } from '@/lib/format/money'
import { RegionProvider } from '@/lib/format/region'

import { AddSheetProvider } from './add-sheet'
import { TransferSheetProvider } from './transfer-sheet'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // 4xx (and 501 while endpoints are being built) won't get better by retrying.
        retry: (failureCount, error) => !isFinalError(error) && failureCount < 2,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  })
}

/** Everything the app needs above the router. Used once, in main.tsx. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RegionFromUser>
          <ToastProvider>
            <AddSheetProvider>
              <TransferSheetProvider>{children}</TransferSheetProvider>
            </AddSheetProvider>
          </ToastProvider>
        </RegionFromUser>
      </AuthProvider>
    </QueryClientProvider>
  )
}

/** Number formatting follows the signed-in person's region (User.region), else the browser's. */
function RegionFromUser({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return (
    <RegionProvider region={user?.region}>
      {user && <CurrencyRegistry />}
      {children}
    </RegionProvider>
  )
}

/** Teaches the money formatter the API's minor units for every currency (signed in only). */
function CurrencyRegistry() {
  const { data } = useCurrencies()
  useEffect(() => {
    if (data) registerCurrencies(data)
  }, [data])
  return null
}
