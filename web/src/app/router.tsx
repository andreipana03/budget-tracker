import { createBrowserRouter, type RouteObject } from 'react-router'

import { ActivityPage } from '@/features/activity/ActivityPage'
import { TransactionDetailPage } from '@/features/activity/TransactionDetailPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { SignInPage } from '@/features/auth/SignInPage'
import { SignUpPage } from '@/features/auth/SignUpPage'
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage'
import { BudgetsPage } from '@/features/budgets/BudgetsPage'
import { CategoryDetailPage } from '@/features/budgets/CategoryDetailPage'
import { HealthPage } from '@/features/health/HealthPage'
import { HomePage } from '@/features/home/HomePage'
import { InsightsPage } from '@/features/insights/InsightsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { SubscriptionsPage } from '@/features/subscriptions/SubscriptionsPage'

import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'

/** Signed-in screens, rendered inside the shell. Month lives in the URL as `?month=YYYY-MM`. */
const appRoutes: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: 'activity', element: <ActivityPage /> },
  { path: 'activity/:id', element: <TransactionDetailPage /> },
  { path: 'budgets', element: <BudgetsPage /> },
  { path: 'budgets/:categoryId', element: <CategoryDetailPage /> },
  { path: 'insights', element: <InsightsPage /> },
  { path: 'subscriptions', element: <SubscriptionsPage /> },
  { path: 'settings/*', element: <SettingsPage /> },
  { path: 'status', element: <HealthPage /> },
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
  { path: 'sign-in', element: <SignInPage /> },
  { path: 'sign-up', element: <SignUpPage /> },
  { path: 'forgot-password', element: <ForgotPasswordPage /> },
  { path: 'reset-password', element: <ResetPasswordPage /> },
  { path: 'verify-email', element: <VerifyEmailPage /> },
  ...devRoutes,
  // Protected
  {
    element: <RequireAuth />,
    children: [{ path: '/', element: <AppShell />, children: appRoutes }],
  },
]

export const router = createBrowserRouter(routes)
