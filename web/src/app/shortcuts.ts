import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Keyboard shortcuts (design § 5.5), all in one place:
 *
 *   ⌘N / Ctrl+N, or N with no text field focused → Add transaction
 *   ⌘1–⌘5, ⌥⌘1–⌥⌘5 (also Ctrl)               → Home, Activity, Budgets, Insights, Subscriptions
 *   ⌘F / Ctrl+F                                 → Search
 *   ⌃⌘S                                         → Show/hide the sidebar
 *
 * Chrome reserves ⌘N and ⌘1–9 for its own tabs, so the plain "N" and ⌥⌘ variants
 * are the reliable ones there (a documented deviation from the design doc).
 * Never overrides ⌘T, ⌘W, ⌘L, ⌘R. Section/search shortcuts are ignored while a
 * modal dialog is open.
 */
export const SHORTCUTS = {
  add: { keys: 'Meta+N Control+N N', hint: '⌘N' },
  search: { keys: 'Meta+F Control+F', hint: '⌘F' },
  sidebar: { keys: 'Control+Meta+S', hint: '⌃⌘S' },
} as const

export interface ShortcutHandlers {
  onAdd: () => void
  onSection: (index: number) => void
  onSearch: () => void
  onToggleSidebar: () => void
}

function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type)
  }
  return false
}

function modalOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]'))
}

export function useGlobalShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers)
  useLayoutEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const h = ref.current

      // ⌃⌘S — sidebar (both modifiers on purpose)
      if (e.metaKey && e.ctrlKey && !e.altKey && (key === 's' || e.code === 'KeyS')) {
        e.preventDefault()
        h.onToggleSidebar()
        return
      }
      // ⌘N / Ctrl+N, or plain N outside text fields
      if ((key === 'n' || e.code === 'KeyN') && !e.altKey && !e.shiftKey) {
        if (mod && !(e.metaKey && e.ctrlKey)) {
          e.preventDefault()
          if (!modalOpen()) h.onAdd()
          return
        }
        if (!mod && !isTextField(e.target) && !modalOpen()) {
          e.preventDefault()
          h.onAdd()
          return
        }
      }
      if (!mod || modalOpen()) return
      // ⌘1–5 / ⌥⌘1–5 (e.code, since ⌥ changes e.key on macOS)
      const digit = /^Digit([1-5])$/.exec(e.code)
      if (digit && !e.shiftKey) {
        e.preventDefault()
        h.onSection(Number(digit[1]) - 1)
        return
      }
      // ⌘F
      if ((key === 'f' || e.code === 'KeyF') && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        h.onSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
