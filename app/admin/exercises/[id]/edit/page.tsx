'use client'

import { use, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Pose } from '@/lib/poseDetection'

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
}

interface AngleCriterion {
  joint: string
  minAngle: number
  maxAngle: number
  targetAngle: number
  relativeTo: string[]
}

interface LevelingRule {
  joints: string[]
  maxDifference: number
  message: string
}

export default function EditExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [loading, setLoading] = useState(true)
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [selectedDemo, setSelectedDemo] = useState<number>(0)
  const [currentFrame, setCurrentFrame] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState(false)

  // Refinement state
  const [angleCriteria, setAngleCriteria] = useState<AngleCriterion[]>([])
  const [levelingRules, setLevelingRules] = useState<LevelingRule[]>([])
  const [targetBodyParts, setTargetBodyParts] = useState<string[]>([])
  const [feedbackMessages, setFeedbackMessages] = useState<Record<string, string>>({
    perfect: 'Perfect form!',
    tooLow: 'Raise higher',
    tooHigh: 'Lower slightly',
    notLevel: 'Keep level',
  })
  const [targetReps, setTargetReps] = useState(10)
  const [holdDuration, setHoldDuration] = useState(500)

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
  }, [currentFrame, exercise, selectedDemo])

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

    // Initialize refinement state from existing criteria or auto-detected
    if (data.pose_criteria?.criteria) {
      setAngleCriteria(data.pose_criteria.criteria)
    }
    if (data.pose_criteria?.levelingRules) {
      setLevelingRules(data.pose_criteria.levelingRules)
    }
    if (data.pose_criteria?.targetBodyParts) {
      setTargetBodyParts(data.pose_criteria.targetBodyParts)
    } else if (data.pose_criteria?.detectedMovingParts) {
      setTargetBodyParts(data.pose_criteria.detectedMovingParts)
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

    // Draw keypoints
    pose.keypoints.forEach((kp) => {
      if (kp.score && kp.score > 0.3) {
        ctx.beginPath()
        ctx.arc(kp.x * scaleX, kp.y * scaleY, 6, 0, 2 * Math.PI)

        // Highlight target body parts
        if (targetBodyParts.includes(kp.name || '')) {
          ctx.fillStyle = '#C4612F'
        } else {
          ctx.fillStyle = '#10b981'
        }
        ctx.fill()

        // Label
        if (kp.name) {
          ctx.fillStyle = '#1F2421'
          ctx.font = '10px sans-serif'
          ctx.fillText(kp.name, kp.x * scaleX + 8, kp.y * scaleY)
        }
      }
    })

    // Draw skeleton connections
    const connections = [
      ['left_shoulder', 'right_shoulder'],
      ['left_shoulder', 'left_elbow'],
      ['left_elbow', 'left_wrist'],
      ['right_shoulder', 'right_elbow'],
      ['right_elbow', 'right_wrist'],
      ['left_shoulder', 'left_hip'],
      ['right_shoulder', 'right_hip'],
      ['left_hip', 'right_hip'],
      ['left_hip', 'left_knee'],
      ['left_knee', 'left_ankle'],
      ['right_hip', 'right_knee'],
      ['right_knee', 'right_ankle'],
    ]

    connections.forEach(([startName, endName]) => {
      const start = pose.keypoints.find((kp) => kp.name === startName)
      const end = pose.keypoints.find((kp) => kp.name === endName)

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

  const addAngleCriterion = () => {
    setAngleCriteria([
      ...angleCriteria,
      {
        joint: 'left_shoulder',
        minAngle: 80,
        maxAngle: 100,
        targetAngle: 90,
        relativeTo: ['left_elbow', 'left_hip'],
      },
    ])
  }

  const updateAngleCriterion = (index: number, field: keyof AngleCriterion, value: any) => {
    const updated = [...angleCriteria]
    updated[index] = { ...updated[index], [field]: value }
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

  const saveRefinedCriteria = async () => {
    if (!exercise) return

    const refinedCriteria = {
      targetBodyParts,
      criteria: angleCriteria,
      levelingRules,
    }

    const supabase = createClient()
    const { error } = await supabase
      .from('exercises')
      .update({
        pose_criteria: refinedCriteria,
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

    const supabase = createClient()
    const { error } = await supabase
      .from('exercises')
      .update({
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
              Refine <em className="text-[#C4612F]">{exercise.name}</em>
            </h1>
            <p className="text-sm text-[#5C635D] mt-1">
              {exercise.is_active ? '✓ Published' : 'Draft'}
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
            {/* Angle Criteria */}
            <div className="bg-white rounded-2xl p-6 border border-[#E7E1D7]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-serif text-[#1F2421]">Angle Criteria</h3>
                <button
                  onClick={addAngleCriterion}
                  className="text-sm text-[#C4612F] hover:text-[#A94E22] font-medium"
                >
                  + Add Angle
                </button>
              </div>

              <div className="space-y-4">
                {angleCriteria.map((criterion, i) => (
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

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-[#5C635D] mb-1">Joint</label>
                        <input
                          type="text"
                          value={criterion.joint}
                          onChange={(e) => updateAngleCriterion(i, 'joint', e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#5C635D] mb-1">Target Angle</label>
                        <input
                          type="number"
                          value={criterion.targetAngle}
                          onChange={(e) =>
                            updateAngleCriterion(i, 'targetAngle', parseInt(e.target.value))
                          }
                          className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#5C635D] mb-1">Min Angle</label>
                        <input
                          type="number"
                          value={criterion.minAngle}
                          onChange={(e) =>
                            updateAngleCriterion(i, 'minAngle', parseInt(e.target.value))
                          }
                          className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#5C635D] mb-1">Max Angle</label>
                        <input
                          type="number"
                          value={criterion.maxAngle}
                          onChange={(e) =>
                            updateAngleCriterion(i, 'maxAngle', parseInt(e.target.value))
                          }
                          className="w-full px-2 py-1 text-sm border border-[#E7E1D7] rounded focus:outline-none focus:ring-1 focus:ring-[#C4612F]"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {angleCriteria.length === 0 && (
                  <p className="text-sm text-[#5C635D] text-center py-4">
                    No angle criteria yet. Add one to get started.
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

              <div className="space-y-3">
                {levelingRules.map((rule, i) => (
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
                        Max Difference (degrees)
                      </label>
                      <input
                        type="number"
                        value={rule.maxDifference}
                        onChange={(e) =>
                          updateLevelingRule(i, 'maxDifference', parseInt(e.target.value))
                        }
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
                  </div>
                ))}

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
