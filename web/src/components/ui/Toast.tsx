import { Toast } from '@base-ui/react/toast'
import type { ReactNode } from 'react'

const TIMEOUT_MS = 5000

/**
 * Toasts (design § 6.16): one glass capsule above the tab bar on compact,
 * bottom-center on desktop, 5 s, announced politely (Base UI Toast is the live region).
 * Wrap the app once; call `useToast()` anywhere below.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider limit={1} timeout={TIMEOUT_MS}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed inset-x-4 bottom-[calc(max(12px,var(--safe-bottom)-12px)+var(--tabbar-h)+12px)] z-80 flex justify-center outline-none lg:bottom-6 lg:left-[calc(var(--sidebar-w)+10px)]">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((t) => (
    <Toast.Root
      key={t.id}
      toast={t}
      swipeDirection={['down', 'left', 'right']}
      className="glass flex max-w-full min-h-11 items-center gap-3 rounded-full py-2 pr-2 pl-5 text-label transition-[translate,opacity] duration-(--dur-fast) ease-out select-none data-ending-style:translate-y-2 data-ending-style:opacity-0 data-limited:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0"
    >
      <Toast.Title className="m-0 text-subhead font-semibold whitespace-nowrap lg:text-body" />
      {t.actionProps ? (
        <Toast.Action className="h-8 rounded-full px-3 text-subhead font-semibold text-tint-text hover:bg-fill-4 lg:text-body" />
      ) : (
        <span className="w-2" />
      )}
    </Toast.Root>
  ))
}
