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
 * Exported so the exercise editor can show live angles with the same math.
 */
export function calculateAngle(
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
  poseCriteria: PoseCriteria | null | undefined,
  feedbackMessages: Record<string, string> | null | undefined
): ExerciseAnalysis {
  const fm = feedbackMessages || {};
  const targetBodyParts = poseCriteria?.targetBodyParts ?? [];
  const criteria = poseCriteria?.criteria ?? [];
  const levelingRules = poseCriteria?.levelingRules ?? [];

  if (!pose || !pose.keypoints) {
    return {
      meetsAllCriteria: false,
      feedback: 'analyzing',
      message: fm.analyzing || 'Reading your movement...',
      failedCriteria: [],
    };
  }

  // Guard: exercise published without real criteria (e.g. an unrefined draft).
  // Never phantom-count reps against an empty ruleset.
  if (criteria.length === 0 && levelingRules.length === 0) {
    return {
      meetsAllCriteria: false,
      feedback: 'analyzing',
      message: fm.notConfigured || 'This exercise is not set up yet. Please contact your therapist.',
      failedCriteria: ['notConfigured'],
    };
  }

  const failedCriteria: string[] = [];

  // Check if all target body parts are visible
  const missingParts = targetBodyParts.filter(
    (part) => !getKeypoint(pose, part)
  );

  if (missingParts.length > 0) {
    return {
      meetsAllCriteria: false,
      feedback: 'analyzing',
      message: fm.notInFrame || 'Position yourself in frame',
      failedCriteria: ['visibility'],
    };
  }

  // Check angle criteria
  for (const criterion of criteria) {
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
  for (const rule of levelingRules) {
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
  let message = fm.analyzing || 'Reading your movement...';

  if (meetsAllCriteria) {
    feedback = 'good';
    message = fm.perfect || '✓ Perfect form!';
  } else {
    feedback = 'adjust';

    // Provide specific feedback based on first failed criterion
    const firstFail = failedCriteria[0];

    if (firstFail === 'visibility') {
      message = fm.notInFrame || 'Position yourself in frame';
    } else if (firstFail.includes('tooLow')) {
      const joint = firstFail.replace('_tooLow', '');
      message = fm.tooLow || `Raise your ${joint} higher`;
    } else if (firstFail.includes('tooHigh')) {
      const joint = firstFail.replace('_tooHigh', '');
      message = fm.tooHigh || `Lower your ${joint} slightly`;
    } else if (firstFail.includes('leveling')) {
      message = fm.notLevel || 'Keep your joints level';
    } else {
      message = fm.adjust || 'Adjust your form';
    }
  }

  return {
    meetsAllCriteria,
    feedback,
    message,
    failedCriteria,
  };
}

// ============================================================================
// Auto-derivation of validation criteria from recorded demonstrations
// ============================================================================

/** The 17 keypoints MoveNet detects — the only valid names for joints and reference points. */
export const VALID_KEYPOINT_NAMES: readonly string[] = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

/**
 * Anatomically sensible reference points for measuring the angle at each joint.
 * Only these 8 joints have a meaningful "angle" — face points and extremities don't.
 */
export const ANATOMICAL_REFERENCES: Record<string, [string, string]> = {
  left_shoulder: ['left_elbow', 'left_hip'],
  right_shoulder: ['right_elbow', 'right_hip'],
  left_elbow: ['left_shoulder', 'left_wrist'],
  right_elbow: ['right_shoulder', 'right_wrist'],
  left_hip: ['left_shoulder', 'left_knee'],
  right_hip: ['right_shoulder', 'right_knee'],
  left_knee: ['left_hip', 'left_ankle'],
  right_knee: ['right_hip', 'right_ankle'],
};

/** Minimal shape of a recorded demo both admin pages share. */
export interface RecordedDemoFrames {
  frames: Array<{ pose: Pose }>;
}

const MIN_VISIBLE_FRAMES = 10; // pooled frames a joint needs before we trust its stats
const MIN_VISIBLE_RATIO = 0.4; // joint must be measurable in this share of all frames
const MOVING_ROM_THRESHOLD = 25; // degrees of motion that marks a joint as exercised
const MOVING_DISPLACEMENT_PX = 40; // keypoint travel that marks a body part as moving

/** Centered moving average — MoveNet angles jitter several degrees frame to frame. */
function smoothSeries(values: number[], windowSize = 5): number[] {
  if (values.length <= windowSize) return [...values];
  const half = Math.floor(windowSize / 2);
  return values.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += values[j];
    return sum / (end - start);
  });
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

interface JointDemoStats {
  count: number;
  start: number; // typical angle at the beginning of the demo (rest pose)
  p5: number;
  p95: number;
  median: number;
}

/** Angle statistics for one joint across one demo, or null if too rarely visible. */
function collectJointStats(
  demo: RecordedDemoFrames,
  joint: string,
  refs: [string, string]
): JointDemoStats | null {
  const series: number[] = [];
  for (const frame of demo.frames) {
    const j = getKeypoint(frame.pose, joint);
    const a = getKeypoint(frame.pose, refs[0]);
    const b = getKeypoint(frame.pose, refs[1]);
    if (!j || !a || !b) continue;
    series.push(calculateAngle(a, j, b));
  }
  if (series.length < 5) return null;

  const smoothed = smoothSeries(series);
  const startWindow = smoothed.slice(0, Math.max(3, Math.round(smoothed.length * 0.1)));
  return {
    count: smoothed.length,
    start: percentile(startWindow, 0.5),
    p5: percentile(smoothed, 0.05),
    p95: percentile(smoothed, 0.95),
    median: percentile(smoothed, 0.5),
  };
}

/** Keypoints that travel far from where they started, in any demo. */
function detectMovingKeypoints(demos: RecordedDemoFrames[]): string[] {
  const validNames = new Set(VALID_KEYPOINT_NAMES);
  const moving = new Set<string>();

  for (const demo of demos) {
    const firstSeen: Record<string, { x: number; y: number }> = {};
    for (const frame of demo.frames) {
      for (const kp of frame.pose.keypoints) {
        if (!kp.name || !validNames.has(kp.name) || (kp.score ?? 0) < 0.5) continue;
        const ref = firstSeen[kp.name];
        if (!ref) {
          firstSeen[kp.name] = { x: kp.x, y: kp.y };
        } else if (Math.hypot(kp.x - ref.x, kp.y - ref.y) >= MOVING_DISPLACEMENT_PX) {
          moving.add(kp.name);
        }
      }
    }
  }

  return [...moving];
}

/**
 * Derive ready-to-use validation criteria from recorded demonstrations.
 *
 * The recording is ground truth: joint angles are computed across every frame
 * (same math the session engine uses), so the therapist never has to translate
 * "arm at shoulder height" into degrees by hand.
 *
 * - Joints whose angle sweeps ≥ MOVING_ROM_THRESHOLD are treated as the exercised
 *   joints. The target is the extreme of the movement (the end furthest from the
 *   rest pose), with a tolerance band tight enough to exclude the rest pose —
 *   otherwise the rep counter would fire while the patient just stands there.
 * - If nothing sweeps that far, the recording is a static hold: every reliably
 *   visible joint gets a criterion around its median angle.
 * - Reference points always come from ANATOMICAL_REFERENCES.
 *
 * Returns the exact PoseCriteria shape the session engine consumes. Criteria may
 * be empty when no joint was visible reliably enough.
 */
export function deriveCriteriaFromRecordings(demos: RecordedDemoFrames[]): PoseCriteria {
  const usable = demos.filter((d) => d.frames.length >= 2);
  const totalFrames = usable.reduce((sum, d) => sum + d.frames.length, 0);

  // Pool per-demo stats into one weighted view per joint.
  const jointStats: Record<string, JointDemoStats> = {};
  if (totalFrames > 0) {
    for (const [joint, refs] of Object.entries(ANATOMICAL_REFERENCES)) {
      const perDemo = usable
        .map((d) => collectJointStats(d, joint, refs))
        .filter((s): s is JointDemoStats => s !== null);
      const count = perDemo.reduce((sum, s) => sum + s.count, 0);
      if (count < MIN_VISIBLE_FRAMES || count / totalFrames < MIN_VISIBLE_RATIO) continue;

      const wmean = (pick: (s: JointDemoStats) => number) =>
        perDemo.reduce((sum, s) => sum + pick(s) * s.count, 0) / count;
      jointStats[joint] = {
        count,
        start: wmean((s) => s.start),
        p5: wmean((s) => s.p5),
        p95: wmean((s) => s.p95),
        median: wmean((s) => s.median),
      };
    }
  }

  const criteria: AngleCriterion[] = [];
  const movingJoints = Object.entries(jointStats)
    .filter(([, s]) => s.p95 - s.p5 >= MOVING_ROM_THRESHOLD)
    .sort(([, a], [, b]) => b.p95 - b.p5 - (a.p95 - a.p5)); // widest sweep first

  if (movingJoints.length > 0) {
    for (const [joint, s] of movingJoints) {
      // Target = the movement extreme furthest from the rest pose. Since the
      // sweep is ≥ 25°, that extreme is ≥ 12.5° from rest, so a 10–20° half-band
      // scaled to the movement always leaves the rest pose outside the band.
      const target = Math.abs(s.p95 - s.start) >= Math.abs(s.p5 - s.start) ? s.p95 : s.p5;
      const halfBand = Math.min(20, Math.max(10, Math.abs(target - s.start) * 0.4));
      criteria.push({
        joint,
        targetAngle: Math.round(target),
        minAngle: Math.max(0, Math.round(target - halfBand)),
        maxAngle: Math.min(180, Math.round(target + halfBand)),
        relativeTo: [...ANATOMICAL_REFERENCES[joint]] as [string, string],
      });
    }
  } else {
    // Static hold: the whole recording is the target pose.
    for (const [joint, s] of Object.entries(jointStats)) {
      const halfBand = Math.max(10, (s.p95 - s.p5) / 2 + 5);
      criteria.push({
        joint,
        targetAngle: Math.round(s.median),
        minAngle: Math.max(0, Math.round(s.median - halfBand)),
        maxAngle: Math.min(180, Math.round(s.median + halfBand)),
        relativeTo: [...ANATOMICAL_REFERENCES[joint]] as [string, string],
      });
    }
  }

  // Everything the criteria reference must be visible during a session, plus
  // whatever visibly moved (drives the skeleton highlight in the editor).
  const targetBodyParts = new Set<string>(detectMovingKeypoints(usable));
  for (const c of criteria) {
    targetBodyParts.add(c.joint);
    targetBodyParts.add(c.relativeTo[0]);
    targetBodyParts.add(c.relativeTo[1]);
  }

  return { targetBodyParts: [...targetBodyParts], criteria, levelingRules: [] };
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
