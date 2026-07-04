'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  initPoseDetector,
  detectPose,
  disposePoseDetector,
  type Pose,
} from '@/lib/poseDetection'

type RecordingState = 'setup' | 'countdown' | 'recording' | 'reviewing' | 'saving'

interface RecordedFrame {
  timestamp: number
  pose: Pose
}

interface RecordedDemo {
  id: string
  frames: RecordedFrame[]
  duration: number
  recordedAt: Date
}

export default function NewExercisePage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | undefined>(undefined)
  const recordingStartTime = useRef<number>(0)

  const [recordingState, setRecordingState] = useState<RecordingState>('setup')
  const [countdown, setCountdown] = useState(3)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [currentPose, setCurrentPose] = useState<Pose | null>(null)
  const [recordings, setRecordings] = useState<RecordedDemo[]>([])
  const [currentRecording, setCurrentRecording] = useState<RecordedFrame[]>([])

  // Exercise metadata
  const [exerciseName, setExerciseName] = useState('')
  const [exerciseDescription, setExerciseDescription] = useState('')
  const [exerciseType, setExerciseType] = useState<'static' | 'dynamic'>('dynamic')
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner')

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

        const success = await initPoseDetector()
        if (!success) {
          setCameraError('Failed to load pose detection model')
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
      disposePoseDetector()
    }
  }, [])

  // Pose detection loop
  useEffect(() => {
    if (!videoRef.current || recordingState === 'setup') return

    let isRunning = true

    const detectLoop = async () => {
      if (!isRunning || !videoRef.current) return

      const pose = await detectPose(videoRef.current)
      setCurrentPose(pose)

      // If recording, capture frame
      if (recordingState === 'recording' && pose) {
        const timestamp = Date.now() - recordingStartTime.current
        setCurrentRecording((prev) => [...prev, { timestamp, pose }])
      }

      // Draw skeleton on canvas
      if (pose && canvasRef.current) {
        drawSkeleton(pose)
      }

      animationFrameRef.current = requestAnimationFrame(detectLoop)
    }

    detectLoop()

    return () => {
      isRunning = false
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [recordingState])

  // Countdown before recording
  useEffect(() => {
    if (recordingState !== 'countdown') return

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          setRecordingState('recording')
          recordingStartTime.current = Date.now()
          setCurrentRecording([])
          return 3
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [recordingState])

  const drawSkeleton = (pose: Pose) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Match canvas size to video
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw keypoints
    pose.keypoints.forEach((kp) => {
      if (kp.score && kp.score > 0.3) {
        ctx.beginPath()
        ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI)
        ctx.fillStyle = recordingState === 'recording' ? '#ef4444' : '#10b981'
        ctx.fill()
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
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
        ctx.strokeStyle = recordingState === 'recording' ? '#ef4444' : '#10b981'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    })
  }

  const startRecording = () => {
    setRecordingState('countdown')
    setCountdown(3)
  }

  const stopRecording = () => {
    if (currentRecording.length === 0) {
      alert('No frames recorded. Try again.')
      setRecordingState('setup')
      return
    }

    const demo: RecordedDemo = {
      id: `demo-${Date.now()}`,
      frames: currentRecording,
      duration: currentRecording[currentRecording.length - 1].timestamp,
      recordedAt: new Date(),
    }

    setRecordings((prev) => [...prev, demo])
    setCurrentRecording([])
    setRecordingState('reviewing')
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

      // Auto-detect angles and moving body parts from recordings
      const detectedCriteria = analyzeRecordings(recordings)

      const { data, error } = await supabase.from('exercises').insert({
        name: exerciseName,
        description: exerciseDescription || null,
        exercise_type: exerciseType,
        difficulty: difficulty,
        recorded_paths: recordings.map((r) => ({
          id: r.id,
          frames: r.frames,
          duration: r.duration,
          recordedAt: r.recordedAt.toISOString(),
        })),
        pose_criteria: detectedCriteria,
        is_active: false, // Draft until refined in Phase 4
      })

      if (error) throw error

      alert('Exercise saved as draft! You can refine it in the editor.')
      router.push('/admin')
    } catch (error) {
      console.error('Save error:', error)
      alert('Failed to save exercise')
      setRecordingState('reviewing')
    }
  }

  // Auto-detect angles and moving body parts from recorded demonstrations
  const analyzeRecordings = (demos: RecordedDemo[]) => {
    // Placeholder for Phase 3 - will be enhanced in Phase 4
    // For now, just identify which body parts moved significantly
    const movingParts: Set<string> = new Set()
    const angleRanges: Record<string, { min: number; max: number }> = {}

    demos.forEach((demo) => {
      if (demo.frames.length < 2) return

      const firstFrame = demo.frames[0].pose
      const lastFrame = demo.frames[demo.frames.length - 1].pose

      // Compare keypoint positions to detect movement
      firstFrame.keypoints.forEach((startKp, i) => {
        const endKp = lastFrame.keypoints[i]
        if (!startKp.name || !endKp.name) return

        const distance = Math.sqrt(
          Math.pow(endKp.x - startKp.x, 2) + Math.pow(endKp.y - startKp.y, 2)
        )

        // If moved more than 50 pixels, mark as moving
        if (distance > 50) {
          movingParts.add(startKp.name)
        }
      })
    })

    return {
      detectedMovingParts: Array.from(movingParts),
      angleRanges: angleRanges,
      needsRefinement: true,
      autoDetectedAt: new Date().toISOString(),
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
                      className="absolute inset-0 w-full h-full scale-x-[-1]"
                    />

                    {/* Recording indicator */}
                    {recordingState === 'recording' && (
                      <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded-full">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                        <span className="text-sm font-medium">Recording</span>
                      </div>
                    )}

                    {/* Countdown overlay */}
                    {recordingState === 'countdown' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <div className="text-8xl font-bold text-white">{countdown}</div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Recording controls */}
              <div className="mt-4 flex items-center justify-center gap-4">
                {recordingState === 'setup' && (
                  <button
                    onClick={startRecording}
                    className="px-6 py-3 bg-[#C4612F] hover:bg-[#A94E22] text-white rounded-full font-medium transition-colors"
                  >
                    Start Recording Demo
                  </button>
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
                    <button
                      onClick={() => setRecordingState('setup')}
                      className="px-6 py-3 bg-[#C4612F] hover:bg-[#A94E22] text-white rounded-full font-medium transition-colors"
                    >
                      Record Another Demo
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
                        <p className="text-sm font-medium text-[#1F2421]">Demo {i + 1}</p>
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
                <li>Record 2-3 demonstrations</li>
                <li>System auto-detects moving body parts</li>
                <li>Save as draft for refinement</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
