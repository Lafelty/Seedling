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

        // Phase 2: the app's own facade against a synthetic camera stream —
        // exercises initDetector/detect exactly like the admin/session pages do.
        const { initDetector, detect, disposeDetector } = await import('@/lib/poseDetection')
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

        const ok = await initDetector('hand')
        log.push(`initDetector('hand'): ${ok}`)
        let detected = 0
        for (let i = 0; i < 3; i++) {
          ctx.drawImage(img, 0, 0, 640, 480) // keep stream frames flowing
          const pose = await detect(video, 'hand')
          log.push(`  detect #${i + 1}: ${pose ? `${pose.keypoints.length} kps, score=${pose.score?.toFixed(3)}, kp0.score=${pose.keypoints[0]?.score?.toFixed(3)}` : 'null'}`)
          if (pose) detected++
        }
        log.push(`facade video detections: ${detected}/3`)
        disposeDetector()
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
