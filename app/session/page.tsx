'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProgress } from '@/lib/progress'
import confetti from 'canvas-confetti'
import { useToast } from '@/components/Toast'
import ReferenceModel3D from '@/components/ReferenceModel3D'
import {
  initPoseDetector,
  detectPose,
  analyzeShoulderRaise,
  shouldersInFrame,
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
  const [repJustCompleted, setRepJustCompleted] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [holdMissed, setHoldMissed] = useState(false)
  const [shouldersVisible, setShouldersVisible] = useState(true)
  const [hasSpoken, setHasSpoken] = useState(false)
  const [instructionBoxPos, setInstructionBoxPos] = useState({ x: 0, y: 0 })
  const [isDraggingBox, setIsDraggingBox] = useState(false)
  const [boxDragStart, setBoxDragStart] = useState({ x: 0, y: 0 })
  const [isSpeaking, setIsSpeaking] = useState(false)

  const { showToast, ToastComponent } = useToast()

  const TARGET_REPS = 10

  // Text-to-speech helper
  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel() // Cancel any ongoing speech
      const utterance = new SpeechSynthesisUtterance(text)
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

    const handleMouseUp = () => {
      setIsDraggingBox(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingBox, boxDragStart, instructionBoxPos])

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
      // Speak initial instructions when session becomes active
      if (!hasSpoken) {
        setTimeout(() => {
          speak('Position yourself in frame. Raise both arms above your shoulders, then lower them to complete a rep.')
          setHasSpoken(true)
        }, 500)
      }
    }
  }, [sessionState, countdown, hasSpoken])

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

      // Track shoulder visibility for the "step back" warning
      setShouldersVisible(shouldersInFrame(pose))

      // Count reps (with hold-lock enforcement)
      const { repCount: newCount, justCompleted, holdProgress: hp, holdMissed: hm } =
        repCounterRef.current.count(analysis)
      setHoldProgress(hp)
      if (hm) {
        setHoldMissed(true)
        setTimeout(() => setHoldMissed(false), 1200)
      }
      if (justCompleted) {
        console.log(`✅ Rep ${newCount} completed!`)
        setRepCount(newCount)
        setRepJustCompleted(true)
        speak(`Rep ${newCount} completed! ${TARGET_REPS - newCount} more to go.`)
        setTimeout(() => setRepJustCompleted(false), 300)
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
    speak('Session complete! Great job!')

    // Trigger confetti celebration
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0, colors: ['#4A6B5A', '#C9B88A', '#FAF9F7'] };

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min;
    }

    const interval: any = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
      });
    }, 250);
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
        showToast('Progress saved', 'success')
      }
    }
    router.push('/')
  }

  function handleExitWithoutSave() {
    router.push('/')
  }

  const feedbackColor = {
    good: '#22c55e',    // correct
    adjust: '#f97316',  // almost correct
    analyzing: '#ef4444', // incorrect / not yet confirmed
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
      {ToastComponent}

      {/* Camera feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* Skeleton overlay — live skeleton */}
      {sessionState === 'active' && detectedPose && videoRef.current && (
        <svg
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${videoRef.current.videoWidth} ${videoRef.current.videoHeight}`}
          style={{ width: '100%', height: '100%', transform: 'scaleX(-1)' }}
        >

          {/* Live skeleton — solid colored lines reflecting posture feedback */}
          {(() => {
            const connections = [
              ['left_shoulder',  'right_shoulder'],
              ['left_shoulder',  'left_elbow'],
              ['left_elbow',     'left_wrist'],
              ['right_shoulder', 'right_elbow'],
              ['right_elbow',    'right_wrist'],
            ];

            const lineColor = feedbackColor[postureFeedback];

            return connections.map(([start, end], i) => {
              const startKp = detectedPose.keypoints.find((kp) => kp.name === start);
              const endKp   = detectedPose.keypoints.find((kp) => kp.name === end);

              if (
                startKp && endKp &&
                (startKp.score ?? 0) > 0.5 &&
                (endKp.score   ?? 0) > 0.5
              ) {
                return (
                  <line
                    key={i}
                    x1={startKp.x} y1={startKp.y}
                    x2={endKp.x}   y2={endKp.y}
                    stroke={lineColor}
                    strokeWidth="8"
                    strokeLinecap="round"
                    opacity="0.85"
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
          <div className="text-center px-8">
            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-lg)' }} className="mb-4 font-display">
              Starting in
            </p>
            <p className="text-8xl font-display font-bold mb-8" style={{ color: 'var(--primary)' }}>
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
                Hold each raise for <strong style={{ color: 'white' }}>0.5 seconds</strong> to count a rep
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
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(8px)',
            borderRadius: 'var(--radius-full)',
            padding: 'var(--space-3) var(--space-5)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ color: 'white', fontSize: 'var(--text-sm)', fontWeight: 500 }}>
              Step back so your shoulders are visible
            </span>
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

      {/* 3D Reference Model - floating, movable widget */}
      {sessionState === 'active' && (
        <div
          className="fixed bottom-32 right-6 z-20 pointer-events-auto"
          style={{
            width: '200px',
            height: '280px',
          }}
        >
          <ReferenceModel3D />
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
                  transition: 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                  transform: repJustCompleted ? 'scale(1.3)' : 'scale(1)'
                }}>{repCount}</span> / {TARGET_REPS}
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
                  speak(`${holdMissed ? 'Hold a little longer next time' : feedbackMessage}. Raise both arms above your shoulders, then lower them to complete a rep`)
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
