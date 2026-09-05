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
        // Keep sequential navigation inside the dialog, including browsers
        // that otherwise send the last Tab stop into browser chrome.
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, textarea, summary, [tabindex]'
        )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onCancel={event => { event.preventDefault(); onClose() }}>
      {children}
    </dialog>
  )
}
