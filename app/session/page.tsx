'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as poseDetection from '@tensorflow-models/pose-detection';
import '@tensorflow/tfjs-backend-webgl';
import { updateProgress } from '@/lib/progress';

export default function SessionPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [detector, setDetector] = useState<poseDetection.PoseDetector | null>(null);
  const [repCount, setRepCount] = useState(0);
  const [isRaised, setIsRaised] = useState(false);
  const [sessionState, setSessionState] = useState<'loading' | 'active' | 'completed'>('loading');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const TARGET_REPS = 10;

  useEffect(() => {
    let animationFrame: number;
    let stream: MediaStream | null = null;

    async function setupCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise((resolve) => {
            if (videoRef.current) {
              videoRef.current.onloadedmetadata = resolve;
            }
          });
          await videoRef.current.play();
        }
      } catch (err) {
        console.error('Camera error:', err);
        setCameraError('Camera access denied. Please allow camera access to continue.');
      }
    }

    async function loadPoseDetector() {
      try {
        const model = poseDetection.SupportedModels.MoveNet;
        const detectorConfig = {
          modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        };
        const det = await poseDetection.createDetector(model, detectorConfig);
        setDetector(det);
        setSessionState('active');
      } catch (err) {
        console.error('Pose detection error:', err);
        setCameraError('Failed to load pose detection model.');
      }
    }

    async function detectPose() {
      if (!detector || !videoRef.current || !canvasRef.current) {
        animationFrame = requestAnimationFrame(detectPose);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (!ctx) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      try {
        const poses = await detector.estimatePoses(video);

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (poses.length > 0) {
          const pose = poses[0];
          drawSkeleton(ctx, pose.keypoints, canvas.width, canvas.height);

          // Check arm raise gesture
          const leftShoulder = pose.keypoints.find((kp) => kp.name === 'left_shoulder');
          const leftWrist = pose.keypoints.find((kp) => kp.name === 'left_wrist');
          const rightShoulder = pose.keypoints.find((kp) => kp.name === 'right_shoulder');
          const rightWrist = pose.keypoints.find((kp) => kp.name === 'right_wrist');

          if (leftShoulder && leftWrist && rightShoulder && rightWrist) {
            const leftRaised = leftWrist.y < leftShoulder.y - 50;
            const rightRaised = rightWrist.y < rightShoulder.y - 50;
            const bothRaised = leftRaised && rightRaised;

            if (bothRaised && !isRaised) {
              setIsRaised(true);
            } else if (!bothRaised && isRaised) {
              setIsRaised(false);
              setRepCount((prev) => {
                const newCount = prev + 1;
                if (newCount >= TARGET_REPS) {
                  completeSession();
                }
                return newCount;
              });
            }
          }
        }
      } catch (err) {
        console.error('Pose estimation error:', err);
      }

      animationFrame = requestAnimationFrame(detectPose);
    }

    function completeSession() {
      setSessionState('completed');
      updateProgress(1); // Award 1 star
      setTimeout(() => {
        router.push('/');
      }, 2000);
    }

    setupCamera();
    loadPoseDetector();

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [detector, isRaised, router]);

  useEffect(() => {
    if (sessionState === 'active' && detector) {
      let animationFrame: number;

      async function detectPose() {
        if (!detector || !videoRef.current || !canvasRef.current) {
          animationFrame = requestAnimationFrame(detectPose);
          return;
        }

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        if (!ctx) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        try {
          const poses = await detector.estimatePoses(video);
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (poses.length > 0) {
            const pose = poses[0];
            drawSkeleton(ctx, pose.keypoints, canvas.width, canvas.height);

            const leftShoulder = pose.keypoints.find((kp) => kp.name === 'left_shoulder');
            const leftWrist = pose.keypoints.find((kp) => kp.name === 'left_wrist');
            const rightShoulder = pose.keypoints.find((kp) => kp.name === 'right_shoulder');
            const rightWrist = pose.keypoints.find((kp) => kp.name === 'right_wrist');

            if (leftShoulder && leftWrist && rightShoulder && rightWrist) {
              const leftRaised = leftWrist.y < leftShoulder.y - 50;
              const rightRaised = rightWrist.y < rightShoulder.y - 50;
              const bothRaised = leftRaised && rightRaised;

              if (bothRaised && !isRaised) {
                setIsRaised(true);
              } else if (!bothRaised && isRaised) {
                setIsRaised(false);
                setRepCount((prev) => {
                  const newCount = prev + 1;
                  if (newCount >= TARGET_REPS) {
                    setSessionState('completed');
                    updateProgress(1);
                    setTimeout(() => router.push('/'), 2000);
                  }
                  return newCount;
                });
              }
            }
          }
        } catch (err) {
          console.error('Pose estimation error:', err);
        }

        animationFrame = requestAnimationFrame(detectPose);
      }

      detectPose();

      return () => {
        if (animationFrame) cancelAnimationFrame(animationFrame);
      };
    }
  }, [sessionState, detector, isRaised, router]);

  function drawSkeleton(
    ctx: CanvasRenderingContext2D,
    keypoints: poseDetection.Keypoint[],
    width: number,
    height: number
  ) {
    const minConfidence = 0.3;
    const color = 'var(--session-primary)';

    // Draw connections
    const connections = [
      ['left_shoulder', 'right_shoulder'],
      ['left_shoulder', 'left_elbow'],
      ['left_elbow', 'left_wrist'],
      ['right_shoulder', 'right_elbow'],
      ['right_elbow', 'right_wrist'],
      ['left_shoulder', 'left_hip'],
      ['right_shoulder', 'right_hip'],
      ['left_hip', 'right_hip'],
    ];

    ctx.strokeStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--session-primary')
      .trim();
    ctx.lineWidth = 3;

    connections.forEach(([start, end]) => {
      const startPoint = keypoints.find((kp) => kp.name === start);
      const endPoint = keypoints.find((kp) => kp.name === end);

      if (
        startPoint &&
        endPoint &&
        startPoint.score &&
        endPoint.score &&
        startPoint.score > minConfidence &&
        endPoint.score > minConfidence
      ) {
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
        ctx.stroke();
      }
    });

    // Draw keypoints
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--session-primary')
      .trim();

    keypoints.forEach((kp) => {
      if (kp.score && kp.score > minConfidence) {
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI);
        ctx.fill();
      }
    });
  }

  if (cameraError) {
    return (
      <div className="session min-h-screen flex flex-col items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h1 className="mb-4">Camera Access Required</h1>
          <p style={{ color: 'var(--session-muted)', marginBottom: 'var(--space-8)' }}>
            {cameraError}
          </p>
          <button onClick={() => router.push('/')} className="btn btn-primary">
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session min-h-screen relative overflow-hidden">
      {/* Video feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
        playsInline
        muted
      />

      {/* Pose overlay canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ transform: 'scaleX(-1)', zIndex: 'var(--z-raised)' }}
      />

      {/* Exit button */}
      <button
        onClick={() => router.push('/')}
        style={{
          position: 'fixed',
          top: 'var(--space-4)',
          right: 'var(--space-4)',
          width: '48px',
          height: '48px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(8px)',
          border: 'none',
          color: 'var(--session-ink)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 'var(--z-overlay)',
        }}
        aria-label="Exit session"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      {/* Exercise guidance */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: 'var(--space-6)',
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(12px)',
          zIndex: 'var(--z-raised)',
          textAlign: 'center',
        }}
      >
        {sessionState === 'loading' && (
          <p style={{ color: 'var(--session-ink)' }}>Loading pose detection...</p>
        )}

        {sessionState === 'active' && (
          <>
            <h2 style={{ marginBottom: 'var(--space-2)', color: 'var(--session-ink)' }}>
              Arm Raises
            </h2>
            <p style={{ color: 'var(--session-muted)', marginBottom: 'var(--space-4)' }}>
              Raise both arms above your head, then lower them back down
            </p>
            <div
              style={{
                fontSize: 'var(--text-3xl)',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                color: 'var(--session-primary)',
              }}
            >
              {repCount} / {TARGET_REPS}
            </div>
          </>
        )}

        {sessionState === 'completed' && (
          <div>
            <h2 style={{ marginBottom: 'var(--space-2)', color: 'var(--session-accent)' }}>
              Session Complete! ⭐
            </h2>
            <p style={{ color: 'var(--session-ink)' }}>Returning to dashboard...</p>
          </div>
        )}
      </div>
    </div>
  );
}
