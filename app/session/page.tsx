'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SessionClock } from '@/lib/sessionClock'
import { forgetSessionResult, pendingSessionResults, retainSessionResult, saveSessionResult, type SessionResult } from '@/lib/sessionResult'
import { recordCompletion, getProgress, setProgressUid } from '@/lib/progress'
import { getGardenStage, getGardenStageName, getGardenImagePath, getStarsToNextBloom, getGardenProgressPercent } from '@/lib/garden'
import { playRepChime, playCompletionFanfare, vibrate } from '@/lib/rewardFx'
import confetti from 'canvas-confetti'
import { createClient } from '@/lib/supabase/client'
import {
  initDetector,
  detect,
  analyzeExercise,
  subjectInFrame,
  createRepCounter,
  isCyclicExercise,
  disposeDetector,
  pickReferencePose,
  buildGuideFrames,
  connectionsForMode,
  anchorPairForMode,
  canonicalFrameSize,
  type RepCounter,
  type TrackingMode,
  type Pose,
  type ExerciseAnalysis,
  type CyclePhase,
} from '@/lib/poseDetection'
import {
  createTrajectoryTracker,
  type TrajectoryTracker,
  type TrajectoryScore,
} from '@/lib/trajectory'
import type { ExerciseRow } from '@/lib/supabase/types'

type SessionState = 'loading' | 'ready' | 'starting' | 'countdown' | 'active' | 'paused' | 'completed'
type PostureFeedback = 'good' | 'adjust' | 'analyzing'

interface RepData {
  id: string
  repNumber: number
  holdDuration: number
  formScore: number
  timestamp: Date
}

/** Snapshot taken at completion time so the reward screen can celebrate
 *  exactly what this session changed (streak, new garden bloom, tree stage). */
interface SessionReward {
  totalStars: number
  streak: number
  reps: number
  durationSeconds: number
  /** Garden stage just reached, or null when no new element was revealed. */
  newGardenStage: number | null
  /** Tree stage just reached, or null when the tree did not level up. */
  newTreeStage: string | null
}

// Exactly the columns the session query selects, derived from the schema.
type Exercise = Pick<
  ExerciseRow,
  | 'id'
  | 'name'
  | 'description'
  | 'exercise_type'
  | 'pose_criteria'
  | 'target_reps'
  | 'hold_duration_ms'
  | 'feedback_messages'
  | 'recorded_paths'
  | 'tracking_mode'
  | 'demo_images'
>

export default function SessionPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 })
  const mountedRef = useRef(false)
  const repCounterRef = useRef<RepCounter | null>(null)
  // DTW path scoring for cyclic exercises — null when the exercise has no
  // usable demo curves (feature silently off).
  const trajectoryRef = useRef<TrajectoryTracker | null>(null)
  const prevPhaseRef = useRef<CyclePhase | null>(null)
  // Ordered rest->target poses of the recorded movement; the guide skeleton is
  // posed at guideStepsRef.current[round(p * (len-1))] for a position p in [0,1].
  const guideStepsRef = useRef<Pose[]>([])
  const animationFrameRef = useRef<number | undefined>(undefined)
  // completeSession() is fired from the detection loop; this makes it one-shot
  // so a stray frame can never double-save the session or its rep rows.
  const completingRef = useRef(false)
  const activeRef = useRef(false)
  const cameraReadyRef = useRef(false)
  const userIdRef = useRef<string | null>(null)
  const sessionClockRef = useRef(new SessionClock())
  const pendingResultRef = useRef<SessionResult | null>(null)
  const [pendingResult, setPendingResult] = useState<SessionResult | null>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [retained, setRetained] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  // Exercise state
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [exerciseLoading, setExerciseLoading] = useState(true)

  // Session tracking state
  const lastFrameTime = useRef<number>(Date.now())

  // Refs mirror session values so the detection loop and completeSession never
  // read stale state captured in the (rarely re-run) effect closure.
  const sessionIdRef = useRef<string | null>(null)
  const repCountRef = useRef(0)
  const repDataListRef = useRef<RepData[]>([])
  const goodPostureTimeRef = useRef(0) // ms in "good" posture
  const totalActiveTimeRef = useRef(0) // ms in active state

  const [repCount, setRepCount] = useState(0)
  const [sessionState, setSessionState] = useState<SessionState>('loading')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [postureFeedback, setPostureFeedback] = useState<PostureFeedback>('analyzing')
  const [feedbackMessage, setFeedbackMessage] = useState('Reading your movement...')
  const [countdown, setCountdown] = useState(3)
  const [showExitPrompt, setShowExitPrompt] = useState(false)
  const [detectedPose, setDetectedPose] = useState<Pose | null>(null)
  const [isDetecting, setIsDetecting] = useState(false)
  const [repJustCompleted, setRepJustCompleted] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  // Continuous 0..1 position of the primary joint along the movement (rest→top).
  // Drives the live progress ring — the "it's tracking me" signal that a single
  // extreme-band check can't give.
  const [movementProgress, setMovementProgress] = useState(0)
  // Last rep's DTW path-match result, shown as a badge until the next rep.
  const [pathScore, setPathScore] = useState<TrajectoryScore | null>(null)
  const [holdMissed, setHoldMissed] = useState(false)
  // One spoken "now lower" cue per earned hold (cycle exercises)
  const holdCueSpokenRef = useRef(false)
  // Therapist's recorded target pose, drawn as a ghost skeleton to match
  const [ghostPose, setGhostPose] = useState<Pose | null>(null)
  // Live guide skeleton — the recorded movement posed by the patient's phase so
  // it leads them (sweeps up at rest, holds at the top, returns on the way down).
  const [guidePose, setGuidePose] = useState<Pose | null>(null)
  const [shouldersVisible, setShouldersVisible] = useState(true)
  const [hasSpoken, setHasSpoken] = useState(false)
  const [instructionBoxPos, setInstructionBoxPos] = useState({ x: 0, y: 0 })
  const [isDraggingBox, setIsDraggingBox] = useState(false)
  const [boxDragStart, setBoxDragStart] = useState({ x: 0, y: 0 })
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [reward, setReward] = useState<SessionReward | null>(null)


  const TARGET_REPS = exercise?.target_reps ?? 10
  const mode: TrackingMode = exercise?.tracking_mode ?? 'body'

  // Load exercise from database
  useEffect(() => {
    let cancelled = false
    mountedRef.current = true
    async function loadExercise() {
      try {
        const supabase = createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (cancelled) return
        if (!user) {
          router.replace('/login')
          return
        }
        userIdRef.current = user.id
        setProgressUid(user.id)
        const recoveryId = new URLSearchParams(window.location.search).get('recover')
        if (recoveryId) {
          const pending = pendingSessionResults(user.id).find(result => result.sessionId === recoveryId)
          if (!pending) {
            setCameraError('This session is no longer waiting to save. Return to your garden to check your progress.')
            return
          }
          pendingResultRef.current = pending
          setPendingResult(pending)
          sessionIdRef.current = pending.sessionId
          repCountRef.current = pending.reps.length
          setRepCount(pending.reps.length)
          setRetained(true)
          setSaveError('This session is waiting to sync. Retry saving when you are connected.')
          setSessionState('completed')
          return
        }

        // /levels passes ?exercise=<id>; without it fall back to the most
        // recent active exercise (classic single-exercise session).
        const requestedId = new URLSearchParams(window.location.search).get('exercise')

        let query = supabase
          .from('exercises')
          .select('id, name, description, exercise_type, pose_criteria, target_reps, hold_duration_ms, feedback_messages, recorded_paths, tracking_mode, demo_images')
          .eq('is_active', true)

        if (requestedId) {
          query = query.eq('id', requestedId)
        } else {
          query = query.order('created_at', { ascending: false }).limit(1)
        }

        const { data, error } = await query.single()
        if (cancelled) return

        if (error) {
          console.error('Error loading exercise:', error)
          setCameraError('No active exercises found. Please contact your therapist.')
          return
        }

        if (data) {
          if (!Number.isInteger(data.target_reps) || (data.target_reps ?? 0) < 1) {
            setCameraError('This exercise needs a repetition target. Please contact your therapist.')
            return
          }
          setExercise(data as Exercise)
          setCameraEnabled(true)
          // Ghost skeleton: the therapist's recorded target pose, shown behind
          // the patient's live skeleton as a visual goal.
          setGhostPose(pickReferencePose(data.recorded_paths, data.pose_criteria))
          // Rest->target sweep for the phase-led guide skeleton (empty for
          // static holds — the static ghost above stands in then).
          guideStepsRef.current = buildGuideFrames(data.recorded_paths, data.pose_criteria)
          // Dynamic exercises with a known rest pose count full movement cycles
          // (rest → target → hold → back to rest); everything else counts holds.
          // Shared with the editor's test mode so both count reps identically.
          const cyclic = isCyclicExercise(data.exercise_type, data.pose_criteria)
          repCounterRef.current = createRepCounter(
            data.exercise_type,
            data.pose_criteria,
            data.hold_duration_ms ?? 500
          )
          // Cyclic reps have a clear start/end, so each one can be DTW-scored
          // against the therapist's recorded movement curve.
          trajectoryRef.current = cyclic
            ? createTrajectoryTracker(data.recorded_paths, data.pose_criteria)
            : null
          console.log('✅ Loaded exercise:', data.name)
        }
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load exercise:', err)
        setCameraError('Failed to load exercise. Please try again.')
      } finally {
        if (!cancelled) setExerciseLoading(false)
      }
    }

    loadExercise()
    return () => {
      cancelled = true
      mountedRef.current = false
      activeRef.current = false
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [router])

  // Pin TTS to a fixed language/accent instead of the phone's preferred
  // language. Change TTS_LANG to switch accent (e.g. 'en-GB', 'th-TH').
  const TTS_LANG = 'en-US'
  const ttsVoiceRef = useRef<SpeechSynthesisVoice | null>(null)

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices()
      ttsVoiceRef.current =
        // Exact locale, on-device voice preferred (works offline, no lag)
        voices.find((v) => v.lang === TTS_LANG && v.localService) ||
        voices.find((v) => v.lang === TTS_LANG) ||
        // Same language, any region, as last resort
        voices.find((v) => v.lang.startsWith(TTS_LANG.split('-')[0])) ||
        null
    }
    pickVoice()
    // Mobile browsers load the voice list async — empty on first call
    window.speechSynthesis.addEventListener('voiceschanged', pickVoice)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', pickVoice)
  }, [])

  // Mobile browsers block speechSynthesis until a call happens inside a
  // user gesture. Speaking a silent utterance from the Start tap unlocks
  // the engine so later programmatic speak() calls produce sound.
  const unlockSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const unlock = new SpeechSynthesisUtterance(' ')
      unlock.volume = 0
      window.speechSynthesis.speak(unlock)
    }
  }

  // Text-to-speech helper
  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel() // Cancel any ongoing speech
      window.speechSynthesis.resume() // Chrome can leave the engine paused
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = TTS_LANG
      if (ttsVoiceRef.current) utterance.voice = ttsVoiceRef.current
      utterance.rate = 0.9
      utterance.pitch = 1.0
      utterance.volume = 1.0
      utterance.onend = () => setIsSpeaking(false)
      setIsSpeaking(true)
      window.speechSynthesis.speak(utterance)
    }
  }

  // Handle instruction box dragging
  useEffect(() => {
    if (!isDraggingBox) return

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - boxDragStart.x
      const dy = e.clientY - boxDragStart.y
      setInstructionBoxPos({ x: instructionBoxPos.x + dx, y: instructionBoxPos.y + dy })
      setBoxDragStart({ x: e.clientX, y: e.clientY })
    }

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const touch = e.touches[0]
      const dx = touch.clientX - boxDragStart.x
      const dy = touch.clientY - boxDragStart.y
      setInstructionBoxPos({ x: instructionBoxPos.x + dx, y: instructionBoxPos.y + dy })
      setBoxDragStart({ x: touch.clientX, y: touch.clientY })
    }

    const handleMouseUp = () => {
      setIsDraggingBox(false)
    }

    const handleTouchEnd = () => {
      setIsDraggingBox(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isDraggingBox, boxDragStart, instructionBoxPos])

  // Setup camera and pose detector
  useEffect(() => {
    // Wait for exercise to load before setting up camera
    if (exerciseLoading || !exercise || !cameraEnabled) return

    // `stream` used to be assigned only after getUserMedia resolved, so an
    // unmount before that (StrictMode's double-mount, a fast navigation) ran
    // cleanup against null and never stopped the tracks — camera light stuck
    // on, MediaStream leaked. Publish the stream before any further await, and
    // stop it on the spot if cleanup already ran. Every later step is gated on
    // the same flag so a torn-down session can't flip state back on.
    let cancelled = false
    let stream: MediaStream | null = null

    async function setupCamera() {
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
        })
        if (cancelled) {
          acquired.getTracks().forEach((track) => track.stop())
          return
        }
        stream = acquired
        acquired.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
          if (cancelled) return
          cameraReadyRef.current = false
          handlePause()
          setIsDetecting(false)
          setCameraEnabled(false)
          setCameraError('The camera disconnected. Your session is paused and completed repetitions are still here. Reconnect the camera and retry, or save and exit.')
        }))

        if (videoRef.current) {
          videoRef.current.srcObject = acquired
          await new Promise((resolve) => {
            if (videoRef.current) {
              videoRef.current.onloadedmetadata = resolve
            }
          })
          if (cancelled) return
          await videoRef.current.play()
        }
        if (cancelled) return

        // Initialize the detector for this exercise's tracking mode
        const initialized = await initDetector(exercise?.tracking_mode ?? 'body')
        if (cancelled) return
        if (!initialized) {
          acquired.getTracks().forEach(track => track.stop())
          setCameraEnabled(false)
          setIsDetecting(false)
          setCameraError('Movement tracking could not start. Check your connection, then retry. No session has started.')
          return
        }
        setIsDetecting(true)
        cameraReadyRef.current = true

        // Wait for a tap before starting — mobile browsers only allow
        // speech synthesis after a user gesture on the page, so the
        // Start tap doubles as the audio unlock.
        setSessionState(sessionIdRef.current ? 'paused' : 'ready')
      } catch (err) {
        if (cancelled) return // play() rejects on teardown — not a camera failure
        console.error('Camera error:', err)
        stream?.getTracks().forEach(track => track.stop())
        setCameraEnabled(false)
        setIsDetecting(false)
        const name = err instanceof DOMException ? err.name : ''
        setCameraError(name === 'NotAllowedError'
          ? 'Camera permission is needed to track this exercise. Allow camera access in your browser settings, then retry.'
          : name === 'NotFoundError'
            ? 'No camera was found. Connect a camera or use a device with a front camera.'
            : name === 'NotReadableError'
              ? 'Your camera is busy. Close other apps using it, then retry.'
              : 'The camera or movement tracker could not start. Check your connection and retry.')
      }
    }

    setupCamera()

    return () => {
      cancelled = true
      cameraReadyRef.current = false
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      disposeDetector()
    }
  }, [exerciseLoading, exercise, cameraEnabled])

  // Countdown effect
  useEffect(() => {
    if (sessionState === 'countdown' && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1)
      }, 1000)
      return () => clearTimeout(timer)
    } else if (sessionState === 'countdown' && countdown === 0) {
      activeRef.current = true
      sessionClockRef.current.start()
      setSessionState('active')
      // Speak initial instructions when session becomes active
      if (!hasSpoken) {
        setTimeout(() => {
          if (!mountedRef.current || !activeRef.current) return
          const description = exercise?.description || 'Follow the instructions on screen'
          speak(`Position yourself in frame. ${description}`)
          setHasSpoken(true)
        }, 500)
      }
    }
  }, [sessionState, countdown, hasSpoken, exercise])

  const startingRef = useRef(false)
  const openingTimeRef = useRef<string | null>(null)

  async function startSession() {
    if (!exercise || startingRef.current || !cameraReadyRef.current) return
    unlockSpeech()
    startingRef.current = true
    setStartError(null)
    setSessionState('starting')
    try {
      const supabase = createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (!mountedRef.current) return
      if (authError || !user || user.id !== userIdRef.current) {
        throw new Error('Please sign in again before starting your session.')
      }
      // Reuse the opening timestamp if a prior insert succeeded but its response
      // was lost. Movement never starts before we have a confirmed session ID.
      const startedAt = openingTimeRef.current ?? new Date().toISOString()
      openingTimeRef.current = startedAt
      const existing = await supabase.from('therapy_sessions').select('id')
        .eq('user_id', user.id).eq('exercise_id', exercise.id)
        .eq('started_at', startedAt).maybeSingle()
      if (existing.error) throw new Error('We could not prepare your session. Check your connection and retry.')
      let id = existing.data?.id
      if (!id) {
        const opened = await supabase.from('therapy_sessions').insert({
          user_id: user.id,
          exercise_id: exercise.id,
          exercise_type: exercise.exercise_type,
          started_at: startedAt,
          target_reps: TARGET_REPS,
        }).select('id').single()
        if (opened.error || !opened.data) throw new Error('We could not prepare your session. Check your connection and retry.')
        id = opened.data.id
      }
      sessionIdRef.current = id
      if (!mountedRef.current) return
      setCountdown(3)
      setSessionState(document.hidden || !cameraReadyRef.current ? 'paused' : 'countdown')
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Your session could not start. Please retry.')
      setSessionState('ready')
    } finally {
      startingRef.current = false
    }
  }

  // Real-time pose detection loop (only when active)
  useEffect(() => {
    if (sessionState !== 'active' || !videoRef.current || !exercise || !repCounterRef.current) return

    // Effect-scoped kill switch. Checking `sessionState` inside the closure
    // cannot end the loop — the effect only runs when it is already 'active',
    // so the captured value never changes. And the async body outlives the
    // cleanup's cancelAnimationFrame: `await detect()` resolves after unmount
    // or pause and schedules another frame that nothing is tracking. Set false
    // in cleanup, checked at the top and after the await. Same pattern as the
    // editor's test loop (app/admin/exercises/[id]/edit/page.tsx).
    let running = true

    async function detectAndAnalyze() {
      if (!running || !activeRef.current || !videoRef.current || !exercise || !repCounterRef.current) return

      // Track time for form quality calculation
      const now = Date.now()
      const frameGap = now - lastFrameTime.current
      const deltaTime = Math.min(frameGap, 1000)
      if (frameGap > 1000) repCounterRef.current.interrupt()
      lastFrameTime.current = now

      // Detect pose
      const pose = await detect(videoRef.current, exercise.tracking_mode ?? 'body')
      // Paused / navigated away while inference was in flight — drop this frame
      // rather than counting a rep and accumulating posture time for it.
      if (!running || !activeRef.current) return
      setDetectedPose(pose)

      // Analyze using generic exercise validation
      const analysis = analyzeExercise(pose, exercise.pose_criteria, exercise.feedback_messages)

      // Count reps first so cycle-phase coaching can override the raw feedback
      const rep = repCounterRef.current.count(analysis)
      const phase: CyclePhase | null = 'phase' in rep ? (rep.phase as CyclePhase) : null
      setHoldProgress(rep.holdProgress)
      setMovementProgress(analysis.progress ?? 0)

      // Trajectory matching: collect the live angle curve, opening a rep
      // window whenever the movement leaves the rest pose.
      if (trajectoryRef.current && phase) {
        trajectoryRef.current.addSample(pose, now)
        if (prevPhaseRef.current === 'rest' && phase !== 'rest') {
          trajectoryRef.current.markRepStart()
        }
        prevPhaseRef.current = phase
      }

      let displayFeedback = analysis.feedback
      let displayMessage = analysis.message
      if (phase === 'holding') {
        if (rep.holdEarned) {
          // Hold already earned — stop saying "hold", coach the return
          displayFeedback = 'good'
          displayMessage = exercise.feedback_messages?.return || 'Great — now lower back to start slowly'
        } else {
          displayMessage = exercise.feedback_messages?.hold || 'Hold it…'
        }
      } else if (phase === 'lowering') {
        // Out of the target band on purpose — coach the return, don't scold
        displayFeedback = 'good'
        displayMessage = exercise.feedback_messages?.return || 'Good — now return to start slowly'
      } else if (phase === 'lifting') {
        // Encourage the movement upward; the ring shows how far along they are.
        displayMessage = (analysis.progress ?? 0) >= 0.85
          ? (exercise.feedback_messages?.almost || 'Almost there…')
          : (exercise.feedback_messages?.lifting || 'Keep lifting…')
      }

      // Speak the "now lower" cue once per earned hold — the patient is mid-
      // exercise and may not be looking at the screen.
      if (phase && rep.holdEarned && !holdCueSpokenRef.current) {
        holdCueSpokenRef.current = true
        speak(exercise.feedback_messages?.return || 'Great! Now lower back to start slowly.')
      } else if (!rep.holdEarned) {
        holdCueSpokenRef.current = false
      }
      setPostureFeedback(displayFeedback)
      setFeedbackMessage(displayMessage)

      // Track target-pose time for the persisted session percentage.
      // Scored off the RAW engine verdict, never displayFeedback: the phase
      // coaching above forces 'good' for the whole lowering phase and for an
      // earned hold, so scoring the displayed value measured time spent in a
      // phase rather than correctness — moving slowly unlocked levels
      // (form_quality_score gates unlock_min_score, see lib/levels.ts).
      if (analysis.feedback === 'good') {
        goodPostureTimeRef.current += deltaTime
      }
      totalActiveTimeRef.current += deltaTime

      // Track anchor visibility for the out-of-frame warning
      setShouldersVisible(subjectInFrame(pose, exercise.tracking_mode ?? 'body'))

      if (rep.holdMissed) {
        setHoldMissed(true)
        setTimeout(() => setHoldMissed(false), 1200)
      }

      if (rep.justCompleted) {
        const newCount = rep.repCount
        console.log(`✅ Rep ${newCount} completed!`)
        // DTW path match against the therapist's demo curve is the best form
        // signal when available. Otherwise: a completed cycle is good form by
        // definition; hold-only reps keep scoring by the form at the moment
        // the hold ended.
        const traj = trajectoryRef.current?.scoreRep() ?? null
        setPathScore(traj)
        const formScore = traj
          ? traj.score
          : phase
            ? 100
            : analysis.feedback === 'good' ? 100 : analysis.feedback === 'adjust' ? 50 : 0

        // Save rep data
        const repData: RepData = {
          id: crypto.randomUUID(),
          repNumber: newCount,
          // Same 500ms default the rep counters were constructed with.
          holdDuration: exercise.hold_duration_ms ?? 500,
          formScore,
          timestamp: new Date(),
        }
        repDataListRef.current = [...repDataListRef.current, repData]

        repCountRef.current = newCount
        setRepCount(newCount)
        setRepJustCompleted(true)
        playRepChime()
        vibrate(30)
        // Tiny star sparkle per rep — kept small so it never competes with
        // pose inference for frame time.
        confetti({
          particleCount: 12,
          spread: 55,
          startVelocity: 22,
          ticks: 40,
          scalar: 0.9,
          shapes: ['star'],
          colors: ['#C9B88A', '#E8D9A8', '#FAF9F7'],
          origin: { x: 0.5, y: 0.35 },
          zIndex: 50,
          disableForReducedMotion: true,
        })
        // Low path match = rep counted but movement strayed from the demo —
        // coach it right away, while the next rep can still improve.
        const pathCoaching =
          traj && traj.score < 60 ? ' Try to follow the demonstrated movement more closely.' : ''
        speak(`Rep ${newCount} completed! ${TARGET_REPS - newCount} more to go.${pathCoaching}`)
        setTimeout(() => setRepJustCompleted(false), 300)

        if (newCount >= TARGET_REPS) {
          completeSession()
          return
        }
      }

      // Continue loop
      animationFrameRef.current = requestAnimationFrame(detectAndAnalyze)
    }

    // Reset frame clock so the first delta (and any pause gap) isn't counted.
    lastFrameTime.current = Date.now()
    detectAndAnalyze()

    return () => {
      running = false
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = undefined
      }
    }
  }, [sessionState, exercise])

  // Animate the guide skeleton on its own clock — a smooth, continuous ping-pong
  // through the recorded movement — so it always demonstrates regardless of what
  // the patient is doing or how fast inference runs, including during the
  // countdown before they've started moving.
  useEffect(() => {
    if (sessionState !== 'active' && sessionState !== 'countdown') return
    const steps = guideStepsRef.current
    if (steps.length < 2) return
    const PERIOD = 6000 // 3s up, 3s down
    const half = PERIOD / 2
    let raf = 0
    let lastIdx = -1
    const tick = () => {
      const t = performance.now() % PERIOD
      const gp = t < half ? t / half : 1 - (t - half) / half
      const idx = Math.round(gp * (steps.length - 1))
      if (idx !== lastIdx) {
        lastIdx = idx
        setGuidePose(steps[idx])
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sessionState])

  function captureResult(completed: boolean): SessionResult {
    if (!sessionIdRef.current || !userIdRef.current || !exercise) {
      throw new Error('This session could not be prepared for saving. Keep this page open and retry.')
    }
    return {
      version: 1,
      userId: userIdRef.current,
      sessionId: sessionIdRef.current,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      startedAt: openingTimeRef.current ?? new Date().toISOString(),
      completed,
      durationSeconds: sessionClockRef.current.seconds(),
      targetReps: TARGET_REPS,
      formQualityScore: totalActiveTimeRef.current > 0
        ? Math.round(goodPostureTimeRef.current / totalActiveTimeRef.current * 100) : 0,
      reps: repDataListRef.current.map(rep => ({ ...rep, timestamp: rep.timestamp.toISOString() })),
    }
  }

  async function retrySave() {
    const result = pendingResultRef.current
    if (!result || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    setRetained(retainSessionResult(result))
    try {
      const before = getProgress()
      const total = await saveSessionResult(createClient(), result)
      if (result.completed && total !== null) {
        const updated = recordCompletion(total, new Date(result.startedAt))
        const gardenAfter = getGardenStage(total)
        const bloomed = gardenAfter > getGardenStage(before.totalStars)
        setReward({
          totalStars: total,
          streak: updated.completionStreak,
          reps: result.reps.length,
          durationSeconds: result.durationSeconds,
          newGardenStage: bloomed ? gardenAfter : null,
          newTreeStage: updated.treeStage !== before.treeStage ? updated.treeStage : null,
        })
        if (bloomed) {
          try { sessionStorage.setItem('medproj_bloom_reveal', String(gardenAfter)) } catch { /* optional animation */ }
        }
        try {
          playCompletionFanfare()
          vibrate([60, 40, 120])
          speak('Session saved. Great job!')
          confetti({
            particleCount: 45, spread: 100, startVelocity: 32, scalar: 1.2,
            ticks: 90, shapes: ['star'], colors: ['#C9B88A', '#E8D9A8', '#F5EAC8'],
            origin: { x: 0.5, y: 0.4 }, zIndex: 50, disableForReducedMotion: true,
          })
        } catch { /* Optional celebration must not turn a successful save into an error. */ }
        // A recovered result may already have sent mail before a lost response.
        if (exercise) void notifyGuardian()
      }
      forgetSessionResult(result)
      pendingResultRef.current = null
      if (!result.completed) router.push('/')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Saving did not finish. Please retry.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // Fire-and-forget guardian email — the server decides whether to send
  // based on the patient's profile toggle. Never blocks the celebration.
  async function notifyGuardian() {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return

      const durationSeconds = sessionClockRef.current.seconds()
      const formScore = totalActiveTimeRef.current > 0
        ? Math.round((goodPostureTimeRef.current / totalActiveTimeRef.current) * 100)
        : null

      fetch('/api/notify-guardian', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          exerciseName: exercise?.name,
          reps: repCountRef.current,
          targetReps: TARGET_REPS,
          durationSeconds,
          formScore,
        }),
      }).catch((err) => console.error('Guardian notify failed:', err))
    } catch (err) {
      console.error('Guardian notify failed:', err)
    }
  }

  async function completeSession() {
    if (completingRef.current) return
    completingRef.current = true
    activeRef.current = false
    sessionClockRef.current.pause()
    setCameraEnabled(false)
    setSessionState('completed')
    try {
      pendingResultRef.current = captureResult(true)
      setPendingResult(pendingResultRef.current)
      await retrySave()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Saving did not finish. Keep this page open.')
    }
  }

  function handlePause() {
    activeRef.current = false
    sessionClockRef.current.pause()
    repCounterRef.current?.interrupt()
    trajectoryRef.current = exercise
      ? createTrajectoryTracker(exercise.recorded_paths, exercise.pose_criteria) : null
    prevPhaseRef.current = null
    holdCueSpokenRef.current = false
    setHoldProgress(0)
    setMovementProgress(0)
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    setSessionState('paused')
  }

  function handleResume() {
    setCountdown(3)
    setSessionState('countdown')
  }

  function handleExit() {
    if (sessionState === 'starting') return
    handlePause()
    if (repCountRef.current > 0) setShowExitPrompt(true)
    else router.push('/')
  }

  async function handleExitWithSave() {
    if (savingRef.current || completingRef.current) return
    completingRef.current = true
    setShowExitPrompt(false)
    setCameraError(null)
    setCameraEnabled(false)
    setSessionState('completed')
    try {
      pendingResultRef.current = captureResult(false)
      setPendingResult(pendingResultRef.current)
      await retrySave()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Saving did not finish. Keep this page open.')
    }
  }

  function handleExitWithoutSave() {
    setCameraEnabled(false)
    router.push('/')
  }

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && (sessionState === 'active' || sessionState === 'countdown')) handlePause()
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if ((repCountRef.current > 0 && sessionState !== 'completed') ||
          (pendingResultRef.current && !retained)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [sessionState, retained])

  const feedbackColor = {
    good: '#22c55e',    // correct
    adjust: '#f97316',  // almost correct
    analyzing: '#CBD5D1', // tracking is not yet confident; this is not a form error
  }

  if (cameraError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-center max-w-md px-8">
          <p className="text-xl mb-6" style={{ color: 'var(--ink)' }}>{cameraError}</p>
          <div className="flex flex-col gap-4">
            <button
              onClick={() => {
                if (!sessionIdRef.current) { window.location.reload(); return }
                setCameraError(null)
                setSessionState('loading')
                setCameraEnabled(true)
              }}
              className="btn btn-primary"
            >
              Retry camera and tracking
            </button>
            {repCount > 0 && <button className="btn btn-primary" onClick={() => void handleExitWithSave()}>Save repetitions and exit</button>}
            <button
              onClick={() => router.push('/')}
              style={{
                padding: 'var(--space-3) var(--space-6)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                borderRadius: 'var(--radius-xl)',
                border: '2px solid var(--border)',
              }}
            >
              Return to Dashboard
            </button>
          </div>
          <p className="text-sm mt-6" style={{ color: 'var(--muted)' }}>
            Chrome: Click 🔒 in address bar → Camera → Allow
          </p>
        </div>
      </div>
    )
  }

  if (exerciseLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-center max-w-md px-8">
          <div className="text-6xl mb-6">🌱</div>
          <p className="text-xl mb-4" style={{ color: 'var(--ink)' }}>Loading your exercise...</p>
          <div style={{
            width: '48px',
            height: '48px',
            margin: '0 auto',
            border: '4px solid var(--border)',
            borderTop: '4px solid var(--primary)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <style jsx>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    )
  }

  if (sessionState === 'completed' && !reward) {
    const result = pendingResult
    return (
      <main className="min-h-screen px-6 py-12 flex items-center justify-center">
        <section className="w-full max-w-md text-center" aria-busy={saving}>
          <h1 className="mb-3">{result?.completed ? 'Session complete' : 'Session ended'}</h1>
          <p className="mb-4" style={{ color: 'var(--muted)' }}>
            {result?.exerciseName ?? exercise?.name} · {result?.reps.length ?? repCount} {(result?.reps.length ?? repCount) === 1 ? 'repetition' : 'repetitions'}
          </p>
          <p role={saveError ? 'alert' : 'status'} className="mb-4">
            {saving ? 'Saving your session…' : saveError ?? 'Preparing your results…'}
          </p>
          <p className="mb-6 text-sm" style={{ color: 'var(--muted)' }}>
            {retained
              ? 'Your results are kept on this device until saving finishes. You can also retry from your garden.'
              : 'Keep this page open until saving finishes so your results are not lost.'}
            {result?.completed && ' Your star will appear after saving is confirmed.'}
          </p>
          <button className="btn btn-primary w-full" disabled={saving || !result} onClick={() => void retrySave()}>
            {saving ? 'Saving…' : 'Retry saving'}
          </button>
          {retained && <Link href="/" className="btn mt-3 w-full">Return to garden</Link>}
          {saveError?.startsWith('Sign in') && (
            <Link href="/login" target="_blank" className="btn mt-3 w-full">Sign in in another tab</Link>
          )}
        </section>
      </main>
    )
  }

  if (sessionState === 'completed') {
    return (
      <>
        <div className="fixed inset-0 flex items-center justify-center pb-24 overflow-y-auto" style={{ background: 'var(--bg)' }}>
          <div className="text-center max-w-md px-8 py-8">
            {/* Gold star medal */}
            <div className="animate-scaleIn mb-6" style={{ display: 'inline-block' }}>
              <div className="animate-starShine" style={{ filter: 'drop-shadow(0 6px 16px rgba(201, 184, 138, 0.5))' }}>
                <svg width="88" height="88" viewBox="0 0 20 20">
                  <defs>
                    <linearGradient id="starGold" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E8D9A8" />
                      <stop offset="100%" stopColor="#C9B88A" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M10 0l2.5 6.5H19l-5.5 4 2 6.5L10 13l-5.5 4 2-6.5-5.5-4h6.5z"
                    fill="url(#starGold)"
                    stroke="#B3A276"
                    strokeWidth="0.5"
                  />
                </svg>
              </div>
            </div>

            <h1 className="text-4xl font-display mb-2 animate-fadeInUp" style={{ color: 'var(--ink)', fontWeight: 700, animationDelay: '100ms' }}>
              Session Complete!
            </h1>
            <p className="mb-6 animate-fadeInUp" style={{ color: 'var(--muted)', fontSize: 'var(--text-lg)', animationDelay: '150ms' }}>
              +1 star earned{reward ? ` · ${reward.totalStars} total` : ''}
            </p>

            {/* Session stats */}
            <div className="flex justify-center gap-3 mb-6 animate-fadeInUp" style={{ animationDelay: '200ms' }}>
              <StatChip value={String(reward?.reps ?? TARGET_REPS)} label="reps" />
              <StatChip value={formatDuration(reward?.durationSeconds ?? 0)} label="time" />
              <StatChip value={`${reward?.streak ?? 1}🔥`} label="day streak" />
            </div>

            {/* Streak milestone */}
            {reward && STREAK_MILESTONES.includes(reward.streak) && (
              <div
                className="animate-fadeInUp mb-6"
                style={{
                  animationDelay: '250ms',
                  background: 'linear-gradient(135deg, rgba(201, 184, 138, 0.18), rgba(201, 184, 138, 0.08))',
                  border: '1px solid rgba(201, 184, 138, 0.5)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-3) var(--space-4)',
                  fontWeight: 700,
                  color: 'var(--ink)',
                }}
              >
                🔥 {reward.streak}-day streak — incredible consistency!
              </div>
            )}

            {/* New garden bloom reveal */}
            {reward?.newGardenStage != null && (
              <div
                className="animate-fadeInUp mb-6"
                style={{
                  animationDelay: '300ms',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-4)',
                  textAlign: 'left',
                }}
              >
                <img
                  src={getGardenImagePath(reward.newGardenStage)}
                  alt={getGardenStageName(reward.newGardenStage)}
                  width={72}
                  height={108}
                  style={{ borderRadius: 'var(--radius-md)', flexShrink: 0 }}
                />
                <div>
                  <p style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 'var(--text-base)', marginBottom: '2px' }}>
                    New bloom unlocked! 🌸
                  </p>
                  <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
                    {getGardenStageName(reward.newGardenStage)}
                  </p>
                </div>
              </div>
            )}

            {/* Tree stage-up (only when no bloom card, to keep one hero moment) */}
            {reward?.newTreeStage && reward?.newGardenStage == null && (
              <p className="mb-6 animate-fadeInUp" style={{ color: 'var(--primary)', fontWeight: 600, animationDelay: '300ms' }}>
                🌳 Your tree grew to a new stage!
              </p>
            )}

            {/* What's coming next — anticipation for the next session */}
            {reward && reward.newGardenStage == null && (
              <NextBloomTeaser totalStars={reward.totalStars} />
            )}

            <div className="animate-fadeInUp" style={{ animationDelay: '400ms' }}>
              <button
                onClick={() => router.push('/')}
                className="btn btn-primary"
              >
                {reward?.newGardenStage != null ? 'See My Garden Bloom' : 'View My Garden'}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Navigation */}
        <nav className="bottom-nav">
          <Link href="/" className="nav-item active">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z" />
              <path d="M12 19v3" />
            </svg>
            <span>Garden</span>
          </Link>
          <Link href="/progress" className="nav-item">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18" />
              <path d="M7 16l4-8 4 4 4-12" />
            </svg>
            <span>Progress</span>
          </Link>
        </nav>
      </>
    )
  }

  // Overlay geometry. Keypoints are in canonical space (see canonicalFrameSize),
  // which shares the video's aspect ratio but not its pixel dimensions — so the
  // SVG viewBox has to be the canonical box, not videoWidth × videoHeight.
  const overlayBox = canonicalFrameSize(
    videoSize.width,
    videoSize.height
  )

  return (
    <div className="fixed inset-0 overflow-hidden session">

      {/* Camera feed */}
      <video
        ref={videoRef}
        onLoadedMetadata={event => setVideoSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* Guide skeleton — the therapist's movement, animated on its own loop so
          it always demonstrates (including during the countdown, before the
          patient moves). Anchored to the patient's shoulders when they're
          detected, otherwise centered in the frame. */}
      {(sessionState === 'active' || sessionState === 'countdown') && videoSize.width > 0 && (guidePose ?? ghostPose) && (
        <svg
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${overlayBox.w} ${overlayBox.h}`}
          preserveAspectRatio="xMidYMid slice"
          style={{ width: '100%', height: '100%', transform: 'scaleX(-1)' }}
        >
          {(() => {
            const guide = guidePose ?? ghostPose
            if (!guide) return null
            const find = (pose: Pose, name: string) => {
              const kp = pose.keypoints.find((k) => k.name === name)
              return kp && (kp.score ?? 0) > 0.3 ? kp : null
            }
            const [anchorA, anchorB] = anchorPairForMode(mode)
            const gls = find(guide, anchorA)
            const grs = find(guide, anchorB)
            if (!gls || !grs) return null
            const gMid = { x: (gls.x + grs.x) / 2, y: (gls.y + grs.y) / 2 }
            const gWidth = Math.hypot(gls.x - grs.x, gls.y - grs.y)
            if (gWidth < 1) return null

            // Anchor to the patient's shoulders when detected; otherwise (e.g.
            // during the countdown, before the detection loop runs) center the
            // guide in the frame so it can still demonstrate.
            const pls = detectedPose ? find(detectedPose, anchorA) : null
            const prs = detectedPose ? find(detectedPose, anchorB) : null
            const vw = overlayBox.w
            const vh = overlayBox.h
            const pMid = pls && prs
              ? { x: (pls.x + prs.x) / 2, y: (pls.y + prs.y) / 2 }
              : { x: vw / 2, y: vh * 0.42 }
            const scale = pls && prs
              ? Math.hypot(pls.x - prs.x, pls.y - prs.y) / gWidth
              : (vw * (mode === 'hand' ? 0.35 : 0.24)) / gWidth
            const tx = (p: { x: number; y: number }) => ({
              x: pMid.x + (p.x - gMid.x) * scale,
              y: pMid.y + (p.y - gMid.y) * scale,
            })

            return connectionsForMode(mode).map(([start, end], i) => {
              const s = find(guide, start)
              const e = find(guide, end)
              if (!s || !e) return null
              const s2 = tx(s)
              const e2 = tx(e)
              return (
                <line
                  key={`ghost-${i}`}
                  x1={s2.x} y1={s2.y}
                  x2={e2.x} y2={e2.y}
                  stroke="white"
                  strokeWidth={mode === 'hand' ? 3 : 5}
                  strokeLinecap="round"
                  strokeDasharray="14 10"
                  opacity="0.5"
                />
              )
            })
          })()}
        </svg>
      )}

      {/* Skeleton overlay — live skeleton */}
      {sessionState === 'active' && detectedPose && videoSize.width > 0 && (
        <svg
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${overlayBox.w} ${overlayBox.h}`}
          preserveAspectRatio="xMidYMid slice"
          style={{ width: '100%', height: '100%', transform: 'scaleX(-1)' }}
        >
          {/* Live skeleton — solid colored lines reflecting posture feedback.
              Body mode keeps its arm-only subset; hand mode draws the full
              21-segment hand with a thinner stroke. */}
          {(() => {
            const connections = mode === 'hand'
              ? connectionsForMode('hand')
              : [
                  ['left_shoulder',  'right_shoulder'],
                  ['left_shoulder',  'left_elbow'],
                  ['left_elbow',     'left_wrist'],
                  ['right_shoulder', 'right_elbow'],
                  ['right_elbow',    'right_wrist'],
                ];

            const lineColor = feedbackColor[postureFeedback];

            // Hand mode: draw every detected hand, not just the primary —
            // both hands are validated, so both get the live skeleton.
            const keypointSets = mode === 'hand'
              ? [detectedPose.keypoints, ...(detectedPose.extraHands?.map((h) => h.keypoints) ?? [])]
              : [detectedPose.keypoints];

            return keypointSets.flatMap((keypoints, h) =>
              connections.map(([start, end], i) => {
                const startKp = keypoints.find((kp) => kp.name === start);
                const endKp   = keypoints.find((kp) => kp.name === end);

                if (
                  startKp && endKp &&
                  (startKp.score ?? 0) > 0.5 &&
                  (endKp.score   ?? 0) > 0.5
                ) {
                  return (
                    <line
                      key={`${h}-${i}`}
                      x1={startKp.x} y1={startKp.y}
                      x2={endKp.x}   y2={endKp.y}
                      stroke={lineColor}
                      strokeWidth={mode === 'hand' ? 4 : 8}
                      strokeLinecap="round"
                      opacity="0.85"
                    />
                  );
                }
                return null;
              })
            );
          })()}
        </svg>
      )}

      {/* Ready overlay — tap unlocks mobile audio, then countdown starts */}
      {sessionState === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20 px-8 text-center" style={{ background: 'rgba(0,0,0,0.7)', color: 'white' }}>
          <p role="status">Starting camera and movement tracking…</p>
        </div>
      )}
      {(sessionState === 'ready' || sessionState === 'starting') && (
        <div className="gx-overlay absolute inset-0 flex items-center justify-center z-20" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <div className="gx-panel text-center px-8" style={{ width: '100%', maxWidth: '360px' }}>
            <p className="font-display text-3xl mb-3" style={{ color: 'white', fontWeight: 600 }}>
              Ready?
            </p>
            <p className="mb-6" style={{ color: 'rgba(255,255,255,0.75)', fontSize: 'var(--text-base)' }}>
              {mode === 'hand'
                ? 'Hold your hand up so it fills the frame, palm facing the camera'
                : 'Place your phone where your upper body is in frame'}
            </p>
            <ExerciseDemo frames={exercise?.demo_images ?? []} />
            {startError && <p role="alert" className="mb-4" style={{ color: 'white' }}>{startError}</p>}
            <button
              onClick={() => void startSession()}
              disabled={sessionState === 'starting'}
              className="btn btn-primary"
              style={{ fontSize: 'var(--text-lg)', padding: 'var(--space-4) var(--space-12)' }}
            >
              {sessionState === 'starting' ? 'Preparing session…' : 'Start'}
            </button>
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {sessionState === 'countdown' && countdown > 0 && (
        <div className="gx-overlay absolute inset-0 flex items-center justify-center z-20" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <div className="gx-panel text-center px-8">
            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-lg)' }} className="mb-4 font-display">
              Starting in
            </p>
            <p key={countdown} className="animate-countdownPop text-8xl font-display font-bold mb-8" style={{ color: 'var(--primary)' }}>
              {countdown}
            </p>
            <div style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 'var(--radius-xl)',
              padding: 'var(--space-4) var(--space-6)',
              maxWidth: '280px',
              margin: '0 auto',
            }}>
              <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
                Hold each position for <strong style={{ color: 'white' }}>{((exercise?.hold_duration_ms ?? 500) / 1000).toFixed(1)} seconds</strong> to count a rep
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Shoulders-out-of-frame warning */}
      {sessionState === 'active' && !shouldersVisible && (
        <div
          className="absolute top-24 left-0 right-0 flex justify-center z-10 pointer-events-none"
          style={{ padding: '0 var(--space-6)' }}
        >
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
            border: '2px solid #f97316',
            borderRadius: 'var(--radius-xl)',
            padding: 'var(--space-4) var(--space-6)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ color: 'white', fontSize: 'var(--text-xl)', fontWeight: 700, lineHeight: 1.3 }}>
              {mode === 'hand'
                ? 'Move your hand fully into frame'
                : 'Step back so your shoulders are visible'}
            </span>
          </div>
        </div>
      )}

      {/* Exit confirmation prompt */}
      {showExitPrompt && (
        <div className="gx-overlay absolute inset-0 flex items-center justify-center z-30" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}>
          <div className="gx-panel bg-[var(--surface)] p-8 rounded-2xl max-w-md mx-4 text-center">
            <h3 className="font-display text-2xl mb-4" style={{ color: 'var(--ink)', fontWeight: 600 }}>
              End session?
            </h3>
            <p style={{ color: 'var(--muted)' }} className="mb-2">
              You&apos;ve completed {repCount} of {TARGET_REPS} reps
            </p>
            <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
              Choose Save and Exit to keep these repetitions. A star is earned only after completing the full session.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleExitWithSave}
                className="btn btn-primary"
              >
                Save & Exit
              </button>
              <button
                onClick={() => setShowExitPrompt(false)}
                style={{
                  padding: 'var(--space-3) var(--space-6)',
                  background: 'transparent',
                  color: 'var(--primary)',
                  border: '2px solid var(--primary)',
                  borderRadius: 'var(--radius-xl)',
                  fontFamily: 'var(--font-body)',
                  fontWeight: 600,
                  fontSize: 'var(--text-base)',
                  minHeight: '56px',
                  cursor: 'pointer',
                }}
              >
                Keep Going
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paused overlay */}
      {sessionState === 'paused' && (
        <div className="gx-overlay absolute inset-0 flex items-center justify-center z-20" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)' }}>
          <div className="gx-panel text-center max-w-md px-8">
            <h2 className="font-display text-3xl mb-4" style={{ color: 'white', fontWeight: 600 }}>
              Paused
            </h2>
            <p style={{ color: 'var(--muted)' }} className="mb-2">
              {repCount} / {TARGET_REPS} reps completed
            </p>
            <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>
              Take your time
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleResume}
                className="btn btn-primary text-lg"
              >
                Resume Session
              </button>
              <button
                onClick={handleExit}
                style={{ color: 'var(--muted)', padding: 'var(--space-3)', fontSize: 'var(--text-base)' }}
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UI Overlay */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-3">
            <div style={{
              background: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(8px)',
              padding: 'var(--space-3) var(--space-6)',
              borderRadius: 'var(--radius-full)',
            }}>
              <p className="font-display" style={{ color: 'var(--ink)' }}>
                Reps: <span style={{
                  color: 'var(--primary)',
                  fontWeight: 600,
                  display: 'inline-block',
                  transition: 'transform 200ms var(--ease-out-quart)',
                  transform: repJustCompleted ? 'scale(1.25)' : 'scale(1)'
                }}>{repCount}</span> / {TARGET_REPS}
              </p>
            </div>

            {/* Live movement ring — fills as the primary joint travels from
                rest to the target, giving continuous "it's following me"
                feedback instead of only reacting at the extreme. */}
            {sessionState === 'active' && movementProgress > 0.02 && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(8px)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-full)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border)" strokeWidth="3" />
                  <circle
                    cx="12" cy="12" r="9" fill="none"
                    stroke={movementProgress >= 0.99 ? '#22c55e' : 'var(--primary)'}
                    strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 9}
                    strokeDashoffset={2 * Math.PI * 9 * (1 - movementProgress)}
                    style={{ transition: 'stroke-dashoffset 80ms linear, stroke 200ms ease' }}
                  />
                </svg>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {Math.round(movementProgress * 100)}%
                </span>
              </div>
            )}

            {/* DTW path match of the last rep — how closely the movement
                followed the therapist's recorded curve */}
            {pathScore && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(8px)',
                padding: 'var(--space-2) var(--space-4)',
                borderRadius: 'var(--radius-full)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: pathScore.score >= 80 ? '#10b981' : pathScore.score >= 60 ? '#f97316' : '#ef4444',
                }} />
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  Path {pathScore.score}%
                </span>
              </div>
            )}

            {/* Detection status indicator */}
            {isDetecting && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(8px)',
                padding: 'var(--space-2) var(--space-4)',
                borderRadius: 'var(--radius-full)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#10b981',
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                }} />
                <span className="text-xs" style={{ color: 'var(--muted)' }}>AI Active</span>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            {sessionState === 'active' && (
              <button
                onClick={handlePause}
                style={{
                  width: '48px',
                  height: '48px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255, 255, 255, 0.9)',
                  backdropFilter: 'blur(8px)',
                  borderRadius: '50%',
                  border: 'none',
                  cursor: 'pointer',
                }}
                aria-label="Pause session"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--ink)' }}>
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              </button>
            )}

            <button
              onClick={handleExit}
              style={{
                width: '48px',
                height: '48px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(8px)',
                borderRadius: '50%',
                border: 'none',
                cursor: 'pointer',
              }}
              aria-label="Exit session"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--ink)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Center guidance (loading only) */}
        <div className="flex-1 flex items-center justify-center">
          {sessionState === 'loading' && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(8px)',
              padding: 'var(--space-6) var(--space-8)',
              borderRadius: 'var(--radius-xl)',
            }}>
              <p className="font-display text-xl" style={{ color: 'var(--ink)' }}>Loading camera...</p>
            </div>
          )}
        </div>

        {/* Bottom instruction */}
        <div className="p-6 pb-safe">
          <div style={{
            background: 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(8px)',
            padding: 'var(--space-4) var(--space-6)',
            borderRadius: 'var(--radius-xl)',
            textAlign: 'center',
            maxWidth: '28rem',
            margin: '0 auto',
            position: 'relative',
            transform: `translate(${instructionBoxPos.x}px, ${instructionBoxPos.y}px)`,
            cursor: isDraggingBox ? 'grabbing' : 'auto',
            userSelect: 'none',
            border: '2px solid var(--border)',
          }}>
            {/* Drag handle + speaker button */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-3)',
              paddingBottom: 'var(--space-2)',
              borderBottom: '1px solid var(--border)',
            }}>
              <div
                onMouseDown={(e) => {
                  setIsDraggingBox(true)
                  setBoxDragStart({ x: e.clientX, y: e.clientY })
                }}
                onTouchStart={(e) => {
                  const touch = e.touches[0]
                  setIsDraggingBox(true)
                  setBoxDragStart({ x: touch.clientX, y: touch.clientY })
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  cursor: 'grab',
                  flex: 1,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
                  <circle cx="9" cy="6" r="1" fill="var(--muted)" />
                  <circle cx="15" cy="6" r="1" fill="var(--muted)" />
                  <circle cx="9" cy="12" r="1" fill="var(--muted)" />
                  <circle cx="15" cy="12" r="1" fill="var(--muted)" />
                  <circle cx="9" cy="18" r="1" fill="var(--muted)" />
                  <circle cx="15" cy="18" r="1" fill="var(--muted)" />
                </svg>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                  Drag to move
                </span>
              </div>

              {/* Speaker button */}
              <button
                onClick={() => {
                  const instruction = exercise?.description || 'Follow the instructions on screen'
                  speak(`${holdMissed ? 'Hold a little longer next time' : feedbackMessage}. ${instruction}`)
                }}
                style={{
                  background: isSpeaking ? 'var(--primary)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 200ms ease',
                }}
                aria-label="Read instructions aloud"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={isSpeaking ? 'white' : 'var(--primary)'}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {isSpeaking ? (
                    <>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </>
                  ) : (
                    <path d="M15 9l6 3-6 3V9z" />
                  )}
                </svg>
              </button>
            </div>

            <p
              className="font-display text-lg transition-colors mb-2"
              style={{ color: holdMissed ? '#f97316' : feedbackColor[postureFeedback], fontWeight: 600 }}
            >
              {holdMissed ? 'Hold a little longer next time' : feedbackMessage}
            </p>

            {/* Hold progress bar — visible while arms are raised */}
            {holdProgress > 0 && (
              <div style={{
                height: '4px',
                background: 'var(--border)',
                borderRadius: 'var(--radius-full)',
                overflow: 'hidden',
                marginBottom: 'var(--space-3)',
              }}>
                <div style={{
                  height: '100%',
                  width: `${holdProgress * 100}%`,
                  background: holdProgress >= 1 ? '#22c55e' : '#f97316',
                  borderRadius: 'var(--radius-full)',
                  transition: 'width 80ms linear, background 200ms ease',
                }} />
              </div>
            )}

            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
              {exercise?.description || 'Follow the instructions on screen'}
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  )
}

// Pre-session picture holder. Shows the exercise's own demo pictures (uploaded
// in the admin editor, stored in exercises.demo_images). All images stay
// mounted and swap by opacity so the exchange is seamless — a two-frame
// "video" loop. No pictures → an explicit placeholder, not a broken image.
function ExerciseDemo({ frames, intervalMs = 700 }: { frames: string[]; intervalMs?: number }) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (frames.length < 2) return // nothing to alternate
    const id = setInterval(() => {
      setFrame(f => (f + 1) % frames.length)
    }, intervalMs)
    return () => clearInterval(id)
  }, [frames.length, intervalMs])

  if (frames.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          aspectRatio: '4 / 3',
          margin: '0 auto var(--space-6)',
          borderRadius: 'var(--radius-xl)',
          border: '1px dashed rgba(255,255,255,0.35)',
          background: 'rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-4)',
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
          No demonstration pictures for this exercise yet
        </span>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 3',
        margin: '0 auto var(--space-6)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.25)',
        background: 'rgba(255,255,255,0.06)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
    >
      {frames.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={`Exercise demonstration, position ${i + 1}`}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: frame === i ? 1 : 0,
            transition: 'opacity 300ms ease-in-out',
          }}
        />
      ))}
      <span
        style={{
          position: 'absolute',
          top: 'var(--space-2)',
          left: 'var(--space-2)',
          padding: 'var(--space-1) var(--space-3)',
          borderRadius: 'var(--radius-full)',
          background: 'rgba(0,0,0,0.55)',
          color: 'white',
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}
      >
        Demo
      </span>
    </div>
  )
}

const STREAK_MILESTONES = [3, 5, 7, 14, 21, 30, 60, 100]

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** "Next bloom in N stars" card with a mystery thumbnail of the upcoming
 *  garden element and a progress bar that animates in the star just earned. */
function NextBloomTeaser({ totalStars }: { totalStars: number }) {
  const starsToNext = getStarsToNextBloom(totalStars)
  // Start the bar where it stood before this session's star, then fill.
  const [pct, setPct] = useState(getGardenProgressPercent(totalStars - 1))

  useEffect(() => {
    const id = setTimeout(() => setPct(getGardenProgressPercent(totalStars)), 700)
    return () => clearTimeout(id)
  }, [totalStars])

  if (starsToNext === 0) return null // garden already complete

  const nextStage = getGardenStage(totalStars) + 1
  return (
    <div
      className="animate-fadeInUp mb-6"
      style={{
        animationDelay: '350ms',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        textAlign: 'left',
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <img
          src={getGardenImagePath(nextStage)}
          alt="Next garden bloom (locked)"
          width={56}
          height={84}
          style={{ borderRadius: 'var(--radius-md)', filter: 'grayscale(1) brightness(0.9)', opacity: 0.55, display: 'block' }}
        />
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            color: 'var(--ink)',
          }}
        >
          ?
        </span>
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
          Next bloom in {starsToNext} {starsToNext === 1 ? 'star' : 'stars'}
        </p>
        <div style={{ height: '8px', borderRadius: 'var(--radius-full)', background: 'var(--border)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: 'var(--radius-full)',
              background: 'linear-gradient(90deg, var(--primary), #6B8F7A)',
              transition: 'width var(--dur-grow) var(--ease-out)',
            }}
          />
        </div>
      </div>
    </div>
  )
}

function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3) var(--space-4)',
        minWidth: '84px',
      }}
    >
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--ink)' }}>{value}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', fontWeight: 500 }}>{label}</div>
    </div>
  )
}
