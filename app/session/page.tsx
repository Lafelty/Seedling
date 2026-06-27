'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProgress } from '@/lib/progress'
import {
  initPoseDetector,
  detectPose,
  analyzeShoulderRaise,
  RepCounter,
  disposePoseDetector,
  type Pose,
} from '@/lib/poseDetection'

type SessionState = 'loading' | 'countdown' | 'active' | 'paused' | 'completed'
type PostureFeedback = 'good' | 'adjust' | 'analyzing'

export default function SessionPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const repCounterRef = useRef<RepCounter>(new RepCounter())
  const animationFrameRef = useRef<number | undefined>(undefined)

  const [repCount, setRepCount] = useState(0)
  const [sessionState, setSessionState] = useState<SessionState>('loading')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [postureFeedback, setPostureFeedback] = useState<PostureFeedback>('analyzing')
  const [feedbackMessage, setFeedbackMessage] = useState('Reading your movement...')
  const [countdown, setCountdown] = useState(3)
  const [showExitPrompt, setShowExitPrompt] = useState(false)
  const [detectedPose, setDetectedPose] = useState<Pose | null>(null)

  const TARGET_REPS = 10

  useEffect(() => {
    let stream: MediaStream | null = null

    async function setupCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        })

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await new Promise((resolve) => {
            if (videoRef.current) {
              videoRef.current.onloadedmetadata = resolve
            }
          })
          await videoRef.current.play()
        }

        // Initialize pose detector
        const initialized = await initPoseDetector()
        if (!initialized) {
          console.warn('Pose detector failed to initialize, continuing without AI')
        }

        // Start with countdown
        setSessionState('countdown')
      } catch (err) {
        console.error('Camera error:', err)
        setCameraError('Camera access denied. Please allow camera access to continue.')
      }
    }

    setupCamera()

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

  // Countdown effect
  useEffect(() => {
    if (sessionState === 'countdown' && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1)
      }, 1000)
      return () => clearTimeout(timer)
    } else if (sessionState === 'countdown' && countdown === 0) {
      setSessionState('active')
    }
  }, [sessionState, countdown])

  // Real-time pose detection loop (only when active)
  useEffect(() => {
    if (sessionState !== 'active' || !videoRef.current) return

    async function detectAndAnalyze() {
      if (!videoRef.current || sessionState !== 'active') return

      // Detect pose
      const pose = await detectPose(videoRef.current)
      setDetectedPose(pose)

      // Analyze shoulder raise
      const analysis = analyzeShoulderRaise(pose)
      setPostureFeedback(analysis.feedback)
      setFeedbackMessage(analysis.message)

      // Count reps
      const { repCount: newCount, justCompleted } = repCounterRef.current.count(analysis)
      if (justCompleted) {
        setRepCount(newCount)
        if (newCount >= TARGET_REPS) {
          completeSession()
          return
        }
      }

      // Continue loop
      animationFrameRef.current = requestAnimationFrame(detectAndAnalyze)
    }

    detectAndAnalyze()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [sessionState])

  function completeSession() {
    setSessionState('completed')
    updateProgress(1) // Award 1 star
  }

  function handlePause() {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    setSessionState('paused')
  }

  function handleResume() {
    setCountdown(3)
    setSessionState('countdown')
  }

  function handleExit() {
    if (repCount > 0 && sessionState !== 'completed') {
      setShowExitPrompt(true)
    } else {
      router.push('/')
    }
  }

  function handleExitWithSave() {
    // Save partial progress (proportional stars)
    if (repCount > 0) {
      const partialStars = Math.floor((repCount / TARGET_REPS) * 1)
      if (partialStars > 0) {
        updateProgress(partialStars)
      }
    }
    router.push('/')
  }

  function handleExitWithoutSave() {
    router.push('/')
  }

  const feedbackColor = {
    good: 'var(--session-primary)',
    adjust: 'var(--session-accent)',
    analyzing: 'var(--session-muted)',
  }

  if (cameraError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-session-bg text-session-ink">
        <div className="text-center max-w-md px-8">
          <p className="text-xl mb-6">{cameraError}</p>
          <div className="flex flex-col gap-4">
            <button
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-session-primary text-white rounded-full hover:opacity-90 transition-opacity"
            >
              Reload and Try Again
            </button>
            <button
              onClick={() => router.push('/')}
              className="px-8 py-3 bg-session-surface text-session-ink rounded-full hover:bg-session-surface/80 transition-colors"
            >
              Return to Dashboard
            </button>
          </div>
          <p className="text-sm text-session-muted mt-6">
            Chrome: Click 🔒 in address bar → Camera → Allow
          </p>
        </div>
      </div>
    )
  }

  if (sessionState === 'completed') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-session-bg text-session-ink">
        <div className="text-center max-w-md px-8">
          <h1 className="text-4xl font-display mb-4">Session Complete! 🌱</h1>
          <p className="text-session-muted text-lg mb-8">You earned 1 star</p>
          <button
            onClick={() => router.push('/')}
            className="px-10 py-4 bg-session-primary text-white rounded-full hover:opacity-90 transition-opacity font-display text-lg"
          >
            View My Tree
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-session-bg text-session-ink overflow-hidden">
      {/* Camera feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
      />

      {/* Skeleton overlay - actual pose keypoints */}
      {sessionState === 'active' && detectedPose && videoRef.current && (
        <svg
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${videoRef.current.videoWidth} ${videoRef.current.videoHeight}`}
          style={{ width: '100%', height: '100%' }}
        >
          {detectedPose.keypoints
            .filter((kp) => (kp.score ?? 0) > 0.3)
            .map((kp, i) => (
              <circle
                key={i}
                cx={kp.x}
                cy={kp.y}
                r="6"
                fill="var(--session-primary)"
                opacity="0.8"
              />
            ))}

          {/* Draw skeleton connections */}
          {(() => {
            const connections = [
              ['left_shoulder', 'right_shoulder'],
              ['left_shoulder', 'left_elbow'],
              ['left_elbow', 'left_wrist'],
              ['right_shoulder', 'right_elbow'],
              ['right_elbow', 'right_wrist'],
            ];

            return connections.map(([start, end], i) => {
              const startKp = detectedPose.keypoints.find((kp) => kp.name === start);
              const endKp = detectedPose.keypoints.find((kp) => kp.name === end);

              if (
                startKp &&
                endKp &&
                (startKp.score ?? 0) > 0.3 &&
                (endKp.score ?? 0) > 0.3
              ) {
                return (
                  <line
                    key={i}
                    x1={startKp.x}
                    y1={startKp.y}
                    x2={endKp.x}
                    y2={endKp.y}
                    stroke="var(--session-primary)"
                    strokeWidth="3"
                    opacity="0.6"
                  />
                );
              }
              return null;
            });
          })()}
        </svg>
      )}

      {/* Countdown overlay */}
      {sessionState === 'countdown' && countdown > 0 && (
        <div className="absolute inset-0 bg-session-bg/80 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="text-center">
            <p className="text-session-muted text-lg mb-4 font-display">Starting in</p>
            <p className="text-8xl font-display font-bold text-session-primary">{countdown}</p>
          </div>
        </div>
      )}

      {/* Exit confirmation prompt */}
      {showExitPrompt && (
        <div className="absolute inset-0 bg-session-bg/90 backdrop-blur-md flex items-center justify-center z-30">
          <div className="bg-session-surface p-8 rounded-2xl max-w-md mx-4 text-center">
            <h3 className="font-display text-2xl mb-4">End session?</h3>
            <p className="text-session-muted mb-2">You've completed {repCount} of {TARGET_REPS} reps</p>
            <p className="text-sm text-session-muted mb-6">Your progress will be saved</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleExitWithSave}
                className="px-6 py-3 bg-session-primary text-white rounded-full hover:opacity-90 transition-opacity font-display"
              >
                Save & Exit
              </button>
              <button
                onClick={() => setShowExitPrompt(false)}
                className="px-6 py-3 bg-session-surface border-2 border-session-primary text-session-ink rounded-full hover:bg-session-bg transition-colors font-display"
              >
                Keep Going
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paused overlay */}
      {sessionState === 'paused' && (
        <div className="absolute inset-0 bg-session-bg/80 backdrop-blur-md flex items-center justify-center z-20">
          <div className="text-center max-w-md px-8">
            <h2 className="font-display text-3xl mb-4">Paused</h2>
            <p className="text-session-muted mb-2">{repCount} / {TARGET_REPS} reps completed</p>
            <p className="text-sm text-session-muted mb-8">Take your time</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleResume}
                className="px-8 py-4 bg-session-primary text-white rounded-full hover:opacity-90 transition-opacity font-display text-lg"
              >
                Resume Session
              </button>
              <button
                onClick={handleExit}
                className="px-6 py-3 text-session-muted hover:text-session-ink transition-colors"
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
          <div className="bg-session-surface/80 backdrop-blur-sm px-6 py-3 rounded-full">
            <p className="font-display text-session-ink">
              Reps: <span className="text-session-primary font-semibold">{repCount}</span> / {TARGET_REPS}
            </p>
          </div>

          <div className="flex gap-3">
            {sessionState === 'active' && (
              <button
                onClick={handlePause}
                className="w-12 h-12 flex items-center justify-center bg-session-surface/80 backdrop-blur-sm rounded-full hover:bg-session-surface transition-colors"
                aria-label="Pause session"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              </button>
            )}

            <button
              onClick={handleExit}
              className="w-12 h-12 flex items-center justify-center bg-session-surface/80 backdrop-blur-sm rounded-full hover:bg-session-surface transition-colors"
              aria-label="Exit session"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Center guidance (loading only) */}
        <div className="flex-1 flex items-center justify-center">
          {sessionState === 'loading' && (
            <div className="bg-session-surface/80 backdrop-blur-sm px-8 py-4 rounded-2xl">
              <p className="font-display text-xl">Loading camera...</p>
            </div>
          )}
        </div>

        {/* Bottom instruction */}
        <div className="p-6 pb-safe">
          <div className="bg-session-surface/80 backdrop-blur-sm px-6 py-4 rounded-2xl text-center max-w-md mx-auto">
            <p
              className="font-display text-lg transition-colors mb-2"
              style={{ color: feedbackColor[postureFeedback] }}
            >
              {feedbackMessage}
            </p>
            <p className="text-session-muted text-sm">
              Raise both arms above your shoulders, then lower them to complete a rep
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  )
}
