// Client-side only imports
let poseDetection: typeof import('@tensorflow-models/pose-detection') | null = null;
let detector: any = null;

export interface Pose {
  keypoints: Array<{
    x: number;
    y: number;
    score?: number;
    name?: string;
  }>;
  score?: number;
}

export interface ShoulderRaiseAnalysis {
  leftArmRaised: boolean;
  rightArmRaised: boolean;
  bothArmsRaised: boolean;
  feedback: 'good' | 'adjust' | 'analyzing';
  message: string;
}

/**
 * Initialize the MoveNet pose detector (client-side only)
 */
export async function initPoseDetector(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') {
      console.warn('Pose detection only works in browser');
      return false;
    }

    if (detector) return true;

    // Dynamically import TensorFlow only in browser
    if (!poseDetection) {
      const tf = await import('@tensorflow/tfjs-core');
      await import('@tensorflow/tfjs-backend-webgl');

      // Wait for backend to be ready
      await tf.ready();
      console.log('TensorFlow.js backend ready:', tf.getBackend());

      poseDetection = await import('@tensorflow-models/pose-detection');
    }

    const model = poseDetection.SupportedModels.MoveNet;
    detector = await poseDetection.createDetector(model, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
    });

    console.log('Pose detector initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize pose detector:', error);
    return false;
  }
}

/**
 * Detect poses in a video frame
 */
export async function detectPose(video: HTMLVideoElement): Promise<Pose | null> {
  if (!detector) {
    console.warn('Pose detector not initialized');
    return null;
  }

  try {
    const poses = await detector.estimatePoses(video);
    return poses.length > 0 ? poses[0] : null;
  } catch (error) {
    console.error('Pose detection error:', error);
    return null;
  }
}

/**
 * Analyze shoulder raise exercise
 * Returns whether arms are raised above shoulders
 */
export function analyzeShoulderRaise(pose: Pose | null): ShoulderRaiseAnalysis {
  if (!pose || !pose.keypoints) {
    return {
      leftArmRaised: false,
      rightArmRaised: false,
      bothArmsRaised: false,
      feedback: 'analyzing',
      message: 'Reading your movement...',
    };
  }

  // Find key body points
  const leftShoulder = pose.keypoints.find((kp) => kp.name === 'left_shoulder');
  const rightShoulder = pose.keypoints.find((kp) => kp.name === 'right_shoulder');
  const leftWrist = pose.keypoints.find((kp) => kp.name === 'left_wrist');
  const rightWrist = pose.keypoints.find((kp) => kp.name === 'right_wrist');

  // Check if keypoints are detected with sufficient confidence
  const minConfidence = 0.5;
  const hasLeftArm =
    leftShoulder && leftWrist &&
    (leftShoulder.score ?? 0) > minConfidence &&
    (leftWrist.score ?? 0) > minConfidence;
  const hasRightArm =
    rightShoulder && rightWrist &&
    (rightShoulder.score ?? 0) > minConfidence &&
    (rightWrist.score ?? 0) > minConfidence;

  if (!hasLeftArm && !hasRightArm) {
    return {
      leftArmRaised: false,
      rightArmRaised: false,
      bothArmsRaised: false,
      feedback: 'analyzing',
      message: 'Position yourself in frame',
    };
  }

  // Check if wrists are above shoulders (arms raised)
  const leftArmRaised = !!(hasLeftArm && leftWrist!.y < leftShoulder!.y - 20);
  const rightArmRaised = !!(hasRightArm && rightWrist!.y < rightShoulder!.y - 20);
  const bothArmsRaised = leftArmRaised && rightArmRaised;

  // Generate feedback
  let feedback: 'good' | 'adjust' | 'analyzing' = 'analyzing';
  let message = 'Reading your movement...';

  if (bothArmsRaised) {
    feedback = 'good';
    message = '✓ Good posture — both arms raised';
  } else if (leftArmRaised && !rightArmRaised) {
    feedback = 'adjust';
    message = 'Raise your right arm higher';
  } else if (rightArmRaised && !leftArmRaised) {
    feedback = 'adjust';
    message = 'Raise your left arm higher';
  } else if (hasLeftArm || hasRightArm) {
    feedback = 'adjust';
    message = 'Raise both arms above your shoulders';
  }

  return {
    leftArmRaised,
    rightArmRaised,
    bothArmsRaised,
    feedback,
    message,
  };
}

/**
 * Returns true when both shoulders are detected with sufficient confidence.
 * Used to show a "step back" warning when the patient is too close to the camera.
 * @param pose - The detected pose from MoveNet
 * @returns boolean indicating if shoulders are visible
 */
export function shouldersInFrame(pose: Pose | null): boolean {
  if (!pose?.keypoints) return false;
  const left = pose.keypoints.find((kp) => kp.name === 'left_shoulder');
  const right = pose.keypoints.find((kp) => kp.name === 'right_shoulder');
  return !!(
    left && right &&
    (left.score ?? 0) > 0.5 &&
    (right.score ?? 0) > 0.5
  );
}

/**
 * Count shoulder raise reps based on arm position transitions.
 * A rep is only counted if the patient holds the raised position for
 * at least HOLD_THRESHOLD ms — prevents fast "cheat reps".
 */
export class RepCounter {
  private wasRaised = false;
  private raisedSince = 0;
  private repCount = 0;
  private lastTransitionTime = 0;
  private readonly minRepInterval = 1000; // ms cooldown between reps
  private readonly holdThreshold = 500;   // ms patient must hold the raised position

  count(analysis: ShoulderRaiseAnalysis): {
    repCount: number;
    justCompleted: boolean;
    holdProgress: number; // 0.0–1.0 fill toward the hold threshold
    holdMissed: boolean;  // true when arms lowered before threshold was reached
  } {
    const now = Date.now();
    const isRaised = analysis.bothArmsRaised;
    let justCompleted = false;
    let holdMissed = false;

    if (isRaised && !this.wasRaised) {
      this.wasRaised = true;
      this.raisedSince = now;
    } else if (!isRaised && this.wasRaised) {
      const heldFor = this.raisedSince > 0 ? now - this.raisedSince : 0;
      if (heldFor >= this.holdThreshold && now - this.lastTransitionTime >= this.minRepInterval) {
        this.repCount++;
        justCompleted = true;
        this.lastTransitionTime = now;
      } else if (heldFor < this.holdThreshold) {
        holdMissed = true;
      }
      this.wasRaised = false;
      this.raisedSince = 0;
    }

    const holdProgress =
      this.wasRaised && this.raisedSince > 0
        ? Math.min(1, (now - this.raisedSince) / this.holdThreshold)
        : 0;

    return { repCount: this.repCount, justCompleted, holdProgress, holdMissed };
  }

  reset() {
    this.wasRaised = false;
    this.raisedSince = 0;
    this.repCount = 0;
    this.lastTransitionTime = 0;
  }

  getCount() {
    return this.repCount;
  }
}

/**
 * Cleanup detector resources
 */
export function disposePoseDetector() {
  if (detector) {
    detector.dispose();
    detector = null;
  }
}
