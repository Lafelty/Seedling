'use client'

import { use, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import {
  measureAngle,
  deriveCriteriaFromRecordings,
  initDetector,
  detect,
  disposeDetector,
  analyzeExercise,
  GenericRepCounter,
  CycleRepCounter,
  referencesForMode,
  keypointNamesForMode,
  connectionsForMode,
  type TrackingMode,
  type Pose,
  type PoseCriteria,
  type ExerciseAnalysis,
  type CyclePhase,
  type AngleSpace,
} from '@/lib/poseDetection'

interface RecordedFrame {
  timestamp: number
  pose: Pose
}

interface RecordedDemo {
  id: string
  frames: RecordedFrame[]
  duration: number
  recordedAt: string
}

interface Exercise {
  id: string
  name: string
  description: string
  exercise_type: string
  difficulty: string
  recorded_paths: RecordedDemo[]
  pose_criteria: any
  target_reps: number
  hold_duration_ms: number
  feedback_messages: any
  is_active: boolean
  // Absent until hand_tracking_migration.sql has run — treat as 'body'.
  tracking_mode?: TrackingMode | null
}

interface AngleCriterion {
  joint: string
  minAngle: number
  maxAngle: number
  targetAngle: number
  restAngle?: number
  relativeTo: string[]
}

interface LevelingRule {
  joints: string[]
  maxDifference: number
  message: string
}

const formatJointName = (name: string) =>
  name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

export default function EditExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const testVideoRef = useRef<HTMLVideoElement>(null)
  const testCanvasRef = useRef<HTMLCanvasElement>(null)
  const testRepCounterRef = useRef<GenericRepCounter | CycleRepCounter | null>(null)

  const [loading, setLoading] = useState(true)
  const [exercise, setExercise] = useState<Exercise | null>(null)
  // Display-only: recordings are mode-specific, so the mode is fixed at creation.
  const mode: TrackingMode = exercise?.tracking_mode ?? 'body'

  // Editable metadata — same fields the creation page sets.
  const [exerciseName, setExerciseName] = useState('')
  const [exerciseDescription, setExerciseDescription] = useState('')
  const [exerciseType, setExerciseType] = useState<'static' | 'dynamic'>('dynamic')
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner')
  // The two demo pictures patients see on the pre-session "Ready?" screen.
  const [demoImages, setDemoImages] = useState<(string | null)[]>([null, null])
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null)
  const [selectedDemo, setSelectedDemo] = useState<number>(0)
  const [currentFrame, setCurrentFrame] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState(false)

  // Refinement state
  const [angleCriteria, setAngleCriteria] = useState<AngleCriterion[]>([])
  const [levelingRules, setLevelingRules] = useState<LevelingRule[]>([])
  const [autoFilled, setAutoFilled] = useState(false)
  // Coordinate space the criteria's angles live in — must ride along with them.
  const [angleSpace, setAngleSpace] = useState<AngleSpace>('2d')
  // Which criterion the timeline chart plots
  const [chartCriterionIdx, setChartCriterionIdx] = useState(0)

  // Test mode: therapist performs the exercise against the current (unsaved) criteria
  const [testMode, setTestMode] = useState(false)
  const [testFeedback, setTestFeedback] = useState<ExerciseAnalysis | null>(null)
  const [testReps, setTestReps] = useState(0)
  const [testHoldProgress, setTestHoldProgress] = useState(0)
  const [testPhase, setTestPhase] = useState<CyclePhase | null>(null)
  const [testCameraError, setTestCameraError] = useState<string | null>(null)
  const [targetBodyParts, setTargetBodyParts] = useState<string[]>([])
  const [feedbackMessages, setFeedbackMessages] = useState<Record<string, string>>({
    perfect: 'Perfect form!',
    tooLow: 'Raise higher',
    tooHigh: 'Lower slightly',
    notLevel: 'Keep level',
    hold: 'Hold it…',
    return: 'Good — now return to start slowly',
  })
  const [targetReps, setTargetReps] = useState(10)
  const [holdDuration, setHoldDuration] = useState(500)
  // Difficulty dial stored inside pose_criteria — scales every tolerance band
  const [toleranceMultiplier, setToleranceMultiplier] = useState(1)

  // Per-criterion pass rates measured during test mode
  const testStatsRef = useRef<{ evaluated: number; passes: Record<string, number> }>({
    evaluated: 0,
    passes: {},
  })
  const [testPassRates, setTestPassRates] = useState<
    Array<{ key: string; label: string; pct: number }>
  >([])

  // Live mirrors so the test loop always validates against the latest edits
  // without restarting the camera on every keystroke.
  const testCriteriaRef = useRef<PoseCriteria>({
    targetBodyParts: [],
    criteria: [],
    levelingRules: [],
  })
  testCriteriaRef.current = {
    targetBodyParts,
    criteria: angleCriteria.map((c) => ({
      ...c,
      relativeTo: [c.relativeTo[0], c.relativeTo[1]] as [string, string],
    })),
    levelingRules: levelingRules.map((r) => ({
      ...r,
      joints: [r.joints[0], r.joints[1]] as [string, string],
    })),
    toleranceMultiplier,
    angleSpace,
  }
  const testMessagesRef = useRef(feedbackMessages)
  testMessagesRef.current = feedbackMessages

  useEffect(() => {
    loadExercise()
  }, [])

  // Playback animation
  useEffect(() => {
    if (!isPlaying || !exercise?.recorded_paths[selectedDemo]) return

    const demo = exercise.recorded_paths[selectedDemo]
    const interval = setInterval(() => {
      setCurrentFrame((prev) => {
        if (prev >= demo.frames.length - 1) {
          setIsPlaying(false)
          return 0
        }
        return prev + 1
      })
    }, 33) // ~30fps

    return () => clearInterval(interval)
  }, [isPlaying, exercise, selectedDemo])

  // Draw skeleton when frame changes
  useEffect(() => {
    if (exercise?.recorded_paths[selectedDemo]) {
      const demo = exercise.recorded_paths[selectedDemo]
      if (demo.frames[currentFrame]) {
        drawSkeleton(demo.frames[currentFrame].pose)
      }
    }
  }, [currentFrame, exercise, selectedDemo, angleCriteria, angleSpace])

  // Test loop: camera + the exact validation engine the patient session runs.
  useEffect(() => {
    if (!testMode) return

    let stream: MediaStream | null = null
    let running = true
    let raf = 0

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        })
        const video = testVideoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const ok = await initDetector(mode)
        if (!ok) {
          setTestCameraError('Failed to load pose detection model')
          return
        }
        // Same counter selection the patient session makes — against the type
        // as currently edited, not the saved one.
        const cyclic =
          exerciseType === 'dynamic' &&
          testCriteriaRef.current.criteria.some((c) => typeof c.restAngle === 'number')
        testRepCounterRef.current = cyclic
          ? new CycleRepCounter(holdDuration)
          : new GenericRepCounter(holdDuration)

        const loop = async () => {
          if (!running || !testVideoRef.current) return
          const pose = await detect(testVideoRef.current, mode)
          const analysis = analyzeExercise(pose, testCriteriaRef.current, testMessagesRef.current)
          const rep = testRepCounterRef.current!.count(analysis)
          const phase = 'phase' in rep ? (rep.phase as CyclePhase) : null
          let feedback = analysis.feedback
          let message = analysis.message
          if (phase === 'holding') {
            message = testMessagesRef.current?.hold || 'Hold it…'
          } else if (phase === 'lowering') {
            feedback = 'good'
            message = testMessagesRef.current?.return || 'Good — now return to start slowly'
          }
          setTestFeedback({ ...analysis, feedback, message })
          setTestPhase(phase)
          setTestReps(rep.repCount)
          setTestHoldProgress(rep.holdProgress)
          drawTestSkeleton(pose, feedback)

          // Per-criterion pass rate — only frames where the engine actually
          // evaluated the pose (skips "position yourself in frame" frames).
          if (analysis.feedback !== 'analyzing') {
            const stats = testStatsRef.current
            stats.evaluated++
            for (const c of testCriteriaRef.current.criteria) {
              const failed = analysis.failedCriteria.some(
                (f) => f === c.joint || f === `${c.joint}_tooLow` || f === `${c.joint}_tooHigh`
              )
              const key = `angle:${c.joint}`
              stats.passes[key] = (stats.passes[key] ?? 0) + (failed ? 0 : 1)
            }
            for (const r of testCriteriaRef.current.levelingRules) {
              const key = `level:${r.joints[0]}_${r.joints[1]}`
              const failed = analysis.failedCriteria.includes(
                `leveling_${r.joints[0]}_${r.joints[1]}`
              )
              stats.passes[key] = (stats.passes[key] ?? 0) + (failed ? 0 : 1)
            }
            if (stats.evaluated % 10 === 0) {
              setTestPassRates(
                [
                  ...testCriteriaRef.current.criteria.map((c) => ({
                    key: `angle:${c.joint}`,
                    label: formatJointName(c.joint),
                  })),
                  ...testCriteriaRef.current.levelingRules.map((r) => ({
                    key: `level:${r.joints[0]}_${r.joints[1]}`,
                    label: `${formatJointName(r.joints[0])} ↔ ${formatJointName(r.joints[1])} level`,
                  })),
                ].map(({ key, label }) => ({
                  key,
                  label,
                  pct: Math.round(((stats.passes[key] ?? 0) / stats.evaluated) * 100),
                }))
              )
            }
          }

          raf = requestAnimationFrame(loop)
        }
        loop()
      } catch (err) {
        console.error('Test camera error:', err)
        setTestCameraError('Camera access denied')
      }
    }

    start()

    return () => {
      running = false
      cancelAnimationFrame(raf)
      if (stream) stream.getTracks().forEach((t) => t.stop())
      disposeDetector()
    }
  }, [testMode, holdDuration, exerciseType])

  async function loadExercise() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('exercises')
      .select('*')
      .eq('id', resolvedParams.id)
      .single()

    if (error || !data) {
      alert('Exercise not found')
      router.push('/admin')
      return
    }

    setExercise(data as Exercise)
    setExerciseName(data.name ?? '')
    setExerciseDescription(data.description ?? '')
    if (data.exercise_type === 'static' || data.exercise_type === 'dynamic') {
      setExerciseType(data.exercise_type)
    }
    if (data.difficulty && ['beginner', 'intermediate', 'advanced'].includes(data.difficulty)) {
      setDifficulty(data.difficulty as 'beginner' | 'intermediate' | 'advanced')
    }
    if (Array.isArray(data.demo_images)) {
      setDemoImages([data.demo_images[0] ?? null, data.demo_images[1] ?? null])
    }
    const exMode: TrackingMode = (data.tracking_mode as TrackingMode) ?? 'body'
    const exRefs = referencesForMode(exMode)

    // Initialize refinement state from saved criteria — or, when none were ever
    // saved, derive a working set straight from the recording so the therapist
    // starts from real numbers instead of a blank form.
    const savedCriteria = data.pose_criteria?.criteria
    let derivedParts: string[] | null = null
    if (Array.isArray(savedCriteria) && savedCriteria.length > 0) {
      // Older rows may lack relativeTo (the editor never exposed it) — fill in
      // anatomical defaults so angles are computed against real points.
      setAngleCriteria(
        (savedCriteria as AngleCriterion[]).map((c) => ({
          ...c,
          relativeTo:
            Array.isArray(c.relativeTo) && c.relativeTo.length === 2
              ? c.relativeTo
              : [...(exRefs[c.joint] ??
                  (exMode === 'hand'
                    ? ['wrist', 'middle_finger_mcp']
                    : ['left_elbow', 'left_hip']))],
        }))
      )
    } else if (Array.isArray(data.recorded_paths) && data.recorded_paths.length > 0) {
      const derived = deriveCriteriaFromRecordings(data.recorded_paths, exMode)
      if (derived.criteria.length > 0) {
        setAngleCriteria(derived.criteria)
        derivedParts = derived.targetBodyParts
        setAngleSpace(derived.angleSpace ?? '2d')
        setAutoFilled(true)
      }
    }
    if (data.pose_criteria?.angleSpace === '3d') {
      setAngleSpace('3d')
    }
    if (data.pose_criteria?.levelingRules) {
      setLevelingRules(
        (data.pose_criteria.levelingRules as LevelingRule[]).map((r) => ({
          ...r,
          joints:
            Array.isArray(r.joints) && r.joints.length === 2
              ? r.joints
              : ['left_shoulder', 'right_shoulder'],
        }))
      )
    }
    if (derivedParts) {
      setTargetBodyParts(derivedParts)
    } else if (data.pose_criteria?.targetBodyParts) {
      setTargetBodyParts(data.pose_criteria.targetBodyParts)
    } else if ((data.pose_criteria as unknown as { detectedMovingParts?: string[] })?.detectedMovingParts) {
      // Legacy rows stored the moving parts under a different key.
      setTargetBodyParts((data.pose_criteria as unknown as { detectedMovingParts: string[] }).detectedMovingParts)
    }

    if (data.feedback_messages) {
      setFeedbackMessages(data.feedback_messages)
    }
    if (data.target_reps) {
      setTargetReps(data.target_reps)
    }
    if (data.hold_duration_ms) {
      setHoldDuration(data.hold_duration_ms)
    }
    if (typeof data.pose_criteria?.toleranceMultiplier === 'number') {
      setToleranceMultiplier(data.pose_criteria.toleranceMultiplier)
    }

    setLoading(false)
  }

  const drawSkeleton = (pose: Pose) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = 640
    canvas.height = 480

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Scale factor (recorded frames might be different resolution)
    const scaleX = canvas.width / 640
    const scaleY = canvas.height / 480

    // Paint one hand/body set: dots (+ labels on the primary) and bones.
    const paintSet = (keypoints: Pose['keypoints'], withLabels: boolean) => {
      keypoints.forEach((kp) => {
        if (kp.score && kp.score > 0.3) {
          ctx.beginPath()
          ctx.arc(kp.x * scaleX, kp.y * scaleY, mode === 'hand' ? 4 : 6, 0, 2 * Math.PI)

          // Highlight target body parts
          if (targetBodyParts.includes(kp.name || '')) {
            ctx.fillStyle = '#C4612F'
          } else {
            ctx.fillStyle = '#10b981'
          }
          ctx.fill()

          // Label — 21 hand labels are unreadable, so only mark the fingertips
          if (withLabels && kp.name && (mode !== 'hand' || kp.name.endsWith('_tip'))) {
            ctx.fillStyle = '#1F2421'
            ctx.font = '10px sans-serif'
            ctx.fillText(kp.name, kp.x * scaleX + 8, kp.y * scaleY)
          }
        }
      })

      connectionsForMode(mode).forEach(([startName, endName]) => {
        const start = keypoints.find((kp) => kp.name === startName)
        const end = keypoints.find((kp) => kp.name === endName)

        if (
          start &&
          end &&
          start.score &&
          start.score > 0.3 &&
          end.score &&
          end.score > 0.3
        ) {
          ctx.beginPath()
          ctx.moveTo(start.x * scaleX, start.y * scaleY)
          ctx.lineTo(end.x * scaleX, end.y * scaleY)
          ctx.strokeStyle = '#10b981'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      })
    }

    // Primary hand/body (with labels), then any additional detected hands.
    paintSet(pose.keypoints, true)
    pose.extraHands?.forEach((h) => paintSet(h.keypoints, false))

    // Overlay each angle criterion: dashed lines to its reference points and
    // an arc with the measured angle, so the numbers below have a visual form.
    angleCriteria.forEach((criterion) => {
      const joint = pose.keypoints.find((kp) => kp.name === criterion.joint)
      const refA = pose.keypoints.find((kp) => kp.name === criterion.relativeTo[0])
      const refB = pose.keypoints.find((kp) => kp.name === criterion.relativeTo[1])
      if (!joint || !refA || !refB) return
      if ((joint.score ?? 0) <= 0.3 || (refA.score ?? 0) <= 0.3 || (refB.score ?? 0) <= 0.3)
        return

      const jx = joint.x * scaleX
      const jy = joint.y * scaleY

      ctx.strokeStyle = '#C4612F'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      ;[refA, refB].forEach((ref) => {
        ctx.beginPath()
        ctx.moveTo(jx, jy)
        ctx.lineTo(ref.x * scaleX, ref.y * scaleY)
        ctx.stroke()
      })
      ctx.setLineDash([])

      const a1 = Math.atan2(refA.y * scaleY - jy, refA.x * scaleX - jx)
      const a2 = Math.atan2(refB.y * scaleY - jy, refB.x * scaleX - jx)
      let sweep = a2 - a1
      while (sweep > Math.PI) sweep -= 2 * Math.PI
      while (sweep < -Math.PI) sweep += 2 * Math.PI
      ctx.beginPath()
      ctx.arc(jx, jy, 26, a1, a1 + sweep, sweep < 0)
      ctx.stroke()

      // Label along the arc bisector. The canvas is CSS-mirrored, so counter-flip
      // the text or it renders backwards.
      const mid = a1 + sweep / 2
      const lx = jx + Math.cos(mid) * 44
      const ly = jy + Math.sin(mid) * 44
      ctx.save()
      ctx.scale(-1, 1)
      ctx.fillStyle = '#C4612F'
      ctx.font = 'bold 13px sans-serif'
      ctx.textAlign = 'center'
      // Label with the angle as validation measures it (3D when available) —
      // the arc itself stays a 2D screen approximation of where it sits.
      ctx.fillText(`${Math.round(measureAngle(refA, joint, refB, angleSpace))}°`, -lx, ly)
      ctx.restore()
    })
  }

  // Skeleton for the live test camera, tinted by validation result.
  const drawTestSkeleton = (pose: Pose | null, feedback: 'good' | 'adjust' | 'analyzing') => {
    const canvas = testCanvasRef.current
    const video = testVideoRef.current
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!pose) return

    const color =
      feedback === 'good' ? '#10b981' : feedback === 'adjust' ? '#ef4444' : '#9ca3af'

    const paintSet = (keypoints: Pose['keypoints']) => {
      keypoints.forEach((kp) => {
        if (kp.score && kp.score > 0.3) {
          ctx.beginPath()
          ctx.arc(kp.x, kp.y, mode === 'hand' ? 3 : 5, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }
      })

      connectionsForMode(mode).forEach(([startName, endName]) => {
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

    // Primary hand/body plus any additional detected hands.
    paintSet(pose.keypoints)
    pose.extraHands?.forEach((h) => paintSet(h.keypoints))
  }

  const startTest = () => {
    setTestCameraError(null)
    setTestFeedback(null)
    setTestReps(0)
    setTestHoldProgress(0)
    testStatsRef.current = { evaluated: 0, passes: {} }
    setTestPassRates([])
    setTestMode(true)
  }

  const stopTest = () => {
    setTestMode(false)
    setTestFeedback(null)
    setTestHoldProgress(0)
    setTestPhase(null)
  }

  // ---- Live readouts for the currently displayed frame ----

  const currentFramePose =
    exercise?.recorded_paths[selectedDemo]?.frames[currentFrame]?.pose ?? null

  const getFrameKeypoint = (pose: Pose, name: string) => {
    const kp = pose.keypoints.find((k) => k.name === name)
    // Same 0.5 confidence gate the session engine uses
    return kp && (kp.score ?? 0) >= 0.5 ? kp : null
  }

  const getFrameAngle = (criterion: AngleCriterion): number | null => {
    if (!currentFramePose) return null
    const joint = getFrameKeypoint(currentFramePose, criterion.joint)
    const pointA = getFrameKeypoint(currentFramePose, criterion.relativeTo[0])
    const pointB = getFrameKeypoint(currentFramePose, criterion.relativeTo[1])
    if (!joint || !pointA || !pointB) return null
    // Same space the criteria live in, so the readout matches validation
    return Math.round(measureAngle(pointA, joint, pointB, angleSpace))
  }

  // ---- Angle timeline: the plotted criterion's angle across the whole demo ----

  const chartCriterion =
    angleCriteria[Math.min(chartCriterionIdx, Math.max(0, angleCriteria.length - 1))]

  const chartData = useMemo(() => {
    const demo = exercise?.recorded_paths[selectedDemo]
    if (!demo || !chartCriterion) return []
    return demo.frames.map((f, i) => {
      const joint = getFrameKeypoint(f.pose, chartCriterion.joint)
      const pointA = getFrameKeypoint(f.pose, chartCriterion.relativeTo[0])
      const pointB = getFrameKeypoint(f.pose, chartCriterion.relativeTo[1])
      return {
        frame: i,
        angle:
          joint && pointA && pointB
            ? Math.round(measureAngle(pointA, joint, pointB, angleSpace))
            : null,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise, selectedDemo, chartCriterion, angleSpace])

  const getFrameLevelDiff = (rule: LevelingRule): number | null => {
    if (!currentFramePose) return null
    const joint1 = getFrameKeypoint(currentFramePose, rule.joints[0])
    const joint2 = getFrameKeypoint(currentFramePose, rule.joints[1])
    if (!joint1 || !joint2) return null
    return Math.round(Math.abs(joint1.y - joint2.y))
  }

  const autoFillFromRecording = () => {
    if (!exercise || exercise.recorded_paths.length === 0) return
    if (
      angleCriteria.length > 0 &&
      !confirm('Replace the current angle criteria with values derived from the recording?')
    ) {
      return
    }
    const derived = deriveCriteriaFromRecordings(exercise.recorded_paths, mode)
    if (derived.criteria.length === 0) {
      alert('No joints were visible reliably enough in the recording to derive criteria.')
      return
    }
    setAngleCriteria(derived.criteria)
    setTargetBodyParts(derived.targetBodyParts)
    setAngleSpace(derived.angleSpace ?? '2d')
    setAutoFilled(true)
  }

  const addAngleCriterion = () => {
    const joint = mode === 'hand' ? 'index_finger_pip' : 'left_shoulder'
    setAngleCriteria([
      ...angleCriteria,
      {
        joint,
        minAngle: 80,
        maxAngle: 100,
        targetAngle: 90,
        relativeTo: [...referencesForMode(mode)[joint]],
      },
    ])
  }

  const updateAngleCriterion = (index: number, field: keyof AngleCriterion, value: any) => {
    const updated = [...angleCriteria]
    updated[index] = { ...updated[index], [field]: value }
    // A new joint makes the old reference points meaningless — swap in the
    // anatomical defaults for that joint (still editable afterwards).
    const refs = referencesForMode(mode)
    if (field === 'joint' && refs[value]) {
      updated[index] = { ...updated[index], relativeTo: [...refs[value]] }
    }
    setAngleCriteria(updated)
  }

  const removeAngleCriterion = (index: number) => {
    setAngleCriteria(angleCriteria.filter((_, i) => i !== index))
  }

  const addLevelingRule = () => {
    setLevelingRules([
      ...levelingRules,
      {
        joints: ['left_shoulder', 'right_shoulder'],
        maxDifference: 10,
        message: 'Keep level',
      },
    ])
  }

  const updateLevelingRule = (index: number, field: keyof LevelingRule, value: any) => {
    const updated = [...levelingRules]
    updated[index] = { ...updated[index], [field]: value }
    setLevelingRules(updated)
  }

  const removeLevelingRule = (index: number) => {
    setLevelingRules(levelingRules.filter((_, i) => i !== index))
  }

  // Upload straight to storage on file pick; the URL lands in the exercises
  // row when the therapist hits Save Changes / Publish.
  const uploadDemoImage = async (slot: number, file: File) => {
    if (!exercise) return
    setUploadingSlot(slot)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${exercise.id}/slot${slot}-${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('exercise-demos')
        .upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('exercise-demos').getPublicUrl(path)
      setDemoImages((prev) => prev.map((u, i) => (i === slot ? data.publicUrl : u)))
    } catch (err: any) {
      alert('Image upload failed: ' + (err?.message ?? err))
    } finally {
      setUploadingSlot(null)
    }
  }

  const removeDemoImage = (slot: number) => {
    setDemoImages((prev) => prev.map((u, i) => (i === slot ? null : u)))
  }

  const saveRefinedCriteria = async () => {
    if (!exercise) return
    if (!exerciseName.trim()) {
      alert('Exercise name cannot be empty')
      return
    }

    const refinedCriteria = {
      targetBodyParts,
      criteria: angleCriteria,
      levelingRules,
      toleranceMultiplier,
      angleSpace,
    }

    const supabase = createClient()
    const { error } = await supabase
      .from('exercises')
      .update({
        name: exerciseName.trim(),
        description: exerciseDescription.trim() || null,
        exercise_type: exerciseType,
        difficulty,
        demo_images: demoImages.filter((u): u is string => !!u),
        pose_criteria: refinedCriteria as PoseCriteria,
        feedback_messages: feedbackMessages,
        target_reps: targetReps,
        hold_duration_ms: holdDuration,
        updated_at: new Date().toISOString(),
      })
      .eq('id', exercise.id)

    if (error) {
      alert('Failed to save: ' + error.message)
    } else {
      alert('Exercise criteria saved!')
    }
  }

  const publishExercise = async () => {
    if (!exercise) return
    if (!exerciseName.trim()) {
      alert('Exercise name cannot be empty')
      return
    }

    // Never publish an unconfigured exercise — the session engine can't validate
    // reps without at least one angle criterion or leveling rule.
    if (angleCriteria.length === 0 && levelingRules.length === 0) {
      alert('Add at least one angle criterion or leveling rule before publishing.')
      return
    }

    const supabase = createClient()
    // Commit the current refinements alongside the publish so what appears in
    // sessions matches what's shown here (not a stale earlier save).
    const { error } = await supabase
      .from('exercises')
      .update({
        name: exerciseName.trim(),
        description: exerciseDescription.trim() || null,
        exercise_type: exerciseType,
        difficulty,
        demo_images: demoImages.filter((u): u is string => !!u),
        pose_criteria: { targetBodyParts, criteria: angleCriteria, levelingRules, toleranceMultiplier, angleSpace } as PoseCriteria,
        feedback_messages: feedbackMessages,
        target_reps: targetReps,
        hold_duration_ms: holdDuration,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', exercise.id)

    if (error) {
      alert('Failed to publish: ' + error.message)
    } else {
      alert('Exercise published! It will now appear in therapy sessions.')
      router.push('/admin')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F4EF] flex items-center justify-center">
        <p className="text-[#5C635D]">Loading exercise...</p>
      </div>
    )
  }

  if (!exercise) {
    return null
  }

  const currentDemo = exercise.recorded_paths[selectedDemo]

  return (
    <div className="min-h-screen bg-[#F7F4EF] p-6">
      <div className="max-w-7xl mx-auto">
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
              Refine <em className="text-[#C4612F]">{exerciseName || exercise.name}</em>
            </h1>
            <p className="text-sm text-[#5C635D] mt-1">
              {exercise.is_active ? '✓ Published' : 'Draft'}
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-[#F2E3D6] text-[#C4612F]">
                {mode === 'hand' ? 'Hand tracking' : 'Body tracking'}
              </span>
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={saveRefinedCriteria}
              className="px-6 py-2 bg-[#C4612F] hover:bg-[#A94E22] text-white rounded-full font-medium transition-colors"
            >
              Save Changes
            </button>
            {!exercise.is_active && (
              <button
                onClick={publishExercise}
                className="px-6 py-2 bg-[#10b981] hover:bg-[#059669] text-white rounded-full font-medium transition-colors"
              >
                Publish Exercise
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Skeleton Viewer */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <h2 className="text-xl font-serif text-[#1F2421] mb-4">Motion Path</h2>

              {/* Canvas */}
              <div className="relative aspect-video bg-[#1F2421] rounded-xl overflow-hidden mb-4">
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full scale-x-[-1]"
                />
              </div>

              {/* Demo selector */}
              <div className="flex gap-2 mb-4">
                {exercise.recorded_paths.map((demo, i) => (
                  <button
                    key={demo.id}
                    onClick={() => {
                      setSelectedDemo(i)
                      setCurrentFrame(0)
                      setIsPlaying(false)
                    }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedDemo === i
                        ? 'bg-[#C4612F] text-white'
                        : 'bg-[#F7F4EF] text-[#1F2421] hover:bg-[#E7E1D7]'
                    }`}
                  >
                    Demo {i + 1}
                  </button>
                ))}
              </div>

              {/* Playback controls */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="px-4 py-2 bg-[#C4612F] hover:bg-[#A94E22] text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>
                  <button
                    onClick={() => {
                      setCurrentFrame(0)
                      setIsPlaying(false)
                    }}
                    className="px-4 py-2 bg-[#F7F4EF] hover:bg-[#E7E1D7] text-[#1F2421] rounded-lg text-sm font-medium transition-colors"
                  >
                    Reset
                  </button>
                  <span className="text-sm text-[#5C635D]">
                    Frame {currentFrame + 1} / {currentDemo?.frames.length || 0}
                  </span>
                </div>

                {/* Scrubber */}
                <input
                  type="range"
                  min="0"
                  max={(currentDemo?.frames.length || 1) - 1}
                  value={currentFrame}
                  onChange={(e) => {
                    setCurrentFrame(parseInt(e.target.value))
                    setIsPlaying(false)
                  }}
                  className="w-full"
                />
              </div>
            </div>

            {/* Angle timeline: criterion angle across the demo, band shaded */}
            {chartCriterion && chartData.length > 0 && (
              <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-serif text-[#1F2421]">Angle Timeline</h3>
                  {angleCriteria.length > 1 && (
                    <select
                      value={Math.min(chartCriterionIdx, angleCriteria.length - 1)}
                      onChange={(e) => setChartCriterionIdx(parseInt(e.target.value, 10))}
                      className="px-2 py-1 text-sm border border-[#E7E1D7] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                    >
                      {angleCriteria.map((c, i) => (
                        <option key={i} value={i}>
                          {formatJointName(c.joint)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="text-xs text-[#5C635D] mb-3">
                  {formatJointName(chartCriterion.joint)} angle across Demo {selectedDemo + 1}.
                  Green band = accepted range{typeof chartCriterion.restAngle === 'number' ? ', dashed line = rest' : ''}. Click the chart to jump the
                  playback to that frame.
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                    onClick={(st: any) => {
                      const label = st?.activeLabel
                      if (label != null && !Number.isNaN(Number(label))) {
                        setCurrentFrame(Number(label))
                        setIsPlaying(false)
                      }
                    }}
                  >
                    <XAxis
                      dataKey="frame"
                      type="number"
                      domain={[0, chartData.length - 1]}
                      tick={{ fontSize: 11, fill: '#5C635D' }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 180]}
                      ticks={[0, 45, 90, 135, 180]}
                      tick={{ fontSize: 11, fill: '#5C635D' }}
                      tickLine={false}
                      unit="°"
                    />
                    <Tooltip
                      formatter={(v: any) => [`${v}°`, formatJointName(chartCriterion.joint)]}
                      labelFormatter={(l: any) => `Frame ${Number(l) + 1}`}
                    />
                    <ReferenceArea
                      y1={chartCriterion.minAngle}
                      y2={chartCriterion.maxAngle}
                      fill="#10b981"
                      fillOpacity={0.12}
                      stroke="#10b981"
                      strokeOpacity={0.35}
                      strokeDasharray="4 4"
                    />
                    {typeof chartCriterion.restAngle === 'number' && (
                      <ReferenceLine
                        y={chartCriterion.restAngle}
                        stroke="#5C635D"
                        strokeDasharray="6 4"
                      />
                    )}
                    <ReferenceLine x={currentFrame} stroke="#C4612F" strokeWidth={1.5} />
                    <Line
                      type="monotone"
                      dataKey="angle"
                      stroke="#C4612F"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Difficulty: one dial that scales every tolerance band */}
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <h3 className="text-lg font-serif text-[#1F2421] mb-2">Difficulty</h3>
              <p className="text-xs text-[#5C635D] mb-3">
                Scales every angle and leveling tolerance at once — match it to the
                patient&apos;s mobility without editing individual angles.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Gentle', value: 1.4, hint: '40% wider bands' },
                  { label: 'Standard', value: 1, hint: 'As recorded' },
                  { label: 'Strict', value: 0.75, hint: '25% tighter bands' },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setToleranceMultiplier(opt.value)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      toleranceMultiplier === opt.value
                        ? 'bg-[#C4612F] text-white border-[#C4612F]'
                        : 'bg-white text-[#1F2421] border-[#E7E1D7] hover:border-[#C4612F]'
                    }`}
                  >
                    <span className="block">{opt.label}</span>
                    <span
                      className={`block text-[11px] font-normal ${
                        toleranceMultiplier === opt.value ? 'text-white/80' : 'text-[#5C635D]'
                      }`}
                    >
                      {opt.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Test mode: run the real session validation against current edits */}
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-serif text-[#1F2421]">Test This Exercise</h3>
                <button
                  onClick={() => (testMode ? stopTest() : startTest())}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors text-white ${
                    testMode
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-[#C4612F] hover:bg-[#A94E22]'
                  }`}
                >
                  {testMode ? 'Stop Test' : 'Start Test'}
                </button>
              </div>
              <p className="text-xs text-[#5C635D] mb-3">
                Do the exercise in front of the camera. This runs exactly the validation
                patients get, using the criteria as currently edited — no save needed.
              </p>

              {testCameraError && (
                <p className="text-sm text-red-600 mb-3">{testCameraError}</p>
              )}

              {testMode && (
                <div className="space-y-3">
                  <div className="relative aspect-video bg-[#1F2421] rounded-xl overflow-hidden">
                    <video
                      ref={testVideoRef}
                      className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                      playsInline
                      muted
                    />
                    <canvas
                      ref={testCanvasRef}
                      className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                    />
                    {testFeedback && (
                      <div
                        className={`absolute top-3 left-3 right-3 px-3 py-2 rounded-lg text-sm font-medium text-white ${
                          testFeedback.feedback === 'good'
                            ? 'bg-[#10b981]/90'
                            : testFeedback.feedback === 'adjust'
                              ? 'bg-red-600/90'
                              : 'bg-black/60'
                        }`}
                      >
                        {testFeedback.message}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[#1F2421]">
                      Reps: {testReps}
                    </span>
                    {testPhase && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#F2E3D6] text-[#C4612F]">
                        {
                          { rest: 'Ready', lifting: 'Move', holding: 'Hold', lowering: 'Return' }[
                            testPhase
                          ]
                        }
                      </span>
                    )}
                    <div className="flex-1 h-2 bg-[#E7E1D7] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#10b981] transition-[width]"
                        style={{ width: `${Math.round(testHoldProgress * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Per-criterion pass rate — spots the one that's too tight */}
                  {testPassRates.length > 0 && (
                    <div className="border-t border-[#E7E1D7] pt-3 space-y-2">
                      <p className="text-xs font-medium text-[#1F2421]">
                        Criteria pass rate (share of frames passing while you test)
                      </p>
                      {testPassRates.map((r) => (
                        <div key={r.key} className="flex items-center gap-2">
                          <span className="text-xs text-[#5C635D] w-40 truncate">{r.label}</span>
                          <div className="flex-1 h-2 bg-[#E7E1D7] rounded-full overflow-hidden">
                            <div
                              className="h-full transition-[width]"
                              style={{
                                width: `${r.pct}%`,
                                background:
                                  r.pct >= 80 ? '#10b981' : r.pct >= 50 ? '#f59e0b' : '#ef4444',
                              }}
                            />
                          </div>
                          <span
                            className="text-xs font-medium w-10 text-right"
                            style={{
                              color: r.pct >= 80 ? '#10b981' : r.pct >= 50 ? '#f59e0b' : '#ef4444',
                            }}
                          >
                            {r.pct}%
                          </span>
                        </div>
                      ))}
                      {testPassRates.some((r) => r.pct < 50) && (
                        <p className="text-xs text-[#ef4444]">
                          A criterion under 50% is probably too tight — widen its range or
                          switch difficulty to Gentle.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Detected Moving Parts */}
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <h3 className="text-lg font-serif text-[#1F2421] mb-3">Target Body Parts</h3>
              <p className="text-xs text-[#5C635D] mb-3">
                Auto-detected from your recordings. These parts will be tracked during exercises.
              </p>
              <div className="flex flex-wrap gap-2">
                {targetBodyParts.length > 0 ? (
                  targetBodyParts.map((part) => (
                    <span
                      key={part}
                      className="px-3 py-1 bg-[#F2E3D6] text-[#C4612F] text-sm rounded-full font-medium"
                    >
                      {part}
                    </span>
                  ))
                ) : (
                  <p className="text-sm text-[#5C635D]">No body parts detected yet</p>
                )}
              </div>
            </div>
          </div>

          {/* Right: Criteria Editor */}
          <div className="space-y-4">
            {/* Exercise Details — editable metadata, saved with Save Changes / Publish */}
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <h3 className="text-lg font-serif text-[#1F2421] mb-4">Exercise Details</h3>

              <div className="space-y-4">
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
                    rows={2}
                    className="w-full px-3 py-2 border border-[#E7E1D7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C4612F]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#1F2421] mb-1">
                      Exercise Type
                    </label>
                    <select
                      value={exerciseType}
                      onChange={(e) => setExerciseType(e.target.value as 'static' | 'dynamic')}
                      className="w-full px-3 py-2 border border-[#E7E1D7] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C4612F]"
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
                      className="w-full px-3 py-2 border border-[#E7E1D7] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#C4612F]"
                    >
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#1F2421] mb-1">
                    Demo Pictures
                  </label>
                  <p className="text-xs text-[#5C635D] mb-2">
                    Two photos of the movement (e.g. start and end position) — patients see
                    them alternating on the &quot;Ready?&quot; screen before the exercise starts.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {[0, 1].map((slot) => (
                      <div key={slot}>
                        {demoImages[slot] ? (
                          <div className="relative aspect-[4/3] rounded-lg overflow-hidden border border-[#E7E1D7] group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={demoImages[slot] as string}
                              alt={`Demo picture ${slot + 1}`}
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                            <button
                              onClick={() => removeDemoImage(slot)}
                              className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-black/60 text-white hover:bg-red-600 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <label
                            className={`flex flex-col items-center justify-center aspect-[4/3] rounded-lg border-2 border-dashed border-[#E7E1D7] text-[#5C635D] text-sm cursor-pointer hover:border-[#C4612F] hover:text-[#C4612F] transition-colors ${
                              uploadingSlot === slot ? 'opacity-60 pointer-events-none' : ''
                            }`}
                          >
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) uploadDemoImage(slot, file)
                                e.target.value = ''
                              }}
                            />
                            {uploadingSlot === slot ? 'Uploading…' : `+ Picture ${slot + 1}`}
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Angle Criteria */}
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-serif text-[#1F2421]">Angle Criteria</h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={autoFillFromRecording}
                    className="text-sm text-[#C4612F] hover:text-[#A94E22] font-medium"
                    title="Compute target angles and tolerances from the recorded demo"
                  >
                    ↻ Auto-fill from recording
                  </button>
                  <button
                    onClick={addAngleCriterion}
                    className="text-sm text-[#C4612F] hover:text-[#A94E22] font-medium"
                  >
                    + Add Angle
                  </button>
                </div>
              </div>

              {autoFilled && (
                <div className="mb-4 px-3 py-2 bg-[#F2E3D6] text-[#8A4A1F] text-xs rounded-lg">
                  Criteria were auto-derived from the recording — review the values, adjust if
                  needed, then save.
                </div>
              )}

              <div className="space-y-4">
                {angleCriteria.map((criterion, i) => {
                  const frameAngle = getFrameAngle(criterion)
                  const inRange =
                    frameAngle !== null &&
                    frameAngle >= criterion.minAngle &&
                    frameAngle <= criterion.maxAngle

                  return (
                    <div key={i} className="p-4 bg-[#F7F4EF] rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[#1F2421]">Angle {i + 1}</span>
                        <button
                          onClick={() => removeAngleCriterion(i)}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>

                      <p className="text-xs italic text-[#5C635D]">
                        {typeof criterion.restAngle === 'number'
                          ? `${formatJointName(criterion.joint)} starts near ${criterion.restAngle}°, moves to about ${criterion.targetAngle}° (accepted ${criterion.minAngle}°–${criterion.maxAngle}°), holds, then returns to finish the rep.`
                          : `${formatJointName(criterion.joint)} at about ${criterion.targetAngle}°, accepted between ${criterion.minAngle}° and ${criterion.maxAngle}° — shown as the orange arc on the skeleton.`}
                      </p>

                      <div>
                        <label className="block text-xs text-[#5C635D] mb-1">
                          Joint (angle is measured here)
                        </label>
                        <select
                          value={criterion.joint}
                          onChange={(e) => updateAngleCriterion(i, 'joint', e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                        >
                          {keypointNamesForMode(mode).map((name) => (
                            <option key={name} value={name}>
                              {formatJointName(name)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-[#5C635D] mb-1">
                          Between these two points
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <select
                            value={criterion.relativeTo[0]}
                            onChange={(e) =>
                              updateAngleCriterion(i, 'relativeTo', [
                                e.target.value,
                                criterion.relativeTo[1],
                              ])
                            }
                            className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                          >
                            {keypointNamesForMode(mode).map((name) => (
                              <option key={name} value={name}>
                                {formatJointName(name)}
                              </option>
                            ))}
                          </select>
                          <select
                            value={criterion.relativeTo[1]}
                            onChange={(e) =>
                              updateAngleCriterion(i, 'relativeTo', [
                                criterion.relativeTo[0],
                                e.target.value,
                              ])
                            }
                            className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                          >
                            {keypointNamesForMode(mode).map((name) => (
                              <option key={name} value={name}>
                                {formatJointName(name)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="text-[11px] text-[#5C635D] mt-1">
                          The angle is formed at the joint by the lines to these two points.
                        </p>
                      </div>

                      <div className="grid grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs text-[#5C635D] mb-1">Rest (°)</label>
                          <input
                            type="number"
                            value={criterion.restAngle ?? ''}
                            placeholder="—"
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10)
                              updateAngleCriterion(i, 'restAngle', Number.isNaN(v) ? undefined : v)
                            }}
                            className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#5C635D] mb-1">Target (°)</label>
                          <input
                            type="number"
                            value={criterion.targetAngle}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10)
                              updateAngleCriterion(i, 'targetAngle', Number.isNaN(v) ? 0 : v)
                            }}
                            className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#5C635D] mb-1">Min (°)</label>
                          <input
                            type="number"
                            value={criterion.minAngle}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10)
                              updateAngleCriterion(i, 'minAngle', Number.isNaN(v) ? 0 : v)
                            }}
                            className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#5C635D] mb-1">Max (°)</label>
                          <input
                            type="number"
                            value={criterion.maxAngle}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10)
                              updateAngleCriterion(i, 'maxAngle', Number.isNaN(v) ? 0 : v)
                            }}
                            className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                          />
                        </div>
                      </div>

                      <div
                        className={`flex items-center justify-between px-3 py-2 rounded text-xs font-medium ${
                          frameAngle === null
                            ? 'bg-[#E7E1D7] text-[#5C635D]'
                            : inRange
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        <span>Angle in this frame</span>
                        <span>
                          {frameAngle === null
                            ? 'joint not visible'
                            : `${frameAngle}° ${inRange ? '✓ in range' : '✗ out of range'}`}
                        </span>
                      </div>
                    </div>
                  )
                })}

                {angleCriteria.length === 0 && (
                  <p className="text-sm text-[#5C635D] text-center py-4">
                    No angle criteria yet. Auto-fill them from the recording or add one manually.
                  </p>
                )}
              </div>
            </div>

            {/* Leveling Rules */}
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-serif text-[#1F2421]">Leveling Rules</h3>
                <button
                  onClick={addLevelingRule}
                  className="text-sm text-[#C4612F] hover:text-[#A94E22] font-medium"
                >
                  + Add Rule
                </button>
              </div>

              {mode === 'hand' && (
                <p className="text-xs text-[#5C635D] mb-3">
                  Leveling compares vertical pixel positions — rarely useful for hand
                  exercises, where finger angles do the work.
                </p>
              )}

              <div className="space-y-3">
                {levelingRules.map((rule, i) => {
                  const frameDiff = getFrameLevelDiff(rule)
                  const isLevel = frameDiff !== null && frameDiff <= rule.maxDifference

                  return (
                    <div key={i} className="p-3 bg-[#F7F4EF] rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[#1F2421]">Rule {i + 1}</span>
                        <button
                          onClick={() => removeLevelingRule(i)}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>

                      <div>
                        <label className="block text-xs text-[#5C635D] mb-1">
                          Keep these two joints level
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <select
                            value={rule.joints[0]}
                            onChange={(e) =>
                              updateLevelingRule(i, 'joints', [e.target.value, rule.joints[1]])
                            }
                            className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                          >
                            {keypointNamesForMode(mode).map((name) => (
                              <option key={name} value={name}>
                                {formatJointName(name)}
                              </option>
                            ))}
                          </select>
                          <select
                            value={rule.joints[1]}
                            onChange={(e) =>
                              updateLevelingRule(i, 'joints', [rule.joints[0], e.target.value])
                            }
                            className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                          >
                            {keypointNamesForMode(mode).map((name) => (
                              <option key={name} value={name}>
                                {formatJointName(name)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-[#5C635D] mb-1">
                          Max Height Difference (px)
                        </label>
                        <input
                          type="number"
                          value={rule.maxDifference}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10)
                            updateLevelingRule(i, 'maxDifference', Number.isNaN(v) ? 0 : v)
                          }}
                          className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-[#5C635D] mb-1">Message</label>
                        <input
                          type="text"
                          value={rule.message}
                          onChange={(e) => updateLevelingRule(i, 'message', e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                        />
                      </div>

                      <div
                        className={`flex items-center justify-between px-3 py-2 rounded text-xs font-medium ${
                          frameDiff === null
                            ? 'bg-[#E7E1D7] text-[#5C635D]'
                            : isLevel
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        <span>Difference in this frame</span>
                        <span>
                          {frameDiff === null
                            ? 'joint not visible'
                            : `${frameDiff}px ${isLevel ? '✓ level' : '✗ not level'}`}
                        </span>
                      </div>
                    </div>
                  )
                })}

                {levelingRules.length === 0 && (
                  <p className="text-sm text-[#5C635D] text-center py-4">
                    No leveling rules yet. Add one to enforce symmetry.
                  </p>
                )}
              </div>
            </div>

            {/* Exercise Settings */}
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <h3 className="text-lg font-serif text-[#1F2421] mb-4">Exercise Settings</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#1F2421] mb-1">
                    Target Reps
                  </label>
                  <input
                    type="number"
                    value={targetReps}
                    onChange={(e) => setTargetReps(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-[#E7E1D7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C4612F]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#1F2421] mb-1">
                    Hold Duration (ms)
                  </label>
                  <input
                    type="number"
                    value={holdDuration}
                    onChange={(e) => setHoldDuration(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-[#E7E1D7] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C4612F]"
                  />
                </div>
              </div>
            </div>

            {/* Feedback Messages */}
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <h3 className="text-lg font-serif text-[#1F2421] mb-4">Feedback Messages</h3>

              <div className="space-y-3">
                {Object.entries(feedbackMessages).map(([key, value]) => (
                  <div key={key}>
                    <label className="block text-xs text-[#5C635D] mb-1 capitalize">
                      {key.replace(/([A-Z])/g, ' $1')}
                    </label>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) =>
                        setFeedbackMessages({ ...feedbackMessages, [key]: e.target.value })
                      }
                      className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
