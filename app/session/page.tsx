'use client'

import Link from 'next/link'
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
  const [isDetecting, setIsDetecting] = useState(false)

  const TARGET_REPS = 10

  useEffect(() => {
    let stream: MediaStream | null = null

    async function setupCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
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
        } else {
          console.log('✅ Pose detector initialized successfully')
          setIsDetecting(true)
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

      if (pose && pose.keypoints) {
        console.log(`Detected ${pose.keypoints.length} keypoints, score: ${pose.score?.toFixed(2)}`)
      }

      // Analyze shoulder raise
      const analysis = analyzeShoulderRaise(pose)
      setPostureFeedback(analysis.feedback)
      setFeedbackMessage(analysis.message)

      // Count reps
      const { repCount: newCount, justCompleted } = repCounterRef.current.count(analysis)
      if (justCompleted) {
        console.log(`✅ Rep ${newCount} completed!`)
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
    good: 'var(--primary)',
    adjust: '#C9B88A',
    analyzing: 'var(--muted)',
  }

  if (cameraError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-center max-w-md px-8">
          <p className="text-xl mb-6" style={{ color: 'var(--ink)' }}>{cameraError}</p>
          <div className="flex flex-col gap-4">
            <button
              onClick={() => window.location.reload()}
              className="btn btn-primary"
            >
              Reload and Try Again
            </button>
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

  if (sessionState === 'completed') {
    return (
      <>
        <div className="fixed inset-0 flex items-center justify-center pb-24" style={{ background: 'var(--bg)' }}>
          <div className="text-center max-w-md px-8">
            <div className="text-6xl mb-6">🌱</div>
            <h1 className="text-4xl font-display mb-4" style={{ color: 'var(--ink)', fontWeight: 700 }}>
              Session Complete!
            </h1>
            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-lg)' }} className="mb-8">
              You earned 1 star
            </p>
            <button
              onClick={() => router.push('/')}
              className="btn btn-primary"
            >
              View My Garden
            </button>
          </div>
        </div>

        {/* Bottom Navigation */}
        <nav className="bottom-nav">
          <Link href="/" className="nav-item active">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7v7c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" />
              <path d="M12 8v8M8 12h8" />
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

  return (
    <div className="fixed inset-0 overflow-hidden session">
      {/* Camera feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* Skeleton overlay - actual pose keypoints */}
      {sessionState === 'active' && detectedPose && videoRef.current && (
        <svg
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${videoRef.current.videoWidth} ${videoRef.current.videoHeight}`}
          style={{ width: '100%', height: '100%', transform: 'scaleX(-1)' }}
        >
          {detectedPose.keypoints
            .filter((kp) => (kp.score ?? 0) > 0.5)
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
                (startKp.score ?? 0) > 0.5 &&
                (endKp.score ?? 0) > 0.5
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
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <div className="text-center">
            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-lg)' }} className="mb-4 font-display">
              Starting in
            </p>
            <p className="text-8xl font-display font-bold" style={{ color: 'var(--primary)' }}>
              {countdown}
            </p>
          </div>
        </div>
      )}

      {/* Exit confirmation prompt */}
      {showExitPrompt && (
        <div className="absolute inset-0 flex items-center justify-center z-30" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}>
          <div className="bg-[var(--surface)] p-8 rounded-2xl max-w-md mx-4 text-center">
            <h3 className="font-display text-2xl mb-4" style={{ color: 'var(--ink)', fontWeight: 600 }}>
              End session?
            </h3>
            <p style={{ color: 'var(--muted)' }} className="mb-2">
              You've completed {repCount} of {TARGET_REPS} reps
            </p>
            <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
              Your progress will be saved
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
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)' }}>
          <div className="text-center max-w-md px-8">
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
                Reps: <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{repCount}</span> / {TARGET_REPS}
              </p>
            </div>

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
          }}>
            <p
              className="font-display text-lg transition-colors mb-2"
              style={{ color: feedbackColor[postureFeedback], fontWeight: 600 }}
            >
              {feedbackMessage}
            </p>
            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
              Raise both arms above your shoulders, then lower them to complete a rep
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
