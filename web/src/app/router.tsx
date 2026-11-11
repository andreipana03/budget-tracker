import { createBrowserRouter, type RouteObject } from 'react-router'

import { RequireAuth } from '@/features/auth/RequireAuth'

import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'

/**
 * Signed-in screens, rendered inside the shell. Month lives in the URL as `?month=YYYY-MM`.
 * Every screen is its own lazily loaded chunk, so the first load only fetches the shell.
 */
const appRoutes: RouteObject[] = [
  { index: true, lazy: async () => ({ Component: (await import('@/features/home/HomePage')).HomePage }) },
  { path: 'activity', lazy: async () => ({ Component: (await import('@/features/activity/ActivityPage')).ActivityPage }) },
  { path: 'activity/:id', lazy: async () => ({ Component: (await import('@/features/activity/TransactionDetailPage')).TransactionDetailPage }) },
  { path: 'budgets', lazy: async () => ({ Component: (await import('@/features/budgets/BudgetsPage')).BudgetsPage }) },
  { path: 'budgets/:categoryId', lazy: async () => ({ Component: (await import('@/features/budgets/CategoryDetailPage')).CategoryDetailPage }) },
  { path: 'insights', lazy: async () => ({ Component: (await import('@/features/insights/InsightsPage')).InsightsPage }) },
  { path: 'subscriptions', lazy: async () => ({ Component: (await import('@/features/subscriptions/SubscriptionsPage')).SubscriptionsPage }) },
  { path: 'settings/*', lazy: async () => ({ Component: (await import('@/features/settings/SettingsPage')).SettingsPage }) },
  { path: 'status', lazy: async () => ({ Component: (await import('@/features/health/HealthPage')).HealthPage }) },
  { path: '*', element: <NotFoundPage /> },
]

const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        element: <AppShell />,
        children: [{ path: 'dev/kit', lazy: async () => ({ Component: (await import('@/dev/KitPage')).KitPage }) }],
      },
    ]
  : []

export const routes: RouteObject[] = [
  // Public
  { path: 'sign-in', lazy: async () => ({ Component: (await import('@/features/auth/SignInPage')).SignInPage }) },
  { path: 'sign-up', lazy: async () => ({ Component: (await import('@/features/auth/SignUpPage')).SignUpPage }) },
  { path: 'forgot-password', lazy: async () => ({ Component: (await import('@/features/auth/ForgotPasswordPage')).ForgotPasswordPage }) },
  { path: 'reset-password', lazy: async () => ({ Component: (await import('@/features/auth/ResetPasswordPage')).ResetPasswordPage }) },
  { path: 'verify-email', lazy: async () => ({ Component: (await import('@/features/auth/VerifyEmailPage')).VerifyEmailPage }) },
  ...devRoutes,
  // Protected
  {
    element: <RequireAuth />,
    children: [{ path: '/', element: <AppShell />, children: appRoutes }],
  },
]

export const router = createBrowserRouter(routes)
