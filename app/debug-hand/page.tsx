'use client'

// Temporary diagnostic page: runs the exact same MediaPipeHands tfjs-runtime
// detector the app uses against a static palm photo, printing the raw
// estimateHands output. Delete once hand tracking is confirmed working.

import { useEffect, useRef, useState } from 'react'

export default function DebugHandPage() {
  const [out, setOut] = useState('running…')
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    ;(async () => {
      const log: string[] = []
      try {
        const t0 = performance.now()
        const tf = await import('@tensorflow/tfjs-core')
        await import('@tensorflow/tfjs-backend-webgl')
        await import('@tensorflow/tfjs-backend-cpu')
        try {
          await tf.ready()
        } catch {
          await tf.setBackend('cpu')
          await tf.ready()
        }
        if (tf.getBackend() !== 'webgl' && tf.getBackend() !== 'cpu') {
          await tf.setBackend('cpu')
          await tf.ready()
        }
        log.push(`backend: ${tf.getBackend()}`)

        const hpd = await import('@tensorflow-models/hand-pose-detection')
        const detector = await hpd.createDetector(hpd.SupportedModels.MediaPipeHands, {
          runtime: 'tfjs',
          modelType: 'full',
          maxHands: 2,
        })
        log.push(`detector created in ${Math.round(performance.now() - t0)}ms`)

        const img = document.getElementById('handimg') as HTMLImageElement
        if (!img.complete) {
          await new Promise((resolve, reject) => {
            img.onload = resolve
            img.onerror = () => reject(new Error('image failed to load'))
          })
        }
        log.push(`image: ${img.naturalWidth}x${img.naturalHeight}`)

        const t1 = performance.now()
        const hands = await detector.estimateHands(img)
        log.push(`estimateHands: ${Math.round(performance.now() - t1)}ms`)
        log.push(`hands detected: ${hands.length}`)
        for (const h of hands) {
          log.push(
            `  score=${h.score?.toFixed(3)} handedness=${h.handedness} keypoints=${h.keypoints?.length}`
          )
          log.push(
            `  wrist=${JSON.stringify(h.keypoints?.[0])}`
          )
          log.push(
            `  names ok: ${['wrist', 'thumb_cmc', 'pinky_finger_tip'].every((n) =>
              h.keypoints?.some((k: any) => k.name === n)
            )}`
          )
        }
        detector.dispose()

        // Phase 2: lite model on a synthetic video, with the depthwise-conv
        // packing flag toggled — isolates the NaN-coordinate bug.
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, 640, 480)
        const stream = canvas.captureStream(30)
        const video = document.createElement('video')
        video.srcObject = stream
        video.muted = true
        await video.play()
        await new Promise((r) => setTimeout(r, 300))
        log.push(`video: ${video.videoWidth}x${video.videoHeight} readyState=${video.readyState}`)

        const run = async (label: string, modelType: 'full' | 'lite', input: any, staticImageMode?: boolean) => {
          const d = await hpd.createDetector(hpd.SupportedModels.MediaPipeHands, {
            runtime: 'tfjs',
            modelType,
            maxHands: 1,
          })
          let k0: any = null
          let n = 0
          for (let i = 0; i < 3; i++) {
            ctx.drawImage(img, 0, 0, 640, 480)
            const cfg = staticImageMode === undefined ? undefined : { staticImageMode }
            const hands = await d.estimateHands(input, cfg)
            n = hands?.[0]?.keypoints?.length ?? 0
            k0 = hands?.[0]?.keypoints?.[0] ?? null
          }
          d.dispose()
          log.push(`${label}: n=${n} kp0=${k0 ? `(${Math.round(k0.x)},${Math.round(k0.y)})` : 'none'} nan=${k0 ? Number.isNaN(k0.x) : 'n/a'}`)
        }

        await run('lite+video', 'lite', video)

        // The fix: copy the current video frame onto a canvas and detect on that.
        const off = document.createElement('canvas')
        off.width = 640
        off.height = 480
        const octx = off.getContext('2d')!
        const dLite = await hpd.createDetector(hpd.SupportedModels.MediaPipeHands, {
          runtime: 'tfjs', modelType: 'lite', maxHands: 1,
        })
        let ck0: any = null
        for (let i = 0; i < 3; i++) {
          ctx.drawImage(img, 0, 0, 640, 480)
          octx.drawImage(video, 0, 0, 640, 480)
          const hands = await dLite.estimateHands(off)
          ck0 = hands?.[0]?.keypoints?.[0] ?? null
        }
        dLite.dispose()
        log.push(`lite+canvas-from-video: kp0=${ck0 ? `(${Math.round(ck0.x)},${Math.round(ck0.y)})` : 'none'} nan=${ck0 ? Number.isNaN(ck0.x) : 'n/a'}`)
        setOut('RESULT\n' + log.join('\n'))
      } catch (e: any) {
        setOut('ERROR\n' + log.join('\n') + '\n' + (e?.message || String(e)) + '\n' + (e?.stack || ''))
      }
    })()
  }, [])

  return (
    <div style={{ padding: 20, fontFamily: 'monospace' }}>
      <img id="handimg" src="/debug-hand.jpg" alt="test hand" style={{ maxWidth: 400, display: 'block' }} />
      <pre id="debug-out" style={{ whiteSpace: 'pre-wrap' }}>{out}</pre>
    </div>
  )
}
