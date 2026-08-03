'use client'

/**
 * Framing a picked photo before it is uploaded.
 *
 * The frame is round, and it is round for a reason: every place this photo is
 * ever shown is a circle, so the only honest preview is the circle itself. What
 * the patient sees inside this frame is exactly what the garden, the profile
 * header and the therapist's patient table will show — nothing is discovered
 * after the fact.
 *
 * Drag to move, pinch or use the slider to zoom, arrow keys for the same without
 * a pointer. The maths behind all three lives in lib/avatarCrop.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  clampView,
  CROP_MAX_ZOOM,
  cropToFile,
  INITIAL_VIEW,
  loadImage,
  type CropView,
  type Size,
} from '@/lib/avatarCrop'

/** Arrow-key nudge, in frame pixels. Roughly a fingertip's worth of care. */
const KEY_PAN_STEP = 12

/** Arrow-key zoom step. Twenty presses cross the whole range. */
const KEY_ZOOM_STEP = 0.15

interface AvatarCropperProps {
  /** The file the patient picked. Already checked for type and size. */
  file: File
  /** Called with the framed square, ready to upload. */
  onConfirm: (cropped: File) => void
  onCancel: () => void
}

export function AvatarCropper({ file, onConfirm, onCancel }: AvatarCropperProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  /** Live pointers on the frame, so one finger pans and two pinch. */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  /** Finger spread and zoom at the moment the second finger landed. */
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null)

  const [url, setUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [viewport, setViewport] = useState(0)
  const [view, setView] = useState<CropView>(INITIAL_VIEW)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = !!natural && viewport > 0

  // The same object URL is both what is decoded for the crop and what is shown
  // on screen, so it is revoked only when the cropper goes away.
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)

    let cancelled = false
    loadImage(objectUrl)
      .then((image) => {
        if (cancelled) return
        imageRef.current = image
        setNatural({ width: image.naturalWidth, height: image.naturalHeight })
        setView(INITIAL_VIEW)
      })
      .catch(() => {
        if (!cancelled) setError('That picture could not be opened. Please pick another.')
      })

    return () => {
      cancelled = true
      imageRef.current = null
      URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  // Offsets are in frame pixels, so a frame that changes size (rotation, a
  // resized window) would leave them meaning something else.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const measure = () => setViewport(frame.getBoundingClientRect().width)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  /** Every change to the framing goes through here, so nothing can leave a gap. */
  const applyView = useCallback(
    (next: CropView) => {
      if (!natural || viewport <= 0) return
      setView(clampView(next, natural, viewport))
    },
    [natural, viewport],
  )

  // A frame that was dragged to its corner has to be pulled back in when the
  // patient zooms out again, or the photo would come away from the edge.
  useEffect(() => {
    if (!natural || viewport <= 0) return
    setView((current) => clampView(current, natural, viewport))
  }, [natural, viewport])

  // React attaches wheel at the root as a passive listener, which cannot cancel
  // the page scroll underneath. This one is the frame's own, and can.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setView((current) => {
        if (!natural || viewport <= 0) return current
        const factor = Math.exp(-event.deltaY / 320)
        return clampView({ ...current, zoom: current.zoom * factor }, natural, viewport)
      })
    }

    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  }, [natural, viewport])

  // Escape closes, and the page behind stops scrolling while this is up.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onCancel])

  // Arrow keys land on the frame, so it takes focus rather than a button: the
  // frame is the control, and moving the photo is what this screen is for.
  useEffect(() => {
    if (ready) frameRef.current?.focus()
  }, [ready])

  function spread(): number {
    const [a, b] = Array.from(pointersRef.current.values())
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!ready || busy) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 2) {
      pinchRef.current = { distance: spread(), zoom: view.zoom }
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const previous = pointersRef.current.get(event.pointerId)
    if (!previous) return

    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    // Two fingers zoom about the frame's centre; whatever is under the middle of
    // the circle stays there, which is the part being framed.
    const pinch = pinchRef.current
    if (pointersRef.current.size >= 2) {
      if (!pinch || pinch.distance <= 0) return
      applyView({ ...view, zoom: pinch.zoom * (spread() / pinch.distance) })
      return
    }

    applyView({
      ...view,
      offsetX: view.offsetX + (event.clientX - previous.x),
      offsetY: view.offsetY + (event.clientY - previous.y),
    })
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!ready || busy) return

    const moves: Record<string, Partial<CropView>> = {
      ArrowLeft: { offsetX: view.offsetX + KEY_PAN_STEP },
      ArrowRight: { offsetX: view.offsetX - KEY_PAN_STEP },
      ArrowUp: { offsetY: view.offsetY + KEY_PAN_STEP },
      ArrowDown: { offsetY: view.offsetY - KEY_PAN_STEP },
      '+': { zoom: view.zoom + KEY_ZOOM_STEP },
      '=': { zoom: view.zoom + KEY_ZOOM_STEP },
      '-': { zoom: view.zoom - KEY_ZOOM_STEP },
      _: { zoom: view.zoom - KEY_ZOOM_STEP },
    }

    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    applyView({ ...view, ...move })
  }

  async function confirm() {
    const image = imageRef.current
    if (!image || viewport <= 0) return

    setBusy(true)
    setError(null)
    try {
      onConfirm(await cropToFile(image, view, viewport, file.name))
    } catch (problem) {
      console.error('Error cropping avatar:', problem)
      setError('That picture could not be prepared. Please try another.')
      setBusy(false)
    }
  }

  // Placed by hand rather than by `object-fit`: `cover` would decide the framing
  // itself, which is the whole thing the patient is here to do.
  const scale = natural ? (viewport / Math.min(natural.width, natural.height)) * view.zoom : 1
  const imageStyle: React.CSSProperties = natural
    ? {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: natural.width * scale,
        height: natural.height * scale,
        maxWidth: 'none',
        transform: `translate(calc(-50% + ${view.offsetX}px), calc(-50% + ${view.offsetY}px))`,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        pointerEvents: 'none',
        display: 'block',
      }
    : {}

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-cropper-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-modal)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-4)',
        background: 'rgba(31, 36, 33, 0.55)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="card animate-scaleIn"
        style={{
          width: '100%',
          maxWidth: '380px',
          background: 'var(--surface)',
          boxShadow: '0 16px 40px rgba(31, 36, 33, 0.32)',
        }}
      >
        <h2
          id="avatar-cropper-title"
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            color: 'var(--primary)',
            marginBottom: '2px',
          }}
        >
          Frame your picture
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 'var(--space-4)' }}>
          What you see in the circle is what everyone else will see.
        </p>

        <div
          ref={frameRef}
          tabIndex={0}
          role="application"
          aria-label="Picture framing. Drag to move, arrow keys to nudge, plus and minus to zoom."
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            margin: '0 auto',
            maxWidth: '300px',
            borderRadius: '50%',
            overflow: 'hidden',
            // The photo is dragged with a finger, so the browser must not also
            // read that finger as a scroll.
            touchAction: 'none',
            cursor: ready ? 'grab' : 'progress',
            background: 'var(--bg, #EAF5E6)',
            border: '2px solid rgba(74, 107, 90, 0.45)',
            boxShadow: 'inset 0 2px 12px rgba(38, 48, 42, 0.22)',
          }}
        >
          {url && natural && (
            // Plain <img>: the source is a local blob, which next/image cannot
            // optimize and would only copy.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" draggable={false} style={imageStyle} />
          )}
        </div>

        <label
          htmlFor="avatar-zoom"
          style={{
            display: 'block',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--ink)',
            margin: 'var(--space-4) 0 var(--space-1)',
          }}
        >
          Zoom
        </label>
        <input
          id="avatar-zoom"
          type="range"
          min={1}
          max={CROP_MAX_ZOOM}
          step={0.01}
          value={view.zoom}
          disabled={!ready || busy}
          onChange={(event) => applyView({ ...view, zoom: Number(event.target.value) })}
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />

        {error && (
          <p
            style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: '#C62828',
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-back">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!ready || busy}
            className="btn btn-primary"
            style={{ opacity: !ready || busy ? 0.7 : 1 }}
          >
            {busy ? 'Preparing...' : 'Use picture'}
          </button>
        </div>
      </div>
    </div>
  )
}
