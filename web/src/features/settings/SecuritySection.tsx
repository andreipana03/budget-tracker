import { useState } from 'react'

import { DetailRow, Icon, List, ResponsiveSheet, Row, Section, useToast } from '@/components/ui'
import { useAuth } from '@/features/auth/auth-context'
import { formErrors } from '@/features/auth/field-errors'
import { PasswordChecklist, PasswordRow } from '@/features/auth/fields'
import { isPasswordAcceptable, passwordRules } from '@/features/auth/password-rules'
import { apiClient } from '@/lib/api/client'
import { ApiError, unwrap } from '@/lib/api/errors'
import type { User } from '@/lib/api/queries'

import { ListError } from './parts'
import { useResetOnOpen } from './use-reset-on-open'

/** Sign-In & Security: Change (or Set) Password; shows a linked Google account. */
export function SecuritySection({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const google = user.linkedProviders.includes('google')
  const label = user.hasPassword ? 'Change Password' : 'Set Password'
  return (
    <Section
      title="Sign-In & Security"
      footer={
        user.hasPassword
          ? undefined
          : 'You sign in with Google. Set a password to also sign in with your email or username.'
      }
    >
      <List>
        <DetailRow label={label} onClick={() => setOpen(true)} />
        {google && (
          <Row
            title="Google"
            trailing={
              <span className="flex items-center gap-1">
                <Icon name="check-circle" weight="fill" className="text-positive" />
                Linked
              </span>
            }
          />
        )}
      </List>
      <PasswordSheet open={open} onOpenChange={setOpen} user={user} />
    </Section>
  )
}

const FIELDS = ['currentPassword', 'newPassword'] as const
type Field = (typeof FIELDS)[number]

function PasswordSheet({ open, onOpenChange, user }: { open: boolean; onOpenChange: (open: boolean) => void; user: User }) {
  const toast = useToast()
  const { updateUser } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [errors, setErrors] = useState<Partial<Record<Field, string>> & { form?: string }>({})
  const [saving, setSaving] = useState(false)
  const setting = !user.hasPassword

  useResetOnOpen(open, () => {
    setCurrent('')
    setNext('')
    setErrors({})
  })

  const identity = { username: user.username, email: user.email }
  const rules = passwordRules(next, identity)
  const canSave = (setting || current.length > 0) && isPasswordAcceptable(next, identity) && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setErrors({})
    try {
      await unwrap(
        apiClient.POST('/me/password', { body: setting ? { newPassword: next } : { currentPassword: current, newPassword: next } }),
      )
      if (setting) updateUser({ ...user, hasPassword: true })
      onOpenChange(false)
      toast.show({ title: setting ? 'Password set' : 'Password changed' })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_credentials') setErrors({ currentPassword: e.message })
      else {
        const mapped = formErrors(e, FIELDS)
        setErrors({ ...mapped.fields, form: mapped.form })
      }
    } finally {
      setSaving(false)
    }
  }

  const title = setting ? 'Set Password' : 'Change Password'
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      confirmLabel={title}
      onConfirm={save}
      confirmDisabled={!canSave}
      isDirty={current.length > 0 || next.length > 0}
      discardTitle="Discard this password?"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input type="text" name="username" autoComplete="username" value={user.username} hidden readOnly />
        {!setting && (
          <div className="mb-6">
            <List>
              <PasswordRow
                label="Current Password"
                name="current-password"
                autoComplete="current-password"
                enterKeyHint="next"
                value={current}
                onChange={(e) => {
                  setCurrent(e.target.value)
                  setErrors((p) => ({ ...p, currentPassword: undefined }))
                }}
                aria-invalid={errors.currentPassword ? true : undefined}
              />
            </List>
            {errors.currentPassword && <ListError>{errors.currentPassword}</ListError>}
          </div>
        )}
        <List>
          <PasswordRow
            label="New Password"
            name="new-password"
            autoComplete="new-password"
            enterKeyHint="done"
            maxLength={128}
            value={next}
            onChange={(e) => {
              setNext(e.target.value)
              setErrors((p) => ({ ...p, newPassword: undefined }))
            }}
            aria-invalid={errors.newPassword ? true : undefined}
            aria-describedby="password-sheet-rules"
          />
        </List>
        {errors.newPassword && <ListError>{errors.newPassword}</ListError>}
        <PasswordChecklist id="password-sheet-rules" rules={rules} />
        {errors.form && <ListError>{errors.form}</ListError>}
        <p className="m-0 px-4 pt-4 text-footnote text-label-2 lg:px-0.5">
          You stay signed in here. Other devices are signed out and need the new password.
        </p>
        <button type="submit" hidden />
      </form>
    </ResponsiveSheet>
  )
}
