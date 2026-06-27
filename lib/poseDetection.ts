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
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
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
  const minConfidence = 0.3;
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
 * Count shoulder raise reps based on arm position transitions
 */
export class RepCounter {
  private wasRaised = false;
  private repCount = 0;
  private lastTransitionTime = 0;
  private readonly minRepDuration = 1000; // Minimum 1 second between reps

  count(analysis: ShoulderRaiseAnalysis): { repCount: number; justCompleted: boolean } {
    const now = Date.now();
    const isRaised = analysis.bothArmsRaised;
    let justCompleted = false;

    // Detect down -> up -> down transition (one rep)
    if (isRaised && !this.wasRaised) {
      // Arms just went up
      this.wasRaised = true;
    } else if (!isRaised && this.wasRaised) {
      // Arms just came down - complete rep
      if (now - this.lastTransitionTime >= this.minRepDuration) {
        this.repCount++;
        justCompleted = true;
        this.lastTransitionTime = now;
      }
      this.wasRaised = false;
    }

    return { repCount: this.repCount, justCompleted };
  }

  reset() {
    this.wasRaised = false;
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
