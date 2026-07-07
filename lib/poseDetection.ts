// Client-side only imports
let poseDetection: typeof import('@tensorflow-models/pose-detection') | null = null;
let detector: any = null;
let handPoseDetection: typeof import('@tensorflow-models/hand-pose-detection') | null = null;
let handDetector: any = null;

// Generation counters, bumped on every dispose. Model loads take seconds; a
// dispose (mode switch, unmount, HMR) can land while createDetector is still
// in flight, and without this check the late resolver would assign a zombie
// detector next to the other mode's model.
let poseGen = 0;
let handGen = 0;

// The detect loops run per-frame while models load — warn once, not 200×.
let warnedPoseNotReady = false;
let warnedHandNotReady = false;

/** Which landmark model an exercise is tracked with. */
export type TrackingMode = 'body' | 'hand';

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
    const gen = poseGen;

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
    const created = await poseDetection.createDetector(model, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
    });

    if (gen !== poseGen) {
      // Disposed while loading (mode switch / unmount) — don't resurrect.
      created.dispose();
      return false;
    }
    if (detector) {
      // A concurrent init already won (StrictMode double-mount).
      created.dispose();
      return true;
    }
    detector = created;
    warnedPoseNotReady = false;
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
    if (!warnedPoseNotReady) {
      console.warn('Pose detector not initialized yet — frames skipped until the model loads');
      warnedPoseNotReady = true;
    }
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
 * Returns true when the mode's anchor keypoints are detected with sufficient
 * confidence — shoulders for body tracking, wrist + middle knuckle for hands.
 * Used to warn when the subject is out of frame or too close to the camera.
 */
export function subjectInFrame(pose: Pose | null, mode: TrackingMode = 'body'): boolean {
  if (!pose?.keypoints) return false;
  const [nameA, nameB] = anchorPairForMode(mode);
  const a = pose.keypoints.find((kp) => kp.name === nameA);
  const b = pose.keypoints.find((kp) => kp.name === nameB);
  return !!(a && b && (a.score ?? 0) > 0.5 && (b.score ?? 0) > 0.5);
}

/** Body-mode wrapper kept for older call sites. */
export function shouldersInFrame(pose: Pose | null): boolean {
  return subjectInFrame(pose, 'body');
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
  poseGen++; // invalidate any createDetector still in flight
  if (detector) {
    detector.dispose();
    detector = null;
  }
}

/**
 * Initialize the MediaPipeHands detector (client-side only, tfjs runtime —
 * no external WASM/CDN assets, same WebGL backend as MoveNet).
 */
export async function initHandDetector(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') {
      console.warn('Hand detection only works in browser');
      return false;
    }

    if (handDetector) return true;
    const gen = handGen;

    if (!handPoseDetection) {
      const tf = await import('@tensorflow/tfjs-core');
      await import('@tensorflow/tfjs-backend-webgl');
      await tf.ready();
      console.log('TensorFlow.js backend ready:', tf.getBackend());
      handPoseDetection = await import('@tensorflow-models/hand-pose-detection');
    }

    console.log('Loading hand model (~10 MB on first use)…');
    const model = handPoseDetection.SupportedModels.MediaPipeHands;
    const created = await handPoseDetection.createDetector(model, {
      runtime: 'tfjs',
      // 'lite' over 'full': the full model runs ~6 s/frame on webgl — far too
      // slow for a live preview. lite keeps all 21 landmarks at real-time speed.
      modelType: 'lite',
      // detectHand only ever returns the single most-confident hand, so tracking
      // a second one is pure wasted compute every frame.
      maxHands: 1,
    });

    if (gen !== handGen) {
      // Disposed while loading (mode switch / unmount) — don't resurrect.
      created.dispose();
      return false;
    }
    if (handDetector) {
      // A concurrent init already won (StrictMode double-mount).
      created.dispose();
      return true;
    }
    handDetector = created;
    warnedHandNotReady = false;
    console.log('Hand detector initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize hand detector:', error);
    return false;
  }
}

/**
 * Detect the most confident hand in a video frame, normalized into the same
 * Pose shape MoveNet produces so the whole downstream engine works unchanged.
 */
export async function detectHand(video: HTMLVideoElement): Promise<Pose | null> {
  if (!handDetector) {
    if (!warnedHandNotReady) {
      console.warn('Hand detector not initialized yet — frames skipped until the model loads');
      warnedHandNotReady = true;
    }
    return null;
  }

  try {
    const hands = await handDetector.estimateHands(video);
    if (!hands || hands.length === 0) return null;
    // tfjs runtime reports score: NaN for video inputs (finite only for static
    // images), and NaN slips through ?? — sanitize before it poisons every
    // downstream confidence check (NaN > 0.5 is false, NaN is falsy).
    const scoreOf = (v: any) => (Number.isFinite(v) ? (v as number) : undefined);
    const hand = hands.reduce((best: any, h: any) =>
      (scoreOf(h.score) ?? 0) > (scoreOf(best.score) ?? 0) ? h : best
    );
    // The detector only returns hands above its internal palm-detection
    // confidence, so a missing/NaN score still means "confidently detected".
    const handScore = scoreOf(hand.score) ?? 1;
    return {
      // tfjs-runtime hand keypoints carry no per-keypoint score, but getKeypoint
      // rejects anything under 0.5 — copy the hand's overall score onto each one.
      keypoints: hand.keypoints.map((kp: any) => ({
        x: kp.x,
        y: kp.y,
        name: kp.name,
        score: scoreOf(kp.score) ?? handScore,
      })),
      score: handScore,
    };
  } catch (error) {
    console.error('Hand detection error:', error);
    return null;
  }
}

export function disposeHandDetector() {
  handGen++; // invalidate any createDetector still in flight
  if (handDetector) {
    handDetector.dispose();
    handDetector = null;
  }
}

// ---- Mode facade: the only detector API pages should call ----

/** Init the detector for a mode, disposing the other model first (one model resident at a time). */
export async function initDetector(mode: TrackingMode): Promise<boolean> {
  if (mode === 'hand') {
    disposePoseDetector();
    return initHandDetector();
  }
  disposeHandDetector();
  return initPoseDetector();
}

export async function detect(video: HTMLVideoElement, mode: TrackingMode): Promise<Pose | null> {
  return mode === 'hand' ? detectHand(video) : detectPose(video);
}

export function disposeDetector() {
  disposePoseDetector();
  disposeHandDetector();
}

// ============================================================================
// PHASE 5: Generic Exercise Validation Engine
// ============================================================================

export interface AngleCriterion {
  joint: string;
  minAngle: number;
  maxAngle: number;
  targetAngle: number;
  // Angle at the rest pose (start of the movement). When present on a dynamic
  // exercise, reps count full cycles: rest → target (hold) → back to rest.
  restAngle?: number;
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
  // Difficulty dial: scales every angle band and leveling tolerance without
  // touching the stored angles. >1 = more lenient, <1 = stricter. Default 1.
  toleranceMultiplier?: number;
}

export interface ExerciseAnalysis {
  meetsAllCriteria: boolean;
  // True when every criterion that defines a restAngle is back in its rest zone
  // (and all of their keypoints are visible). Always false if none define one.
  atRest: boolean;
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
      atRest: false,
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
      atRest: false,
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
      atRest: false,
      feedback: 'analyzing',
      message: fm.notInFrame || 'Position yourself in frame',
      failedCriteria: ['visibility'],
    };
  }

  // Difficulty dial — widens (or tightens) every band around its target
  const m = poseCriteria?.toleranceMultiplier ?? 1;

  // Check angle criteria, tracking the rest zone alongside the target band
  let restEligible = 0;
  let restMet = 0;
  for (const criterion of criteria) {
    const joint = getKeypoint(pose, criterion.joint);
    const pointA = getKeypoint(pose, criterion.relativeTo[0]);
    const pointB = getKeypoint(pose, criterion.relativeTo[1]);
    const hasRest = typeof criterion.restAngle === 'number';
    if (hasRest) restEligible++;

    if (!joint || !pointA || !pointB) {
      // Invisible joint: can't confirm the rest pose either
      failedCriteria.push(criterion.joint);
      continue;
    }

    const angle = calculateAngle(pointA, joint, pointB);
    const minAngle = criterion.targetAngle - (criterion.targetAngle - criterion.minAngle) * m;
    const maxAngle = criterion.targetAngle + (criterion.maxAngle - criterion.targetAngle) * m;

    if (angle < minAngle) {
      failedCriteria.push(`${criterion.joint}_tooLow`);
    } else if (angle > maxAngle) {
      failedCriteria.push(`${criterion.joint}_tooHigh`);
    }

    if (hasRest) {
      // "Back at rest" = within the first 35% of the excursion from rest toward
      // target — generous on purpose; it only has to detect the return, and the
      // derivation guarantees the target band sits well outside it.
      const rest = criterion.restAngle as number;
      const restLimit = rest + 0.35 * (criterion.targetAngle - rest);
      const inRestZone =
        criterion.targetAngle >= rest ? angle <= restLimit : angle >= restLimit;
      if (inRestZone) restMet++;
    }
  }

  const atRest = restEligible > 0 && restMet === restEligible;

  // Check leveling rules (symmetry)
  for (const rule of levelingRules) {
    const joint1 = getKeypoint(pose, rule.joints[0]);
    const joint2 = getKeypoint(pose, rule.joints[1]);

    if (joint1 && joint2) {
      const diff = Math.abs(joint1.y - joint2.y);
      if (diff > rule.maxDifference * m) {
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
    atRest,
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

/** The 21 landmarks MediaPipeHands (tfjs runtime) detects. */
export const HAND_KEYPOINT_NAMES: readonly string[] = [
  'wrist',
  'thumb_cmc',
  'thumb_mcp',
  'thumb_ip',
  'thumb_tip',
  'index_finger_mcp',
  'index_finger_pip',
  'index_finger_dip',
  'index_finger_tip',
  'middle_finger_mcp',
  'middle_finger_pip',
  'middle_finger_dip',
  'middle_finger_tip',
  'ring_finger_mcp',
  'ring_finger_pip',
  'ring_finger_dip',
  'ring_finger_tip',
  'pinky_finger_mcp',
  'pinky_finger_pip',
  'pinky_finger_dip',
  'pinky_finger_tip',
];

/**
 * Reference points for measuring the angle at each hand joint: MCPs measure
 * knuckle flexion against the wrist, PIPs measure finger curl (mcp → tip),
 * DIPs measure fingertip curl. Wrist and fingertips have no meaningful angle.
 */
export const HAND_ANATOMICAL_REFERENCES: Record<string, [string, string]> = {
  thumb_cmc: ['wrist', 'thumb_mcp'],
  thumb_mcp: ['thumb_cmc', 'thumb_ip'],
  thumb_ip: ['thumb_mcp', 'thumb_tip'],
  index_finger_mcp: ['wrist', 'index_finger_pip'],
  index_finger_pip: ['index_finger_mcp', 'index_finger_tip'],
  index_finger_dip: ['index_finger_pip', 'index_finger_tip'],
  middle_finger_mcp: ['wrist', 'middle_finger_pip'],
  middle_finger_pip: ['middle_finger_mcp', 'middle_finger_tip'],
  middle_finger_dip: ['middle_finger_pip', 'middle_finger_tip'],
  ring_finger_mcp: ['wrist', 'ring_finger_pip'],
  ring_finger_pip: ['ring_finger_mcp', 'ring_finger_tip'],
  ring_finger_dip: ['ring_finger_pip', 'ring_finger_tip'],
  pinky_finger_mcp: ['wrist', 'pinky_finger_pip'],
  pinky_finger_pip: ['pinky_finger_mcp', 'pinky_finger_tip'],
  pinky_finger_dip: ['pinky_finger_pip', 'pinky_finger_tip'],
};

/** The 12 body bone segments every skeleton overlay draws. */
export const BODY_CONNECTIONS: [string, string][] = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

/** The 21 hand bone segments: palm arch + thumb and four finger chains. */
export const HAND_CONNECTIONS: [string, string][] = [
  // Palm
  ['wrist', 'thumb_cmc'],
  ['wrist', 'index_finger_mcp'],
  ['wrist', 'pinky_finger_mcp'],
  ['index_finger_mcp', 'middle_finger_mcp'],
  ['middle_finger_mcp', 'ring_finger_mcp'],
  ['ring_finger_mcp', 'pinky_finger_mcp'],
  // Thumb
  ['thumb_cmc', 'thumb_mcp'],
  ['thumb_mcp', 'thumb_ip'],
  ['thumb_ip', 'thumb_tip'],
  // Index
  ['index_finger_mcp', 'index_finger_pip'],
  ['index_finger_pip', 'index_finger_dip'],
  ['index_finger_dip', 'index_finger_tip'],
  // Middle
  ['middle_finger_mcp', 'middle_finger_pip'],
  ['middle_finger_pip', 'middle_finger_dip'],
  ['middle_finger_dip', 'middle_finger_tip'],
  // Ring
  ['ring_finger_mcp', 'ring_finger_pip'],
  ['ring_finger_pip', 'ring_finger_dip'],
  ['ring_finger_dip', 'ring_finger_tip'],
  // Pinky
  ['pinky_finger_mcp', 'pinky_finger_pip'],
  ['pinky_finger_pip', 'pinky_finger_dip'],
  ['pinky_finger_dip', 'pinky_finger_tip'],
];

// ---- Per-mode lookups ----

export function keypointNamesForMode(mode: TrackingMode): readonly string[] {
  return mode === 'hand' ? HAND_KEYPOINT_NAMES : VALID_KEYPOINT_NAMES;
}

export function referencesForMode(mode: TrackingMode): Record<string, [string, string]> {
  return mode === 'hand' ? HAND_ANATOMICAL_REFERENCES : ANATOMICAL_REFERENCES;
}

export function connectionsForMode(mode: TrackingMode): [string, string][] {
  return mode === 'hand' ? HAND_CONNECTIONS : BODY_CONNECTIONS;
}

/** Two stable keypoints used for in-frame checks and ghost-skeleton anchoring. */
export function anchorPairForMode(mode: TrackingMode): [string, string] {
  return mode === 'hand'
    ? ['wrist', 'middle_finger_mcp']
    : ['left_shoulder', 'right_shoulder'];
}

/** Minimal shape of a recorded demo both admin pages share. */
export interface RecordedDemoFrames {
  frames: Array<{ pose: Pose }>;
}

const MIN_VISIBLE_FRAMES = 10; // pooled frames a joint needs before we trust its stats
const MIN_VISIBLE_RATIO = 0.4; // joint must be measurable in this share of all frames
// Degrees of motion that mark a joint as exercised / pixel travel that marks a
// part as moving. Hands sweep smaller angles (thumb opposition is ~15–30°) and
// occupy far fewer pixels than a body, so their thresholds are tighter.
const MOVING_ROM_THRESHOLD: Record<TrackingMode, number> = { body: 25, hand: 15 };
const MOVING_DISPLACEMENT_PX: Record<TrackingMode, number> = { body: 40, hand: 25 };

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
  const p5 = percentile(smoothed, 0.05);
  const p95 = percentile(smoothed, 0.95);
  // The rest pose is whichever movement extreme the recording starts nearest to
  // — snapping there keeps restAngle honest even when the demo starts slightly
  // into the movement instead of fully at rest.
  const startRaw = percentile(startWindow, 0.5);
  const start = Math.abs(p5 - startRaw) <= Math.abs(p95 - startRaw) ? p5 : p95;
  return {
    count: smoothed.length,
    start,
    p5,
    p95,
    median: percentile(smoothed, 0.5),
  };
}

/** Keypoints that travel far from where they started, in any demo. */
function detectMovingKeypoints(demos: RecordedDemoFrames[], mode: TrackingMode): string[] {
  const validNames = new Set(keypointNamesForMode(mode));
  const moving = new Set<string>();

  for (const demo of demos) {
    const firstSeen: Record<string, { x: number; y: number }> = {};
    for (const frame of demo.frames) {
      for (const kp of frame.pose.keypoints) {
        if (!kp.name || !validNames.has(kp.name) || (kp.score ?? 0) < 0.5) continue;
        const ref = firstSeen[kp.name];
        if (!ref) {
          firstSeen[kp.name] = { x: kp.x, y: kp.y };
        } else if (Math.hypot(kp.x - ref.x, kp.y - ref.y) >= MOVING_DISPLACEMENT_PX[mode]) {
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
 * - Joints whose angle sweeps past the mode's ROM threshold are treated as the
 *   exercised joints. The target is the extreme of the movement (the end furthest
 *   from the rest pose), with a tolerance band tight enough to exclude the rest
 *   pose — otherwise the rep counter would fire while the patient just stands there.
 * - If nothing sweeps that far, the recording is a static hold: every reliably
 *   visible joint gets a criterion around its median angle.
 * - Reference points always come from the mode's anatomical reference table.
 *
 * Returns the exact PoseCriteria shape the session engine consumes. Criteria may
 * be empty when no joint was visible reliably enough.
 */
export function deriveCriteriaFromRecordings(
  demos: RecordedDemoFrames[],
  mode: TrackingMode = 'body'
): PoseCriteria {
  const refTable = referencesForMode(mode);
  const usable = demos.filter((d) => d.frames.length >= 2);
  const totalFrames = usable.reduce((sum, d) => sum + d.frames.length, 0);

  // Pool per-demo stats into one weighted view per joint, keeping the
  // per-demo stats around: the spread between demos is the therapist's own
  // natural variation, which sizes the tolerance bands below.
  const jointStats: Record<string, JointDemoStats> = {};
  const perDemoStats: Record<string, JointDemoStats[]> = {};
  if (totalFrames > 0) {
    for (const [joint, refs] of Object.entries(refTable)) {
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
      perDemoStats[joint] = perDemo;
    }
  }

  const criteria: AngleCriterion[] = [];
  const movingJoints = Object.entries(jointStats)
    .filter(([, s]) => s.p95 - s.p5 >= MOVING_ROM_THRESHOLD[mode])
    .sort(([, a], [, b]) => b.p95 - b.p5 - (a.p95 - a.p5)); // widest sweep first

  if (movingJoints.length > 0) {
    for (const [joint, s] of movingJoints) {
      // Target = the movement extreme furthest from the rest pose. The sweep
      // meets the mode's ROM threshold, so that extreme sits at least half the
      // threshold from rest and the scaled half-band below always leaves the
      // rest pose outside the band.
      const usesP95 = Math.abs(s.p95 - s.start) >= Math.abs(s.p5 - s.start);
      const target = usesP95 ? s.p95 : s.p5;
      let halfBand = Math.min(20, Math.max(10, Math.abs(target - s.start) * 0.4));

      // With 2+ demos, widen the band to cover the therapist's own demo-to-demo
      // variation at the target — capped so the rest pose stays outside it.
      const demos = perDemoStats[joint] ?? [];
      if (demos.length >= 2) {
        const extremes = demos.map((d) => (usesP95 ? d.p95 : d.p5));
        const spread = Math.max(...extremes) - Math.min(...extremes);
        const cap = Math.max(10, Math.min(25, Math.abs(target - s.start) * 0.7));
        halfBand = Math.min(cap, Math.max(halfBand, spread / 2 + 8));
      }

      criteria.push({
        joint,
        targetAngle: Math.round(target),
        minAngle: Math.max(0, Math.round(target - halfBand)),
        maxAngle: Math.min(180, Math.round(target + halfBand)),
        restAngle: Math.round(s.start),
        relativeTo: [...refTable[joint]] as [string, string],
      });
    }
  } else {
    // Static hold: the whole recording is the target pose.
    for (const [joint, s] of Object.entries(jointStats)) {
      let halfBand = Math.max(10, (s.p95 - s.p5) / 2 + 5);

      // With 2+ demos, cover the drift between the demos' median poses too.
      const demos = perDemoStats[joint] ?? [];
      if (demos.length >= 2) {
        const medians = demos.map((d) => d.median);
        const spread = Math.max(...medians) - Math.min(...medians);
        halfBand = Math.min(30, Math.max(halfBand, spread / 2 + 8));
      }

      criteria.push({
        joint,
        targetAngle: Math.round(s.median),
        minAngle: Math.max(0, Math.round(s.median - halfBand)),
        maxAngle: Math.min(180, Math.round(s.median + halfBand)),
        relativeTo: [...refTable[joint]] as [string, string],
      });
    }
  }

  // Everything the criteria reference must be visible during a session, plus
  // whatever visibly moved (drives the skeleton highlight in the editor).
  const targetBodyParts = new Set<string>(detectMovingKeypoints(usable, mode));
  for (const c of criteria) {
    targetBodyParts.add(c.joint);
    targetBodyParts.add(c.relativeTo[0]);
    targetBodyParts.add(c.relativeTo[1]);
  }

  return { targetBodyParts: [...targetBodyParts], criteria, levelingRules: [] };
}

/**
 * Pick the recorded frame that best shows the target pose — used as the ghost
 * skeleton patients see during a session. For dynamic exercises that's the
 * frame where the primary joint is closest to its target angle; for static
 * holds (or missing criteria) the middle frame of the demo.
 */
export function pickReferencePose(
  demos: RecordedDemoFrames[] | null | undefined,
  poseCriteria: PoseCriteria | null | undefined
): Pose | null {
  const demo = demos?.find((d) => d.frames && d.frames.length > 0);
  if (!demo) return null;

  const middle = demo.frames[Math.floor(demo.frames.length / 2)].pose;
  const crit = poseCriteria?.criteria?.[0];
  if (!crit) return middle;

  let best: Pose | null = null;
  let bestDiff = Infinity;
  for (const frame of demo.frames) {
    const joint = getKeypoint(frame.pose, crit.joint);
    const a = getKeypoint(frame.pose, crit.relativeTo[0]);
    const b = getKeypoint(frame.pose, crit.relativeTo[1]);
    if (!joint || !a || !b) continue;
    const diff = Math.abs(calculateAngle(a, joint, b) - crit.targetAngle);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = frame.pose;
    }
  }
  return best ?? middle;
}

/**
 * Generic rep counter for any exercise type
 * Works with both static holds and dynamic movements
 */
export class GenericRepCounter {
  private wasInPosition = false;
  private positionHeldSince = 0;
  private lastInPositionAt = 0;
  private countedThisHold = false;
  private repCount = 0;
  private lastTransitionTime = 0;
  private readonly minRepInterval = 1000; // ms cooldown between reps
  // Pose keypoints jitter frame to frame; a single out-of-tolerance frame must
  // not reset an otherwise steady hold. Only treat the position as exited after
  // the criteria have failed continuously for this long.
  private readonly exitGraceMs = 300;
  private holdThreshold: number;

  constructor(holdThresholdMs: number = 500) {
    this.holdThreshold = holdThresholdMs;
  }

  count(analysis: ExerciseAnalysis): {
    repCount: number;
    justCompleted: boolean;
    holdProgress: number;
    holdMissed: boolean;
    holdEarned: boolean;
  } {
    const now = Date.now();
    const inPosition = analysis.meetsAllCriteria;
    let justCompleted = false;
    let holdMissed = false;

    if (inPosition) {
      this.lastInPositionAt = now;
      if (!this.wasInPosition) {
        // Entered correct position
        this.wasInPosition = true;
        this.positionHeldSince = now;
        this.countedThisHold = false;
      }
      // Count the rep the moment the hold is earned — while the patient is
      // still holding — so the app reacts immediately instead of waiting for
      // them to leave the position.
      if (
        !this.countedThisHold &&
        now - this.positionHeldSince >= this.holdThreshold &&
        now - this.lastTransitionTime >= this.minRepInterval
      ) {
        this.repCount++;
        justCompleted = true;
        this.countedThisHold = true;
        this.lastTransitionTime = now;
      }
    } else if (this.wasInPosition && now - this.lastInPositionAt >= this.exitGraceMs) {
      // Really exited (out of position past the jitter grace window)
      const heldFor =
        this.positionHeldSince > 0 ? this.lastInPositionAt - this.positionHeldSince : 0;
      if (!this.countedThisHold && heldFor < this.holdThreshold) {
        holdMissed = true;
      }
      this.wasInPosition = false;
      this.positionHeldSince = 0;
      this.countedThisHold = false;
    }

    const holdProgress = this.countedThisHold
      ? 1
      : this.wasInPosition && this.positionHeldSince > 0
        ? Math.min(1, (now - this.positionHeldSince) / this.holdThreshold)
        : 0;

    return {
      repCount: this.repCount,
      justCompleted,
      holdProgress,
      holdMissed,
      holdEarned: this.countedThisHold,
    };
  }

  reset() {
    this.wasInPosition = false;
    this.positionHeldSince = 0;
    this.lastInPositionAt = 0;
    this.countedThisHold = false;
    this.repCount = 0;
    this.lastTransitionTime = 0;
  }

  getCount() {
    return this.repCount;
  }
}

export type CyclePhase = 'rest' | 'lifting' | 'holding' | 'lowering';

/**
 * Full-cycle rep counter for dynamic exercises with a known rest pose.
 * A rep = rest → target (held long enough) → back to rest, so partial reps and
 * "pumping" near the target without returning don't count. Requires criteria
 * with restAngle (analyzeExercise reports atRest); exercises without one should
 * use GenericRepCounter instead.
 */
export class CycleRepCounter {
  private phase: CyclePhase = 'rest';
  private holdStart = 0;
  private lastAtTargetAt = 0;
  private holdSatisfied = false;
  private repCount = 0;
  private lastRepTime = 0;
  private readonly minRepInterval = 1000; // ms cooldown between reps
  // Keypoint jitter makes borderline frames flicker out of tolerance; a hold
  // only ends after the target criteria fail continuously for this long, so a
  // steady hold isn't reset by a single noisy frame.
  private readonly exitGraceMs = 300;
  private holdThreshold: number;

  constructor(holdThresholdMs: number = 500) {
    this.holdThreshold = holdThresholdMs;
  }

  count(analysis: ExerciseAnalysis): {
    repCount: number;
    justCompleted: boolean;
    holdProgress: number;
    holdMissed: boolean;
    holdEarned: boolean;
    phase: CyclePhase;
  } {
    const now = Date.now();
    const atTarget = analysis.meetsAllCriteria;
    const atRest = analysis.atRest;
    let justCompleted = false;
    let holdMissed = false;

    const completeIfEarned = () => {
      if (this.holdSatisfied && now - this.lastRepTime >= this.minRepInterval) {
        this.repCount++;
        justCompleted = true;
        this.lastRepTime = now;
      }
      this.holdSatisfied = false;
    };

    switch (this.phase) {
      case 'rest':
        if (atTarget) {
          this.phase = 'holding';
          this.holdStart = now;
          this.lastAtTargetAt = now;
          this.holdSatisfied = false;
        } else if (!atRest) {
          this.phase = 'lifting';
        }
        break;

      case 'lifting':
        if (atTarget) {
          this.phase = 'holding';
          this.holdStart = now;
          this.lastAtTargetAt = now;
          this.holdSatisfied = false;
        } else if (atRest) {
          this.phase = 'rest'; // returned without reaching the target
        }
        break;

      case 'holding':
        if (atTarget) {
          this.lastAtTargetAt = now;
          if (now - this.holdStart >= this.holdThreshold) this.holdSatisfied = true;
        } else if (now - this.lastAtTargetAt >= this.exitGraceMs) {
          // Really left the target band (past the jitter grace window)
          if (!this.holdSatisfied) holdMissed = true;
          if (atRest) {
            completeIfEarned();
            this.phase = 'rest';
          } else {
            this.phase = 'lowering';
          }
        }
        break;

      case 'lowering':
        if (atTarget) {
          // Came back up — resume the hold (an already-earned hold stays earned)
          this.phase = 'holding';
          this.holdStart = now;
          this.lastAtTargetAt = now;
        } else if (atRest) {
          completeIfEarned();
          this.phase = 'rest';
        }
        break;
    }

    const holdProgress =
      this.holdSatisfied
        ? 1
        : this.phase === 'holding'
          ? Math.min(1, (now - this.holdStart) / this.holdThreshold)
          : 0;

    return {
      repCount: this.repCount,
      justCompleted,
      holdProgress,
      holdMissed,
      holdEarned: this.holdSatisfied,
      phase: this.phase,
    };
  }

  reset() {
    this.phase = 'rest';
    this.holdStart = 0;
    this.lastAtTargetAt = 0;
    this.holdSatisfied = false;
    this.repCount = 0;
    this.lastRepTime = 0;
  }

  getCount() {
    return this.repCount;
  }
}
