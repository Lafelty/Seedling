'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProgress } from '@/lib/progress'

// TODO: Re-add TensorFlow pose detection after fixing MediaPipe bundling issue
// For now, using mock camera + simulated pose detection for demo

type SessionState = 'loading' | 'countdown' | 'active' | 'paused' | 'completed'
type PostureFeedback = 'good' | 'adjust' | 'analyzing'

export default function SessionPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [repCount, setRepCount] = useState(0)
  const [sessionState, setSessionState] = useState<SessionState>('loading')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [postureFeedback, setPostureFeedback] = useState<PostureFeedback>('analyzing')
  const [countdown, setCountdown] = useState(3)
  const [showExitPrompt, setShowExitPrompt] = useState(false)

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

  // Mock pose detection and rep counting (only when active)
  useEffect(() => {
    if (sessionState !== 'active') return

    // Mock posture feedback - cycles through states
    const postureInterval = setInterval(() => {
      const states: PostureFeedback[] = ['analyzing', 'adjust', 'good']
      setPostureFeedback((prev) => {
        const currentIndex = states.indexOf(prev)
        return states[(currentIndex + 1) % states.length]
      })
    }, 2000)

    // Mock rep counting - complete 1 rep every 4 seconds
    const repInterval = setInterval(() => {
      setRepCount((prev) => {
        const newCount = prev + 1
        if (newCount >= TARGET_REPS) {
          completeSession()
        }
        return newCount
      })
    }, 4000)

    return () => {
      clearInterval(postureInterval)
      clearInterval(repInterval)
    }
  }, [sessionState])

  function completeSession() {
    setSessionState('completed')
    updateProgress(1) // Award 1 star
  }

  function handlePause() {
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

  const feedbackText = {
    good: '✓ Good posture',
    adjust: 'Raise arms slightly higher',
    analyzing: 'Reading your movement...',
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

      {/* Skeleton overlay - simple dots for mock mode */}
      {sessionState === 'active' && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="relative w-64 h-96">
            {/* Shoulder dots */}
            <div
              className="absolute w-3 h-3 rounded-full bg-session-primary"
              style={{
                left: '30%',
                top: '20%',
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
            <div
              className="absolute w-3 h-3 rounded-full bg-session-primary"
              style={{
                right: '30%',
                top: '20%',
                animation: 'pulse 2s ease-in-out infinite 0.2s',
              }}
            />
            {/* Elbow dots */}
            <div
              className="absolute w-3 h-3 rounded-full bg-session-primary"
              style={{
                left: '25%',
                top: '45%',
                animation: 'pulse 2s ease-in-out infinite 0.4s',
              }}
            />
            <div
              className="absolute w-3 h-3 rounded-full bg-session-primary"
              style={{
                right: '25%',
                top: '45%',
                animation: 'pulse 2s ease-in-out infinite 0.6s',
              }}
            />
            {/* Wrist dots */}
            <div
              className="absolute w-3 h-3 rounded-full bg-session-primary"
              style={{
                left: '20%',
                top: '65%',
                animation: 'pulse 2s ease-in-out infinite 0.8s',
              }}
            />
            <div
              className="absolute w-3 h-3 rounded-full bg-session-primary"
              style={{
                right: '20%',
                top: '65%',
                animation: 'pulse 2s ease-in-out infinite 1s',
              }}
            />
          </div>
        </div>
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
              {feedbackText[postureFeedback]}
            </p>
            <p className="text-session-muted text-sm">
              Raise both arms above your shoulders, then lower them to complete a rep
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.2);
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
