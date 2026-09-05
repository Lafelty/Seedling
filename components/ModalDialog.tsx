'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/** Native modal: traps focus, makes the page inert, and restores opener focus. */
export default function ModalDialog({ open, onClose, labelledBy, children, className = '' }: {
  open: boolean
  onClose: () => void
  labelledBy: string
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open, labelledBy])

  return (
    <dialog ref={ref} className={`patient-dialog ${className}`} aria-labelledby={labelledBy}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        // Move between controls explicitly: WebKit can skip links according
        // to platform keyboard settings, bypassing a boundary-only trap.
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, textarea, summary, [tabindex]'
        )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') &&
          !element.closest('[inert]') && element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility === 'visible')
        if (!controls.length) { event.preventDefault(); return }
        const index = controls.indexOf(document.activeElement as HTMLElement)
        const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
        event.preventDefault()
        controls[next].focus()
      }}
      onCancel={event => { event.preventDefault(); onClose() }}>
      {children}
    </dialog>
  )
}
