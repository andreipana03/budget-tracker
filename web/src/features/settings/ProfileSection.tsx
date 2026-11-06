import { useState } from 'react'

import { DetailRow, Icon, List, ResponsiveSheet, Section, TextFieldRow, useToast } from '@/components/ui'
import { rowClasses } from '@/components/ui/row-classes'
import { errorMessage, formErrors } from '@/features/auth/field-errors'
import { InputRow, UsernameStatus } from '@/features/auth/fields'
import { normalizeUsernameInput, USERNAME_PATTERN, useUsernameAvailability } from '@/features/auth/useUsernameAvailability'
import { apiClient } from '@/lib/api/client'
import { unwrap } from '@/lib/api/errors'
import type { User } from '@/lib/api/queries'

import { ListError } from './parts'
import { useResetOnOpen } from './use-reset-on-open'
import { useUpdateMe } from './useSettings'

/** Profile: Name (inline), Username (sheet with availability), Email (read-only + verification). */
export function ProfileSection({ user }: { user: User }) {
  const toast = useToast()
  const updateMe = useUpdateMe()
  const [name, setName] = useState(user.displayName ?? '')
  const [editingName, setEditingName] = useState(false)
  const [usernameOpen, setUsernameOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resending, setResending] = useState(false)


  const saveName = () => {
    setEditingName(false)
    const next = name.trim()
    if (next === (user.displayName ?? '')) return
    setError(null)
    updateMe.mutate(
      { displayName: next },
      {
        onSuccess: () => toast.show({ title: 'Name saved' }),
        onError: (e) => {
          setName(user.displayName ?? '')
          setError(formErrors(e, ['displayName'] as const).fields.displayName ?? errorMessage(e))
        },
      },
    )
  }

  const resend = async () => {
    setResending(true)
    setError(null)
    try {
      await unwrap(apiClient.POST('/me/resend-verification'))
      toast.show({ title: 'Confirmation email sent' })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setResending(false)
    }
  }

  return (
    <Section title="Profile">
      <List>
        <TextFieldRow
          label="Name"
          placeholder="Optional"
          autoComplete="name"
          enterKeyHint="done"
          maxLength={80}
          // Shows the saved name unless it's being edited.
          value={editingName ? name : (user.displayName ?? '')}
          onFocus={() => {
            setName(user.displayName ?? '')
            setEditingName(true)
          }}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setName(user.displayName ?? '')
              setEditingName(false)
            }
          }}
        />
        <DetailRow label="Username" value={user.username} onClick={() => setUsernameOpen(true)} aria-label={`Username: ${user.username}. Change Username`} />
        <div className={rowClasses({ hasLeading: false })}>
          <span className="flex-none text-body">Email</span>
          <span className="flex min-w-0 flex-1 flex-col items-end text-right">
            <span className="max-w-full truncate text-body text-label-2">{user.email}</span>
            {user.emailVerified ? (
              <span className="flex items-center gap-1 text-footnote text-label-2">
                <Icon name="check-circle" weight="fill" className="text-positive" />
                Verified
              </span>
            ) : (
              <span className="flex items-center gap-1 text-footnote text-label-2">
                <Icon name="warning-circle" weight="fill" />
                Not Verified ·
                <button
                  type="button"
                  onClick={resend}
                  disabled={resending}
                  className="-my-3 py-3 font-semibold text-tint-text disabled:opacity-40"
                >
                  {resending ? 'Sending…' : 'Resend'}
                </button>
              </span>
            )}
          </span>
        </div>
      </List>
      {error && <ListError>{error}</ListError>}
      <UsernameSheet open={usernameOpen} onOpenChange={setUsernameOpen} current={user.username} />
    </Section>
  )
}

function UsernameSheet({ open, onOpenChange, current }: { open: boolean; onOpenChange: (open: boolean) => void; current: string }) {
  const toast = useToast()
  const updateMe = useUpdateMe()
  const [value, setValue] = useState(current)
  const [serverError, setServerError] = useState<string | undefined>()
  const availability = useUsernameAvailability(value, { current })

  useResetOnOpen(open, () => {
    setValue(current)
    setServerError(undefined)
  })

  const changed = value !== current
  const canSave = changed && USERNAME_PATTERN.test(value) && availability.status !== 'unavailable' && !updateMe.isPending

  const save = () => {
    if (!canSave) return
    updateMe.mutate(
      { username: value },
      {
        onSuccess: () => {
          onOpenChange(false)
          toast.show({ title: 'Username changed' })
        },
        onError: (e) => {
          const mapped = formErrors(e, ['username'] as const)
          setServerError(mapped.fields.username ?? mapped.form)
        },
      },
    )
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Username"
      confirmLabel="Save Username"
      onConfirm={save}
      confirmDisabled={!canSave}
      isDirty={changed}
      discardTitle="Discard this username?"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <List>
          <InputRow
            label="Username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={30}
            value={value}
            onChange={(e) => {
              setValue(normalizeUsernameInput(e.target.value))
              setServerError(undefined)
            }}
            aria-describedby="username-sheet-status"
          />
        </List>
        <UsernameStatus id="username-sheet-status" state={availability} error={serverError} />
        <p className="m-0 px-4 pt-3 text-footnote text-label-2 lg:px-0.5">You can sign in with your username or your email.</p>
      </form>
    </ResponsiveSheet>
  )
}
