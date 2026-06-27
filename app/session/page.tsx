'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProgress } from '@/lib/progress'

// TODO: Re-add TensorFlow pose detection after fixing MediaPipe bundling issue
// For now, using mock camera + simulated pose detection for demo

export default function SessionPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [repCount, setRepCount] = useState(0)
  const [sessionState, setSessionState] = useState<'loading' | 'active' | 'completed'>('loading')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [postureGood, setPostureGood] = useState(true)

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
        setSessionState('active')
      } catch (err) {
        console.error('Camera error:', err)
        setCameraError('Camera access denied. Please allow camera access to continue.')
      }
    }

    setupCamera()

    // Mock pose detection for demo - alternates posture every 2 seconds
    const postureInterval = setInterval(() => {
      setPostureGood((prev) => !prev)
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
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  function completeSession() {
    setSessionState('completed')
    updateProgress(1) // Award 1 star
    setTimeout(() => {
      router.push('/')
    }, 2000)
  }

  function drawSkeleton(keypoints: any[]) {
    // Placeholder for skeleton drawing
    return null
  }

  if (cameraError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-session-bg text-session-ink">
        <div className="text-center max-w-md px-8">
          <p className="text-xl mb-6">{cameraError}</p>
          <button
            onClick={() => router.push('/')}
            className="px-8 py-3 bg-session-primary text-white rounded-full hover:opacity-90"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    )
  }

  if (sessionState === 'completed') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-session-bg text-session-ink">
        <div className="text-center">
          <h1 className="text-4xl font-display mb-4">Session Complete! 🌱</h1>
          <p className="text-session-muted text-lg">You earned 1 star</p>
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

      {/* Pose overlay canvas - hidden for now */}
      <div className="absolute inset-0 pointer-events-none" />

      {/* UI Overlay */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between p-6">
          <div className="bg-session-surface/80 backdrop-blur-sm px-6 py-3 rounded-full">
            <p className="font-display text-session-ink">
              Reps: <span className="text-session-primary font-semibold">{repCount}</span> / {TARGET_REPS}
            </p>
          </div>

          <button
            onClick={() => router.push('/')}
            className="w-12 h-12 flex items-center justify-center bg-session-surface/80 backdrop-blur-sm rounded-full hover:bg-session-surface transition-colors"
            aria-label="Exit session"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Center guidance */}
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
            <p className={`font-display text-lg transition-colors ${
              postureGood ? 'text-session-primary' : 'text-session-accent'
            }`}>
              {postureGood ? '✓ Good posture' : 'Adjust your posture'}
            </p>
            <p className="text-session-muted text-sm mt-2">
              Raise both arms above your shoulders, then lower them to complete a rep
            </p>
            <p className="text-session-muted text-xs mt-3 italic">
              Demo mode: Pose detection will be added in next update
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
