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

// ============================================================================
// PHASE 5: Generic Exercise Validation Engine
// ============================================================================

export interface AngleCriterion {
  joint: string;
  minAngle: number;
  maxAngle: number;
  targetAngle: number;
  relativeTo: [string, string]; // Two other keypoints to calculate the angle
}

export interface LevelingRule {
  joints: [string, string];
  maxDifference: number;
  message: string;
}

export interface PoseCriteria {
  targetBodyParts: string[];
  criteria: AngleCriterion[];
  levelingRules: LevelingRule[];
}

export interface ExerciseAnalysis {
  meetsAllCriteria: boolean;
  feedback: 'good' | 'adjust' | 'analyzing';
  message: string;
  failedCriteria: string[];
}

/**
 * Calculate angle between three points (in degrees)
 * Returns angle at point B formed by points A-B-C
 */
function calculateAngle(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  pointC: { x: number; y: number }
): number {
  const radians = Math.atan2(pointC.y - pointB.y, pointC.x - pointB.x) -
                  Math.atan2(pointA.y - pointB.y, pointA.x - pointB.x);
  let angle = Math.abs(radians * (180 / Math.PI));
  if (angle > 180) {
    angle = 360 - angle;
  }
  return angle;
}

/**
 * Get keypoint by name with confidence check
 */
function getKeypoint(pose: Pose | null, name: string, minConfidence = 0.5) {
  if (!pose?.keypoints) return null;
  const kp = pose.keypoints.find((k) => k.name === name);
  if (!kp || (kp.score ?? 0) < minConfidence) return null;
  return kp;
}

/**
 * Generic exercise validation against pose criteria from database
 */
export function analyzeExercise(
  pose: Pose | null,
  poseCriteria: PoseCriteria,
  feedbackMessages: Record<string, string>
): ExerciseAnalysis {
  if (!pose || !pose.keypoints) {
    return {
      meetsAllCriteria: false,
      feedback: 'analyzing',
      message: feedbackMessages.analyzing || 'Reading your movement...',
      failedCriteria: [],
    };
  }

  const failedCriteria: string[] = [];

  // Check if all target body parts are visible
  const missingParts = poseCriteria.targetBodyParts.filter(
    (part) => !getKeypoint(pose, part)
  );

  if (missingParts.length > 0) {
    return {
      meetsAllCriteria: false,
      feedback: 'analyzing',
      message: feedbackMessages.notInFrame || 'Position yourself in frame',
      failedCriteria: ['visibility'],
    };
  }

  // Check angle criteria
  for (const criterion of poseCriteria.criteria) {
    const joint = getKeypoint(pose, criterion.joint);
    const pointA = getKeypoint(pose, criterion.relativeTo[0]);
    const pointB = getKeypoint(pose, criterion.relativeTo[1]);

    if (!joint || !pointA || !pointB) {
      failedCriteria.push(criterion.joint);
      continue;
    }

    const angle = calculateAngle(pointA, joint, pointB);

    if (angle < criterion.minAngle) {
      failedCriteria.push(`${criterion.joint}_tooLow`);
    } else if (angle > criterion.maxAngle) {
      failedCriteria.push(`${criterion.joint}_tooHigh`);
    }
  }

  // Check leveling rules (symmetry)
  for (const rule of poseCriteria.levelingRules) {
    const joint1 = getKeypoint(pose, rule.joints[0]);
    const joint2 = getKeypoint(pose, rule.joints[1]);

    if (joint1 && joint2) {
      const diff = Math.abs(joint1.y - joint2.y);
      if (diff > rule.maxDifference) {
        failedCriteria.push(`leveling_${rule.joints[0]}_${rule.joints[1]}`);
      }
    }
  }

  // Generate feedback
  const meetsAllCriteria = failedCriteria.length === 0;
  let feedback: 'good' | 'adjust' | 'analyzing' = 'analyzing';
  let message = feedbackMessages.analyzing || 'Reading your movement...';

  if (meetsAllCriteria) {
    feedback = 'good';
    message = feedbackMessages.perfect || '✓ Perfect form!';
  } else {
    feedback = 'adjust';

    // Provide specific feedback based on first failed criterion
    const firstFail = failedCriteria[0];

    if (firstFail === 'visibility') {
      message = feedbackMessages.notInFrame || 'Position yourself in frame';
    } else if (firstFail.includes('tooLow')) {
      const joint = firstFail.replace('_tooLow', '');
      message = feedbackMessages.tooLow || `Raise your ${joint} higher`;
    } else if (firstFail.includes('tooHigh')) {
      const joint = firstFail.replace('_tooHigh', '');
      message = feedbackMessages.tooHigh || `Lower your ${joint} slightly`;
    } else if (firstFail.includes('leveling')) {
      message = feedbackMessages.notLevel || 'Keep your joints level';
    } else {
      message = feedbackMessages.adjust || 'Adjust your form';
    }
  }

  return {
    meetsAllCriteria,
    feedback,
    message,
    failedCriteria,
  };
}

/**
 * Generic rep counter for any exercise type
 * Works with both static holds and dynamic movements
 */
export class GenericRepCounter {
  private wasInPosition = false;
  private positionHeldSince = 0;
  private repCount = 0;
  private lastTransitionTime = 0;
  private readonly minRepInterval = 1000; // ms cooldown between reps
  private holdThreshold: number;

  constructor(holdThresholdMs: number = 500) {
    this.holdThreshold = holdThresholdMs;
  }

  count(analysis: ExerciseAnalysis): {
    repCount: number;
    justCompleted: boolean;
    holdProgress: number;
    holdMissed: boolean;
  } {
    const now = Date.now();
    const inPosition = analysis.meetsAllCriteria;
    let justCompleted = false;
    let holdMissed = false;

    if (inPosition && !this.wasInPosition) {
      // Entered correct position
      this.wasInPosition = true;
      this.positionHeldSince = now;
    } else if (!inPosition && this.wasInPosition) {
      // Exited correct position
      const heldFor = this.positionHeldSince > 0 ? now - this.positionHeldSince : 0;

      if (heldFor >= this.holdThreshold && now - this.lastTransitionTime >= this.minRepInterval) {
        this.repCount++;
        justCompleted = true;
        this.lastTransitionTime = now;
      } else if (heldFor < this.holdThreshold) {
        holdMissed = true;
      }

      this.wasInPosition = false;
      this.positionHeldSince = 0;
    }

    const holdProgress =
      this.wasInPosition && this.positionHeldSince > 0
        ? Math.min(1, (now - this.positionHeldSince) / this.holdThreshold)
        : 0;

    return { repCount: this.repCount, justCompleted, holdProgress, holdMissed };
  }

  reset() {
    this.wasInPosition = false;
    this.positionHeldSince = 0;
    this.repCount = 0;
    this.lastTransitionTime = 0;
  }

  getCount() {
    return this.repCount;
  }
}
