'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  initDetector,
  detect,
  disposeDetector,
  deriveCriteriaFromRecordings,
  connectionsForMode,
  trimIdleFrames,
  type TrackingMode,
  type Pose,
} from '@/lib/poseDetection'

type RecordingState = 'setup' | 'countdown' | 'recording' | 'reviewing' | 'saving' | 'processing'

interface RecordedFrame {
  timestamp: number
  pose: Pose
}

interface RecordedDemo {
  id: string
  frames: RecordedFrame[]
  duration: number
  recordedAt: Date
  source?: 'camera' | 'upload'
}

export default function NewExercisePage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)
  const recordingStartTime = useRef<number>(0)

  // Uploaded-video processing: hidden video element frames are seeked through
  // one by one and fed to the same detector as the live camera.
  const processVideoRef = useRef<HTMLVideoElement>(null)
  const processCanvasRef = useRef<HTMLCanvasElement>(null)
  const cancelProcessRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [recordingState, setRecordingState] = useState<RecordingState>('setup')
  const [countdown, setCountdown] = useState(3)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [recordings, setRecordings] = useState<RecordedDemo[]>([])
  const [processProgress, setProcessProgress] = useState(0)
  // Live captured-pose count shown in the processing overlay — lets the
  // therapist see coverage building instead of trusting a bare percentage.
  const [processFrameCount, setProcessFrameCount] = useState(0)
  // True when the detector currently sees nothing — drives the framing hint.
  // Updated only on transitions (see the detect loop), never per frame.
  const [noSubject, setNoSubject] = useState(false)
  const noSubjectRef = useRef(false)

  // Captured frames live in a ref, not state: appending to a growing state array
  // every animation frame re-rendered the whole page 30×/s (O(n²) copies), which
  // was the recording lag. The ref is drained in stopRecording.
  const recordedFramesRef = useRef<RecordedFrame[]>([])
  // Lets the detect loop read the live recording state without re-subscribing.
  const recordingStateRef = useRef<RecordingState>(recordingState)
  useEffect(() => {
    recordingStateRef.current = recordingState
  }, [recordingState])

  // Exercise metadata
  const [exerciseName, setExerciseName] = useState('')
  const [exerciseDescription, setExerciseDescription] = useState('')
  const [exerciseType, setExerciseType] = useState<'static' | 'dynamic'>('dynamic')
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner')
  // Locked once demos exist — mixed-mode demos would corrupt derivation.
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('body')
  // False while the mode's model is downloading — no keypoints until then.
  const [modelReady, setModelReady] = useState(false)

  // Camera setup
  useEffect(() => {
    let stream: MediaStream | null = null

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 640,
            height: 480,
            facingMode: 'user',
          },
        })

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (error) {
        console.error('Camera error:', error)
        setCameraError('Camera access denied')
      }
    }

    startCamera()

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // Detector lifecycle — separate from the camera so switching tracking mode
  // swaps models (the facade disposes the other model before loading).
  useEffect(() => {
    let cancelled = false
    setModelReady(false)

    ;(async () => {
      const success = await initDetector(trackingMode)
      if (cancelled) return
      if (success) {
        setModelReady(true)
      } else {
        setCameraError('Failed to load pose detection model')
      }
    })()

    return () => {
      cancelled = true
      cancelProcessRef.current = true // abort any video-file processing using this detector
      disposeDetector()
    }
  }, [trackingMode])

  // Pose detection loop — runs a live preview as soon as the model is ready
  // (including during setup, so hand users can frame their hand before recording).
  useEffect(() => {
    if (!modelReady) return

    let isRunning = true
    // Cap detection to ~25 fps. The models can't run faster than this per frame
    // anyway, and pinning rAF to 60 fps just starves the rest of the page.
    const DETECT_INTERVAL_MS = 40
    let lastDetectAt = 0

    const detectLoop = async (now = 0) => {
      if (!isRunning) return
      const video = videoRef.current

      // Paused while a video file is being processed: the detector is single-file
      // (the worker drops overlapping calls), so interleaved camera frames would
      // corrupt the extracted poses.
      if (
        video &&
        video.readyState >= 2 &&
        now - lastDetectAt >= DETECT_INTERVAL_MS &&
        recordingStateRef.current !== 'processing'
      ) {
        lastDetectAt = now
        const pose = await detect(video, trackingMode)
        if (!isRunning) return // disposed while awaiting the detector

        if (recordingStateRef.current === 'recording' && pose) {
          recordedFramesRef.current.push({
            timestamp: Date.now() - recordingStartTime.current,
            pose,
          })
        }

        if (pose) {
          drawSkeleton(pose)
        } else {
          clearSkeleton()
        }

        // Re-render only when visibility flips, not every frame.
        if (!pose !== noSubjectRef.current) {
          noSubjectRef.current = !pose
          setNoSubject(!pose)
        }
      }

      animationFrameRef.current = requestAnimationFrame(detectLoop)
    }

    animationFrameRef.current = requestAnimationFrame(detectLoop)

    return () => {
      isRunning = false
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [modelReady, trackingMode])

  // Countdown before recording
  useEffect(() => {
    if (recordingState !== 'countdown') return

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          setRecordingState('recording')
          recordingStartTime.current = Date.now()
          recordedFramesRef.current = []
          return 3
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [recordingState])

  // Wipe the overlay when the detector loses the subject, so a stale skeleton
  // doesn't freeze on screen.
  const clearSkeleton = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
  }

  // Draw one keypoint set (dots + bones) in the given colour.
  const drawKeypointSet = (
    ctx: CanvasRenderingContext2D,
    keypoints: Pose['keypoints'],
    color: string
  ) => {
    // Dots — smaller in hand mode (21 points in a small area)
    keypoints.forEach((kp) => {
      if (kp.score && kp.score > 0.3) {
        ctx.beginPath()
        ctx.arc(kp.x, kp.y, trackingMode === 'hand' ? 3 : 5, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
      }
    })

    // Bones
    connectionsForMode(trackingMode).forEach(([startName, endName]) => {
      const start = keypoints.find((kp) => kp.name === startName)
      const end = keypoints.find((kp) => kp.name === endName)
      if (start && end && start.score && start.score > 0.3 && end.score && end.score > 0.3) {
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.stroke()
      }
    })
  }

  const drawSkeleton = (pose: Pose) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Match canvas size to video
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Red while recording, green otherwise. Read from the ref because the detect
    // loop is not re-created on recording-state changes.
    const color = recordingStateRef.current === 'recording' ? '#ef4444' : '#10b981'

    // Primary hand/body plus any additional detected hands (hand mode).
    drawKeypointSet(ctx, pose.keypoints, color)
    pose.extraHands?.forEach((h) => drawKeypointSet(ctx, h.keypoints, color))
  }

  const startRecording = () => {
    setRecordingState('countdown')
    setCountdown(3)
  }

  const stopRecording = () => {
    const rawFrames = recordedFramesRef.current
    if (rawFrames.length === 0) {
      alert('No frames recorded. Try again.')
      setRecordingState('setup')
      return
    }

    // Cut the idle seconds before the movement starts and after it ends —
    // dead frames drag the derived rest pose and tolerances toward "standing
    // still". Static holds come back untouched.
    const frames = trimIdleFrames(rawFrames, trackingMode)

    const demo: RecordedDemo = {
      id: `demo-${Date.now()}`,
      frames: [...frames],
      duration: frames[frames.length - 1].timestamp,
      recordedAt: new Date(),
      source: 'camera',
    }

    setRecordings((prev) => [...prev, demo])
    recordedFramesRef.current = []
    setRecordingState('reviewing')
  }

  // Seek and resolve once the frame is actually decoded. Only used to force
  // Infinity-duration webm files to reveal their real length before playback.
  // Skips the wait if the video is already at the target time (setting
  // currentTime to its current value never fires `seeked` in some browsers).
  const seekTo = (video: HTMLVideoElement, t: number) =>
    new Promise<void>((resolve, reject) => {
      if (Math.abs(video.currentTime - t) < 0.001 && video.readyState >= 2) {
        resolve()
        return
      }
      const cleanup = () => {
        video.removeEventListener('seeked', onSeeked)
        video.removeEventListener('error', onError)
      }
      const onSeeked = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error('Video seek failed'))
      }
      video.addEventListener('seeked', onSeeked)
      video.addEventListener('error', onError)
      video.currentTime = t
    })

  // Skeleton preview while a video file is processed — same drawing as the live
  // camera but on the (unmirrored) processing canvas.
  const drawProcessedFrame = (pose: Pose, video: HTMLVideoElement) => {
    const canvas = processCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawKeypointSet(ctx, pose.keypoints, '#10b981')
    pose.extraHands?.forEach((h) => drawKeypointSet(ctx, h.keypoints, '#10b981'))
  }

  // Without this, the last detected skeleton freezes on screen through any
  // stretch of the video where the subject is not found.
  const clearProcessedFrame = () => {
    const canvas = processCanvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  // Step through the uploaded video frame by frame: on every presented frame
  // (requestVideoFrameCallback; rAF sampling as fallback) playback is PAUSED,
  // the frame runs through the detector, then playback resumes. The video waits
  // for the detector instead of racing it, so capture is lossless and the same
  // video yields the same frames on every run and every machine — a pure
  // realtime capture silently skipped whatever presented while inference was
  // busy, which made frame counts swing wildly between runs (background-tab
  // throttling or a slow moment could drop most of the video).
  const captureFramesFromPlayback = (
    video: HTMLVideoElement,
    duration: number
  ): Promise<RecordedFrame[]> =>
    new Promise((resolve, reject) => {
      const frames: RecordedFrame[] = []
      // Hand-tracker clock: base + media time. Monotonic with the camera
      // preview's performance.now() clock (media time can only lag wall time),
      // and frames arrive spaced by true video time, so the tracker sees the
      // movement at its real speed regardless of inference speed.
      const tsBase = performance.now()
      // Cap capture at ~33 fps so 60 fps sources don't double the demo size.
      const MIN_FRAME_GAP_S = 0.03
      let busy = false
      let done = false
      let lastCapturedTime = -1
      let vfcHandle = 0
      let rafHandle = 0
      let lastSampledTime = -1

      // rVFC is in every evergreen browser; the cast keeps TS happy on older libs.
      const v = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number
        cancelVideoFrameCallback?: (handle: number) => void
      }
      const hasVFC = typeof v.requestVideoFrameCallback === 'function'

      const cleanup = () => {
        if (hasVFC && vfcHandle) v.cancelVideoFrameCallback?.(vfcHandle)
        if (rafHandle) cancelAnimationFrame(rafHandle)
        clearInterval(watchdog)
        video.removeEventListener('ended', onEnded)
        video.removeEventListener('error', onError)
        document.removeEventListener('visibilitychange', onVisibility)
        video.pause()
      }
      const finish = () => {
        if (done) return
        done = true
        // Let an in-flight detection land before resolving so the tail of the
        // movement isn't cut off.
        const settle = () => (busy ? setTimeout(settle, 30) : (cleanup(), resolve(frames)))
        settle()
      }
      const fail = (err: Error) => {
        if (done) return
        done = true
        cleanup()
        reject(err)
      }

      // Resume playback only when nothing is holding it: not mid-inference, not
      // canceled, not finished, not in a hidden tab, not already at the end.
      const maybeResume = () => {
        if (done || busy || cancelProcessRef.current) return
        if (document.visibilityState === 'hidden') return
        // play() after `ended` would loop back to the start and re-capture.
        if (!video.ended && video.paused) video.play().catch(() => {})
      }
      // Hidden tabs stop rVFC/rAF entirely while the video would keep playing —
      // pause so no content passes unobserved, resume on return.
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') video.pause()
        else maybeResume()
      }

      const handleFrame = async (mediaTime: number) => {
        if (done || cancelProcessRef.current) return
        setProcessProgress(duration > 0 ? Math.min(mediaTime / duration, 1) : 0)
        if (busy) return // safety net — playback is paused during inference
        if (mediaTime - lastCapturedTime < MIN_FRAME_GAP_S) return
        busy = true
        // Freeze the presented frame until its inference lands — this is what
        // guarantees no frame slips past a slow detector. It also pins the
        // element on exactly the frame the timestamp refers to.
        video.pause()
        try {
          const pose = await detect(video, trackingMode, tsBase + mediaTime * 1000)
          // `done` alone doesn't bail here: when `ended` fires mid-inference,
          // finish() waits on `busy`, so this last pose can still be recorded.
          if (cancelProcessRef.current) return
          lastCapturedTime = mediaTime
          if (pose) {
            frames.push({ timestamp: Math.round(mediaTime * 1000), pose })
            setProcessFrameCount(frames.length)
            drawProcessedFrame(pose, video)
          } else {
            clearProcessedFrame()
          }
        } finally {
          busy = false
          maybeResume()
        }
      }

      const onVFC = (_now: number, meta: { mediaTime: number }) => {
        if (done) return
        void handleFrame(meta.mediaTime)
        vfcHandle = v.requestVideoFrameCallback!(onVFC)
      }
      const onRAF = () => {
        if (done) return
        if (video.currentTime !== lastSampledTime) {
          lastSampledTime = video.currentTime
          void handleFrame(video.currentTime)
        }
        rafHandle = requestAnimationFrame(onRAF)
      }

      const onEnded = () => finish()
      const onError = () => fail(new Error('Video playback failed'))
      // Cancel must work even if playback stalls and no more frames ever fire.
      const watchdog = setInterval(() => {
        if (cancelProcessRef.current) finish()
      }, 200)

      video.addEventListener('ended', onEnded)
      video.addEventListener('error', onError)
      document.addEventListener('visibilitychange', onVisibility)

      video.currentTime = 0
      video.playbackRate = 1
      video
        .play()
        .then(() => {
          if (hasVFC) vfcHandle = v.requestVideoFrameCallback!(onVFC)
          else rafHandle = requestAnimationFrame(onRAF)
        })
        .catch(() => fail(new Error('Could not start video playback')))
    })

  // Extract poses from an uploaded video by playing it through the same
  // detector as the live camera, then feed the result through the identical
  // trim + demo pipeline.
  const processVideoFile = async (file: File) => {
    const video = processVideoRef.current
    if (!video || !modelReady) return

    const returnState: RecordingState = recordings.length > 0 ? 'reviewing' : 'setup'
    cancelProcessRef.current = false
    setProcessProgress(0)
    setProcessFrameCount(0)
    setRecordingState('processing')
    // Let the camera detect loop see the state change and drain any in-flight
    // detection — otherwise the first extracted frame can get a stale camera pose.
    await new Promise((r) => setTimeout(r, 150))

    const url = URL.createObjectURL(file)
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onLoaded)
          video.removeEventListener('error', onError)
        }
        const onLoaded = () => {
          cleanup()
          resolve()
        }
        const onError = () => {
          cleanup()
          reject(new Error('Could not read this video file'))
        }
        video.addEventListener('loadedmetadata', onLoaded)
        video.addEventListener('error', onError)
        video.src = url
        video.load()
      })

      // MediaRecorder-produced webm files report Infinity until forced to the
      // end once — seek far past the end to make the real duration appear.
      if (!isFinite(video.duration)) {
        await seekTo(video, 1e7)
        await seekTo(video, 0)
      }

      const duration = video.duration
      if (!isFinite(duration) || duration <= 0) {
        throw new Error('Could not determine video length')
      }
      const MAX_DURATION_S = 120
      if (duration > MAX_DURATION_S) {
        alert(
          `Video is ${Math.round(duration)}s long — please use a clip under ${MAX_DURATION_S}s (a few repetitions is enough).`
        )
        setRecordingState(returnState)
        return
      }

      const frames = await captureFramesFromPlayback(video, duration)
      if (cancelProcessRef.current) {
        setRecordingState(returnState)
        return
      }

      if (frames.length === 0) {
        alert(
          trackingMode === 'hand'
            ? 'No hand detected in this video. Make sure the hand is clearly visible and well lit.'
            : 'No body detected in this video. Make sure the full upper body is visible and well lit.'
        )
        setRecordingState(returnState)
        return
      }

      const trimmed = trimIdleFrames(frames, trackingMode)
      const demo: RecordedDemo = {
        id: `demo-${Date.now()}`,
        frames: [...trimmed],
        duration: trimmed[trimmed.length - 1].timestamp,
        recordedAt: new Date(),
        source: 'upload',
      }
      setRecordings((prev) => [...prev, demo])
      setRecordingState('reviewing')
    } catch (error) {
      console.error('Video processing error:', error)
      alert(error instanceof Error ? error.message : 'Failed to process video')
      setRecordingState(returnState)
    } finally {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (file) processVideoFile(file)
  }

  const deleteRecording = (id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id))
  }

  const saveExercise = async () => {
    if (!exerciseName.trim()) {
      alert('Please enter an exercise name')
      return
    }

    if (recordings.length === 0) {
      alert('Please record at least one demonstration')
      return
    }

    setRecordingState('saving')

    try {
      const supabase = createClient()

      // Derive working validation criteria straight from the recordings —
      // target angles, tolerance bands, and reference points the therapist
      // can review in the editor instead of typing degrees from scratch.
      const derivedCriteria = deriveCriteriaFromRecordings(recordings, trackingMode)

      const { data, error } = await supabase.from('exercises').insert({
        name: exerciseName,
        description: exerciseDescription || null,
        exercise_type: exerciseType,
        difficulty: difficulty,
        tracking_mode: trackingMode,
        recorded_paths: recordings.map((r) => ({
          id: r.id,
          frames: r.frames,
          duration: r.duration,
          recordedAt: r.recordedAt.toISOString(),
        })),
        pose_criteria: {
          ...derivedCriteria,
          // Legacy field older rows used before targetBodyParts existed.
          detectedMovingParts: derivedCriteria.targetBodyParts,
          needsRefinement: derivedCriteria.criteria.length === 0,
          autoDetectedAt: new Date().toISOString(),
        },
        is_active: false, // Draft until reviewed and published in the editor
      })
        .select('id')
        .single()

      if (error) throw error

      // Straight into the editor: criteria are already auto-filled there, so the
      // therapist reviews, tests, and publishes without hunting through the admin list.
      router.push(`/admin/exercises/${data.id}/edit`)
    } catch (error) {
      console.error('Save error:', error)
      alert('Failed to save exercise')
      setRecordingState('reviewing')
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F4EF] p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link
              href="/admin"
              className="text-sm text-[#5C635D] hover:text-[#C4612F] mb-2 inline-block"
            >
              ← Back to Admin
            </Link>
            <h1 className="text-3xl font-serif text-[#1F2421]">
              Record New <em className="text-[#C4612F]">Exercise</em>
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Camera + Skeleton View */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <div className="relative aspect-video bg-[#1F2421] rounded-xl overflow-hidden">
                {cameraError ? (
                  <div className="absolute inset-0 flex items-center justify-center text-white">
                    <p>{cameraError}</p>
                  </div>
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                      playsInline
                    />
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                    />

                    {/* Model status — no keypoints can appear until this clears */}
                    {!modelReady && (
                      <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/70 text-white px-3 py-1 rounded-full">
                        <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                        <span className="text-sm">
                          Loading {trackingMode === 'hand' ? 'hand' : 'pose'} model…
                        </span>
                      </div>
                    )}
                    {modelReady && recordingState !== 'recording' && (
                      <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/70 text-white px-3 py-1 rounded-full">
                        <div className="w-2 h-2 bg-green-400 rounded-full" />
                        <span className="text-sm">
                          {trackingMode === 'hand' ? 'Hand' : 'Pose'} model ready
                        </span>
                      </div>
                    )}

                    {/* Recording indicator */}
                    {recordingState === 'recording' && (
                      <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded-full">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                        <span className="text-sm font-medium">Recording</span>
                      </div>
                    )}

                    {/* Countdown overlay */}
                    {recordingState === 'countdown' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60">
                        <span className="text-sm font-medium uppercase tracking-[0.2em] text-white/80">
                          Get ready
                        </span>
                        {/* key forces remount each tick so the pop replays 3 → 2 → 1 */}
                        <div
                          key={countdown}
                          className="animate-countdownPop flex h-32 w-32 items-center justify-center rounded-full border-4 border-white/40 text-7xl font-bold text-white"
                        >
                          {countdown}
                        </div>
                      </div>
                    )}

                    {/* Uploaded-video processing view — mounted always so the ref
                        exists before processing starts, shown only while active */}
                    <div
                      className={`absolute inset-0 z-10 bg-[#1F2421] ${
                        recordingState === 'processing' ? '' : 'hidden'
                      }`}
                    >
                      <video
                        ref={processVideoRef}
                        className="absolute inset-0 w-full h-full object-contain"
                        muted
                        playsInline
                        preload="auto"
                      />
                      <canvas
                        ref={processCanvasRef}
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                      <div className="absolute inset-x-4 bottom-4 rounded-xl bg-black/70 p-3 text-white">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <span className="text-sm">
                            Analyzing video… {Math.round(processProgress * 100)}%
                            {processFrameCount > 0 && ` • ${processFrameCount} poses`}
                          </span>
                          <button
                            onClick={() => {
                              cancelProcessRef.current = true
                            }}
                            className="text-sm text-red-300 hover:text-red-200"
                          >
                            Cancel
                          </button>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/20 overflow-hidden">
                          <div
                            className="h-full bg-[#10b981] transition-[width] duration-150"
                            style={{ width: `${processProgress * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Framing hint — shown only while the detector sees nothing */}
                    {modelReady &&
                      noSubject &&
                      recordingState !== 'reviewing' &&
                      recordingState !== 'saving' &&
                      recordingState !== 'processing' && (
                        <div className="absolute inset-x-4 bottom-4 flex items-center justify-center bg-black/70 text-white px-4 py-2 rounded-xl text-center">
                          <span className="text-sm">
                            {trackingMode === 'hand'
                              ? 'No hand detected — hold your open hand up to the camera, palm facing it, about 30–40 cm away.'
                              : 'No body detected — step back so your head and shoulders are in frame.'}
                          </span>
                        </div>
                      )}
                  </>
                )}
              </div>

              {/* Recording controls */}
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelected}
                className="hidden"
              />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
                {recordingState === 'setup' && (
                  <>
                    <button
                      onClick={startRecording}
                      className="px-6 py-3 bg-[#C4612F] hover:bg-[#A94E22] text-white rounded-full font-medium transition-colors"
                    >
                      Start Recording Demo
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!modelReady}
                      className="px-6 py-3 bg-white text-[#C4612F] border border-[#C4612F] hover:bg-[#F2E3D6] rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Upload Video Instead
                    </button>
                  </>
                )}

                {(recordingState === 'countdown' || recordingState === 'recording') && (
                  <button
                    onClick={stopRecording}
                    className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-full font-medium transition-colors"
                  >
                    Stop Recording
                  </button>
                )}

                {recordingState === 'reviewing' && (
                  <>
                    {recordings.length < 2 && (
                      <p className="w-full text-sm text-[#C4612F] font-medium">
                        Tip: record 2–3 demos — tolerances are derived from your own
                        variation between takes, so validation fits real movement better.
                      </p>
                    )}
                    <button
                      onClick={() => setRecordingState('setup')}
                      className="px-6 py-3 bg-[#C4612F] hover:bg-[#A94E22] text-white rounded-full font-medium transition-colors"
                    >
                      Record Another Demo
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!modelReady}
                      className="px-6 py-3 bg-white text-[#C4612F] border border-[#C4612F] hover:bg-[#F2E3D6] rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Upload Video
                    </button>
                    <button
                      onClick={saveExercise}
                      disabled={recordings.length === 0}
                      className="px-6 py-3 bg-[#10b981] hover:bg-[#059669] text-white rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save Exercise ({recordings.length} demo{recordings.length !== 1 ? 's' : ''})
                    </button>
                  </>
                )}

                {recordingState === 'saving' && (
                  <div className="px-6 py-3 text-[#5C635D]">Saving...</div>
                )}
              </div>
            </div>
          </div>

          {/* Exercise Metadata Form */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <h2 className="text-xl font-serif text-[#1F2421] mb-4">Exercise Details</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#1F2421] mb-1">
                    Tracking Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: 'body', label: 'Body pose' },
                      { value: 'hand', label: 'Hand — finger & grip' },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setTrackingMode(opt.value)}
                        disabled={recordings.length > 0 || recordingState === 'processing'}
                        className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          trackingMode === opt.value
                            ? 'bg-[#C4612F] text-white border-[#C4612F]'
                            : 'bg-white text-[#1F2421] border-[#E7E1D7] hover:border-[#C4612F]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {recordings.length > 0 && (
                    <p className="text-[11px] text-[#5C635D] mt-1">
                      Delete all demos to change the tracking mode.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#1F2421] mb-1">
                    Exercise Name *
                  </label>
                  <input
                    type="text"
                    value={exerciseName}
                    onChange={(e) => setExerciseName(e.target.value)}
                    placeholder="e.g. Shoulder Raise"
                    className="w-full px-3 py-2 border border-[#E7E1D7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C4612F]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#1F2421] mb-1">
                    Description
                  </label>
                  <textarea
                    value={exerciseDescription}
                    onChange={(e) => setExerciseDescription(e.target.value)}
                    placeholder="Brief description of the exercise"
                    rows={3}
                    className="w-full px-3 py-2 border border-[#E7E1D7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C4612F]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#1F2421] mb-1">
                    Exercise Type
                  </label>
                  <select
                    value={exerciseType}
                    onChange={(e) => setExerciseType(e.target.value as 'static' | 'dynamic')}
                    className="w-full px-3 py-2 border border-[#E7E1D7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C4612F]"
                  >
                    <option value="dynamic">Dynamic (with movement)</option>
                    <option value="static">Static (hold position)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#1F2421] mb-1">
                    Difficulty
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) =>
                      setDifficulty(e.target.value as 'beginner' | 'intermediate' | 'advanced')
                    }
                    className="w-full px-3 py-2 border border-[#E7E1D7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C4612F]"
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Recorded Demos List */}
            {recordings.length > 0 && (
              <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
                <h2 className="text-xl font-serif text-[#1F2421] mb-4">
                  Recorded Demos ({recordings.length})
                </h2>
                <div className="space-y-2">
                  {recordings.map((demo, i) => (
                    <div
                      key={demo.id}
                      className="flex items-center justify-between p-3 bg-[#F7F4EF] rounded-lg"
                    >
                      <div>
                        <p className="text-sm font-medium text-[#1F2421]">
                          Demo {i + 1}
                          {demo.source === 'upload' && (
                            <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-[#5C635D] bg-white border border-[#E7E1D7] rounded-full px-2 py-0.5">
                              from video
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-[#5C635D]">
                          {(demo.duration / 1000).toFixed(1)}s • {demo.frames.length} frames
                        </p>
                      </div>
                      <button
                        onClick={() => deleteRecording(demo.id)}
                        className="text-red-600 hover:text-red-700 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="bg-[#F2E3D6] rounded-2xl p-4 border border-[#E7E1D7]">
              <h3 className="text-sm font-medium text-[#1F2421] mb-2">Instructions</h3>
              <ol className="text-xs text-[#5C635D] space-y-1 list-decimal list-inside">
                <li>Fill in exercise details</li>
                <li>Record 2-3 demonstrations — or upload a video of the movement</li>
                <li>System derives target angles and tolerances from your movement</li>
                <li>Review the auto-filled criteria in the editor, then publish</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
