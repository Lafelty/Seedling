// The inference engine itself lives in lib/detectionCore.ts and normally runs
// inside a Web Worker (lib/detection.worker.ts) so model execution never
// blocks the UI thread — main-thread inference was the root cause of phone
// jank. This module keeps the page-facing facade (initDetector / detect /
// disposeDetector) plus everything that consumes poses: the validation
// engine, criteria derivation, and rep counters.
import {
  initCore,
  detectCore,
  disposeCore,
  canonicalFrameSize,
  CANONICAL_FRAME_HEIGHT,
  HAND_KEYPOINT_NAMES,
  type TrackingMode,
  type Keypoint,
  type Pose,
} from './detectionCore';

export { HAND_KEYPOINT_NAMES, canonicalFrameSize, CANONICAL_FRAME_HEIGHT };
export type { TrackingMode, Keypoint, Pose };

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

// ---- Mode facade: the only detector API pages should call ----
//
// Worker-first: frames are shipped to lib/detection.worker.ts as transferred
// ImageBitmaps and inference happens there, so the main thread only pays for
// the bitmap grab. If the browser can't (no Worker/createImageBitmap) or the
// worker's model fails to initialize (e.g. no OffscreenCanvas WebGL), the same
// engine runs on the main thread instead — identical results, just blocking.

let worker: Worker | null = null;
// Sticky per-page-load: once the worker path fails we stop retrying it.
let workerBroken = false;
let usingWorker = false;
let msgSeq = 1;
const pending = new Map<number, (value: any) => void>();
// Bumped on every dispose so an initDetector still awaiting its worker (or
// main-thread model) load doesn't resurrect a disposed session.
let facadeGen = 0;
let lastWorkerPose: Pose | null = null;
let detectInFlight = false;
// Which mode the MAIN-THREAD engine currently holds a model for (null = none).
// Distinct from the worker's: when the page runs on the worker, this stays null
// until a retirement forces the fallback to load its own copy.
let mainThreadMode: TrackingMode | null = null;
let mainThreadInit: Promise<boolean> | null = null;

function workerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof createImageBitmap === 'function'
  );
}

// Per-message deadlines. The worker always replies (see detection.worker.ts),
// so these only fire when it is wedged beyond recovery — a hung wasm call, a
// tab the browser froze, a crashed process that never raised onerror. Without
// them a single lost reply leaves the promise unsettled forever, pinning
// detectInFlight true so every later detect() returns the same stale pose.
// Init covers downloading the ~8 MB model plus GPU shader warm-up on a cold,
// slow device; detection is one inference on a frame that is already decoded.
const WORKER_INIT_TIMEOUT_MS = 60000;
const WORKER_CALL_TIMEOUT_MS = 15000;

/** Tear the worker down and route this page to the main thread from here on. */
function retireWorker(reason: string) {
  console.error(`Detection worker retired (${reason}) — falling back to main thread`);
  workerBroken = true;
  usingWorker = false;
  // Unblock every waiter before dropping them, or their callers hang too.
  for (const resolve of pending.values()) resolve(null);
  pending.clear();
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./detection.worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent) => {
      const id = e.data?.id;
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(e.data);
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      // Worker script failed to load or crashed synchronously.
      retireWorker(e.message || 'worker error');
    };
  }
  return worker;
}

function callWorker(
  msg: Record<string, unknown>,
  transfer?: Transferable[],
  timeoutMs = WORKER_CALL_TIMEOUT_MS
): Promise<any> {
  const w = getWorker();
  const id = msgSeq++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return; // answered in the same tick the timer fired
      pending.delete(id);
      retireWorker(`no reply to '${String(msg.type)}' in ${timeoutMs}ms`);
      resolve(null);
    }, timeoutMs);
    pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    w.postMessage({ ...msg, id }, transfer ?? []);
  });
}

/** Load the main-thread model for `mode` once, sharing one in-flight attempt. */
function ensureMainThreadModel(mode: TrackingMode): Promise<boolean> {
  if (mainThreadMode === mode) return Promise.resolve(true);
  if (!mainThreadInit) {
    const gen = facadeGen;
    mainThreadInit = initCore(mode)
      .then((ok) => {
        if (ok && gen === facadeGen) mainThreadMode = mode;
        return ok;
      })
      .finally(() => {
        mainThreadInit = null;
      });
  }
  return mainThreadInit;
}

/** Init the detector for a mode, disposing the other model first (one model resident at a time). */
export async function initDetector(mode: TrackingMode): Promise<boolean> {
  const gen = facadeGen;
  lastWorkerPose = null;

  if (!workerBroken && workerSupported()) {
    try {
      const res = await callWorker({ type: 'init', mode }, undefined, WORKER_INIT_TIMEOUT_MS);
      if (gen !== facadeGen) return false;
      if (res?.ok) {
        usingWorker = true;
        return true;
      }
      // Model couldn't start inside the worker (or it timed out and already
      // retired itself) — make sure it's gone and fall through to the
      // main-thread engine.
      if (worker) retireWorker(res?.error ? `init failed: ${res.error}` : 'init returned not-ok');
      workerBroken = true;
    } catch (error) {
      console.error('Detection worker init failed, falling back to main thread:', error);
      workerBroken = true;
    }
  }

  usingWorker = false;
  if (gen !== facadeGen) return false;
  const ok = await ensureMainThreadModel(mode);
  return gen === facadeGen ? ok : false;
}

export async function detect(
  video: HTMLVideoElement,
  mode: TrackingMode,
  // Video-file processing passes its own clock (upload base + media time) so the
  // hand tracker sees frames spaced by real video time, not by how long each
  // inference happened to take. Live callers omit it.
  timestampMs?: number
): Promise<Pose | null> {
  const ts = timestampMs ?? performance.now();
  if (usingWorker && worker) {
    if (!video.videoWidth || !video.videoHeight) return null;
    // Never queue frames behind a slow inference — reuse the last result so
    // callers keep a steady pose while the worker catches up.
    if (detectInFlight) return lastWorkerPose;
    detectInFlight = true;
    try {
      const bitmap = await createImageBitmap(video);
      const res = await callWorker(
        // detectForVideo needs a monotonically increasing timestamp; taking it
        // here (not in the worker) keeps it monotonic across worker restarts.
        { type: 'detect', mode, bitmap, timestamp: ts },
        [bitmap]
      );
      if (res?.error) {
        // The worker answered, but detection is structurally broken in there
        // (detectCore swallows ordinary inference errors itself). Stop asking.
        retireWorker(`detect failed: ${res.error}`);
        return null;
      }
      lastWorkerPose = (res?.pose as Pose | null) ?? null;
      return lastWorkerPose;
    } catch (error) {
      console.error('Worker detection error:', error);
      return null;
    } finally {
      detectInFlight = false;
    }
  }

  // Main-thread engine. After a mid-session worker retirement it holds no
  // model — the page initialized the worker's, not this one's — so load it
  // once and let the next frames use it, rather than warning per frame forever.
  if (mainThreadMode !== mode) {
    ensureMainThreadModel(mode).catch(() => {
      // Reported by initCore; the next frame retries.
    });
    return null;
  }
  return detectCore(video, mode, ts);
}

/**
 * Resolve once no detection is in flight. Video-file processing calls this
 * before its first frame: detect() returns the LAST pose instantly while a
 * call is pending, which would let the capture loop believe frames were
 * analyzed (with stale camera poses, no less) while playback rolled past them.
 */
export async function waitForDetectorIdle(timeoutMs = 10000): Promise<void> {
  const start = performance.now();
  while (detectInFlight && performance.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

export function disposeDetector() {
  facadeGen++; // invalidate any initDetector still in flight
  if (worker) {
    worker.terminate(); // frees the worker's models with it
    worker = null;
  }
  for (const resolve of pending.values()) resolve(null);
  pending.clear();
  usingWorker = false;
  detectInFlight = false;
  lastWorkerPose = null;
  mainThreadMode = null;
  mainThreadInit = null;
  disposeCore();
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
  /** Vertical tolerance in CANONICAL keypoint units (see canonicalFrameSize) —
   * the same space recordings are stored in and live sessions are measured in. */
  maxDifference: number;
  message: string;
}

/** Which coordinate space the stored angles were measured in. Bands derived in
 * one space are only valid when validated in the same space. */
export type AngleSpace = '2d' | '3d';

export interface PoseCriteria {
  targetBodyParts: string[];
  criteria: AngleCriterion[];
  levelingRules: LevelingRule[];
  // Difficulty dial: scales every angle band and leveling tolerance without
  // touching the stored angles. >1 = more lenient, <1 = stricter. Default 1.
  toleranceMultiplier?: number;
  // '3d' when the criteria were derived from recordings carrying world
  // coordinates; absent on older rows (which were measured in 2D).
  angleSpace?: AngleSpace;
}

export interface ExerciseAnalysis {
  meetsAllCriteria: boolean;
  // True when every criterion that defines a restAngle is back in its rest zone
  // (and all of their keypoints are visible). Always false if none define one.
  atRest: boolean;
  feedback: 'good' | 'adjust' | 'analyzing';
  message: string;
  failedCriteria: string[];
  // 0..1 position of the primary mover along its rest→target range (0 at rest,
  // 1 at the target extreme). Drives the live progress ring and the ROM
  // hysteresis rep counter. Undefined when the primary joint isn't measurable
  // this frame or the exercise has no rest-defining criterion.
  progress?: number;
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
 * Measure the angle at `joint` in the requested space. '3d' uses the metric
 * world coordinates when all three points carry them — invariant to how the
 * hand is rotated relative to the camera, which 2D screen angles are not —
 * and silently falls back to 2D when world coords are missing (old
 * recordings, body mode).
 */
export function measureAngle(
  pointA: Keypoint,
  joint: Keypoint,
  pointC: Keypoint,
  space: AngleSpace = '2d'
): number {
  if (space === '3d' && pointA.world && joint.world && pointC.world) {
    const v1 = {
      x: pointA.world.x - joint.world.x,
      y: pointA.world.y - joint.world.y,
      z: pointA.world.z - joint.world.z,
    };
    const v2 = {
      x: pointC.world.x - joint.world.x,
      y: pointC.world.y - joint.world.y,
      z: pointC.world.z - joint.world.z,
    };
    const m1 = Math.hypot(v1.x, v1.y, v1.z);
    const m2 = Math.hypot(v2.x, v2.y, v2.z);
    if (m1 === 0 || m2 === 0) return 0;
    const cos = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (m1 * m2);
    return Math.acos(Math.min(1, Math.max(-1, cos))) * (180 / Math.PI);
  }
  return calculateAngle(pointA, joint, pointC);
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

  // Every detected hand must do the exercise: evaluate the criteria against
  // the primary keypoints AND each extra hand, so a two-hand patient isn't
  // validated on whichever hand happens to be primary. Body mode never sets
  // extraHands, so this stays the single-set path it always was.
  const sets: Pose[] = [pose, ...(pose.extraHands ?? [])];

  // Difficulty dial — widens (or tightens) every band around its target
  const m = poseCriteria?.toleranceMultiplier ?? 1;
  // Measure in the same space the bands were derived in, or they don't compare.
  const space: AngleSpace = poseCriteria?.angleSpace === '3d' ? '3d' : '2d';

  const failedSet = new Set<string>();
  let anyMissingParts = false;
  let allAtRest = true;

  // Only the joints the criteria actually use need to be in frame — not every
  // part that happened to drift during the demo. An arm exercise shouldn't
  // demand the legs be visible just because a hallucinated lower-body landmark
  // jittered in the recording. (targetBodyParts still lists the movers for the
  // editor's skeleton highlight; it's just not the visibility gate anymore.)
  const requiredParts = new Set<string>();
  for (const c of criteria) {
    requiredParts.add(c.joint);
    requiredParts.add(c.relativeTo[0]);
    requiredParts.add(c.relativeTo[1]);
  }
  for (const rule of levelingRules) {
    requiredParts.add(rule.joints[0]);
    requiredParts.add(rule.joints[1]);
  }
  // Fall back to the stored list only if the criteria reference nothing usable.
  const partsToCheck = requiredParts.size > 0 ? [...requiredParts] : targetBodyParts;

  for (const set of sets) {
    // Check if the joints this exercise depends on are visible on this hand/body
    const missingParts = partsToCheck.filter((part) => !getKeypoint(set, part));
    if (missingParts.length > 0) {
      anyMissingParts = true;
      allAtRest = false;
      continue;
    }

    // Check angle criteria, tracking the rest zone alongside the target band
    let restEligible = 0;
    let restMet = 0;
    for (const criterion of criteria) {
      const joint = getKeypoint(set, criterion.joint);
      const pointA = getKeypoint(set, criterion.relativeTo[0]);
      const pointB = getKeypoint(set, criterion.relativeTo[1]);
      const hasRest = typeof criterion.restAngle === 'number';
      if (hasRest) restEligible++;

      if (!joint || !pointA || !pointB) {
        // Invisible joint: can't confirm the rest pose either
        failedSet.add(criterion.joint);
        continue;
      }

      const angle = measureAngle(pointA, joint, pointB, space);
      const minAngle = criterion.targetAngle - (criterion.targetAngle - criterion.minAngle) * m;
      const maxAngle = criterion.targetAngle + (criterion.maxAngle - criterion.targetAngle) * m;

      if (angle < minAngle) {
        failedSet.add(`${criterion.joint}_tooLow`);
      } else if (angle > maxAngle) {
        failedSet.add(`${criterion.joint}_tooHigh`);
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

    if (!(restEligible > 0 && restMet === restEligible)) allAtRest = false;

    // Check leveling rules (symmetry)
    for (const rule of levelingRules) {
      const joint1 = getKeypoint(set, rule.joints[0]);
      const joint2 = getKeypoint(set, rule.joints[1]);

      if (joint1 && joint2) {
        const diff = Math.abs(joint1.y - joint2.y);
        if (diff > rule.maxDifference * m) {
          failedSet.add(`leveling_${rule.joints[0]}_${rule.joints[1]}`);
        }
      }
    }
  }

  if (anyMissingParts) {
    return {
      meetsAllCriteria: false,
      atRest: false,
      feedback: 'analyzing',
      message: fm.notInFrame || 'Position yourself in frame',
      failedCriteria: ['visibility'],
    };
  }

  const atRest = allAtRest;
  const failedCriteria = [...failedSet];

  // Movement progress of the primary mover on the primary body/hand: 0 at the
  // rest pose, 1 at the target extreme. Derivation sorts criteria widest-sweep
  // first, so the first rest-defining criterion is the joint that best defines
  // the rep. Measured in the same space the bands were derived in.
  let progress: number | undefined;
  const primary = criteria.find((c) => typeof c.restAngle === 'number');
  if (primary) {
    const pj = getKeypoint(pose, primary.joint);
    const pa = getKeypoint(pose, primary.relativeTo[0]);
    const pb = getKeypoint(pose, primary.relativeTo[1]);
    const span = primary.targetAngle - (primary.restAngle as number);
    if (pj && pa && pb && Math.abs(span) > 1) {
      const angle = measureAngle(pa, pj, pb, space);
      progress = Math.min(1, Math.max(0, (angle - (primary.restAngle as number)) / span));
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
    progress,
  };
}

// ============================================================================
// Auto-derivation of validation criteria from recorded demonstrations
// ============================================================================

/** The 17 COCO body keypoints the body engine emits — the only valid names for joints and reference points. */
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
  /** Canonical-space frame the keypoints were captured in. Written by the
   * recorder; absent on rows recorded before keypoints were canonicalized. */
  frameSize?: { width: number; height: number };
}

/**
 * The coordinate box a demo's keypoints live in — what an editor canvas has to
 * be sized to for the skeleton to land on screen.
 *
 * Prefers the size the recorder stored. Rows recorded before keypoints were
 * canonicalized carry raw source pixels instead (a portrait phone clip stored
 * coordinates up to 1080×1920), so fall back to the actual extent of the
 * recorded points, never smaller than the canonical frame — otherwise a demo
 * where the subject sat in one corner would render zoomed in.
 */
export function frameSizeForDemo(
  demo: RecordedDemoFrames | null | undefined
): { width: number; height: number } {
  const canonical = canonicalFrameSize(0, 0); // 4:3 canonical default
  if (demo?.frameSize?.width && demo.frameSize.height) {
    return { width: demo.frameSize.width, height: demo.frameSize.height };
  }

  let maxX = 0;
  let maxY = 0;
  for (const frame of demo?.frames ?? []) {
    for (const kp of frame.pose?.keypoints ?? []) {
      if ((kp.score ?? 0) <= 0.3) continue;
      if (kp.x > maxX) maxX = kp.x;
      if (kp.y > maxY) maxY = kp.y;
    }
  }

  return {
    width: Math.max(canonical.w, Math.ceil(maxX * 1.05)),
    height: Math.max(canonical.h, Math.ceil(maxY * 1.05)),
  };
}

const MIN_VISIBLE_FRAMES = 10; // pooled frames a joint needs before we trust its stats
const MIN_VISIBLE_RATIO = 0.4; // joint must be measurable in this share of all frames
// Degrees of motion that mark a joint as exercised / travel that marks a part
// as moving. Hands sweep smaller angles (thumb opposition is ~15–30°) and
// occupy far less of the frame than a body, so their thresholds are tighter.
// Displacement is in canonical keypoint units (see canonicalFrameSize), which
// is why it means the same thing for a 720p session and a portrait phone clip.
const MOVING_ROM_THRESHOLD: Record<TrackingMode, number> = { body: 25, hand: 15 };
const MOVING_DISPLACEMENT_PX: Record<TrackingMode, number> = { body: 40, hand: 25 };
// A fist sweeps nearly every hand joint past the ROM threshold; requiring all
// 15 to sit in-band on the same frame made validation almost impossible to
// pass. Keep only the widest-sweeping joints — they define the movement, the
// rest is correlated noise. Body mode has 8 candidate joints at most and
// rarely more than a few movers, so it keeps them all.
const MAX_CRITERIA_JOINTS: Record<TrackingMode, number> = { body: 8, hand: 4 };
// Hand angles jitter more than body angles (small joints, self-occlusion), so
// their tolerance bands get a wider floor and ceiling.
const BAND_FLOOR_DEG: Record<TrackingMode, number> = { body: 10, hand: 15 };
const BAND_CAP_DEG: Record<TrackingMode, number> = { body: 20, hand: 28 };

/** Centered moving average — pose-estimation angles jitter several degrees frame to frame.
 * Exported for lib/trajectory.ts, which smooths live angle curves the same way. */
export function smoothSeries(values: number[], windowSize = 5): number[] {
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
  refs: [string, string],
  space: AngleSpace
): JointDemoStats | null {
  const series: number[] = [];
  for (const frame of demo.frames) {
    const j = getKeypoint(frame.pose, joint);
    const a = getKeypoint(frame.pose, refs[0]);
    const b = getKeypoint(frame.pose, refs[1]);
    if (!j || !a || !b) continue;
    series.push(measureAngle(a, j, b, space));
  }
  if (series.length < 5) return null;

  const smoothed = smoothSeries(series);
  const p5 = percentile(smoothed, 0.05);
  const p95 = percentile(smoothed, 0.95);
  // Rest = whichever movement extreme the recording reaches FIRST in time.
  // Deciding by time (not by the magnitude of a leading window) is independent
  // of recording length and speed: a long or fast demo can't mis-snap rest to
  // the far extreme and invert the whole movement direction — the failure mode
  // where a top->bottom demo was derived, and then guided, as bottom->top.
  // (First occurrence wins, so a demo that returns to rest at the end still
  // reads its true starting extreme as rest.)
  let idxMin = 0;
  let idxMax = 0;
  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i] < smoothed[idxMin]) idxMin = i;
    if (smoothed[i] > smoothed[idxMax]) idxMax = i;
  }
  const start = idxMin <= idxMax ? p5 : p95;
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

  // Derive in 3D only for HAND recordings, whose HandLandmarker world
  // coordinates are metric and stable enough for rotation-invariant angles.
  // Body recordings now also carry world coords (BlazePose), but body 3D angles
  // aren't reliable enough to validate against yet — a 3D shoulder angle barely
  // tracks a frontal-plane arm arc, producing bands that never discriminate.
  // Body therefore stays on the 2D screen-angle math that works end-to-end.
  // The flag is stored on the result so validation measures in the same space.
  const worldFrames = usable.reduce(
    (sum, d) => sum + d.frames.filter((f) => f.pose.keypoints?.[0]?.world).length,
    0
  );
  const space: AngleSpace =
    mode === 'hand' && totalFrames > 0 && worldFrames / totalFrames > 0.5 ? '3d' : '2d';

  // Pool per-demo stats into one weighted view per joint, keeping the
  // per-demo stats around: the spread between demos is the therapist's own
  // natural variation, which sizes the tolerance bands below.
  const jointStats: Record<string, JointDemoStats> = {};
  const perDemoStats: Record<string, JointDemoStats[]> = {};
  if (totalFrames > 0) {
    for (const [joint, refs] of Object.entries(refTable)) {
      const perDemo = usable
        .map((d) => collectJointStats(d, joint, refs, space))
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
    .sort(([, a], [, b]) => b.p95 - b.p5 - (a.p95 - a.p5)) // widest sweep first
    .slice(0, MAX_CRITERIA_JOINTS[mode]);

  if (movingJoints.length > 0) {
    for (const [joint, s] of movingJoints) {
      // Target = the movement extreme furthest from the rest pose. The sweep
      // meets the mode's ROM threshold, so that extreme sits at least half the
      // threshold from rest and the scaled half-band below always leaves the
      // rest pose outside the band.
      const usesP95 = Math.abs(s.p95 - s.start) >= Math.abs(s.p5 - s.start);
      const target = usesP95 ? s.p95 : s.p5;
      let halfBand = Math.min(
        BAND_CAP_DEG[mode],
        Math.max(BAND_FLOOR_DEG[mode], Math.abs(target - s.start) * 0.4)
      );

      // With 2+ demos, widen the band to cover the therapist's own demo-to-demo
      // variation at the target — capped so the rest pose stays outside it.
      const demos = perDemoStats[joint] ?? [];
      if (demos.length >= 2) {
        const extremes = demos.map((d) => (usesP95 ? d.p95 : d.p5));
        const spread = Math.max(...extremes) - Math.min(...extremes);
        const cap = Math.max(
          BAND_FLOOR_DEG[mode],
          Math.min(BAND_CAP_DEG[mode] + 5, Math.abs(target - s.start) * 0.7)
        );
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
      let halfBand = Math.max(BAND_FLOOR_DEG[mode], (s.p95 - s.p5) / 2 + 5);

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

  return { targetBodyParts: [...targetBodyParts], criteria, levelingRules: [], angleSpace: space };
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

  const refSpace: AngleSpace = poseCriteria?.angleSpace === '3d' ? '3d' : '2d';
  let best: Pose | null = null;
  let bestDiff = Infinity;
  for (const frame of demo.frames) {
    const joint = getKeypoint(frame.pose, crit.joint);
    const a = getKeypoint(frame.pose, crit.relativeTo[0]);
    const b = getKeypoint(frame.pose, crit.relativeTo[1]);
    if (!joint || !a || !b) continue;
    const diff = Math.abs(measureAngle(a, joint, b, refSpace) - crit.targetAngle);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = frame.pose;
    }
  }
  return best ?? middle;
}

/** Linearly blend two poses (keypoint x/y and world) by fraction f in [0,1],
 * matched by keypoint name. Used to synthesize in-between guide poses so the
 * guide moves smoothly even where the recording has few frames. */
function lerpPose(a: Pose, b: Pose, f: number): Pose {
  const bByName = new Map(b.keypoints.map((k) => [k.name, k] as const));
  const keypoints: Keypoint[] = a.keypoints.map((ka) => {
    const kb = ka.name ? bByName.get(ka.name) : undefined;
    if (!kb) return ka;
    const world =
      ka.world && kb.world
        ? {
            x: ka.world.x + (kb.world.x - ka.world.x) * f,
            y: ka.world.y + (kb.world.y - ka.world.y) * f,
            z: ka.world.z + (kb.world.z - ka.world.z) * f,
          }
        : ka.world;
    return {
      ...ka,
      x: ka.x + (kb.x - ka.x) * f,
      y: ka.y + (kb.y - ka.y) * f,
      score: Math.min(ka.score ?? 1, kb.score ?? 1),
      world,
    };
  });
  return { keypoints, score: a.score };
}

/**
 * Build the ordered poses of the movement's rising limb (rest -> target) from a
 * recorded demo, so a session can pose an animated guide skeleton at any point
 * `p` in [0,1] along the movement: guideFrames[round(p * (len-1))]. Uses the
 * primary rest-defining criterion to locate the rest start and target extreme;
 * returns [] when the exercise has no such criterion (static holds) or no demo
 * shows it — callers then fall back to a static reference pose.
 */
export function buildGuideFrames(
  demos: Array<{ frames: Array<{ pose: Pose }> }> | null | undefined,
  criteria: PoseCriteria | null | undefined
): Pose[] {
  const crit = criteria?.criteria?.find((c) => typeof c.restAngle === 'number');
  const demo = demos?.find((d) => (d.frames?.length ?? 0) >= 4);
  if (!crit || !demo) return [];

  const space: AngleSpace = criteria?.angleSpace === '3d' ? '3d' : '2d';
  const rest = crit.restAngle as number;
  const span = crit.targetAngle - rest;
  if (Math.abs(span) < 1) return [];

  // Progress (0 at rest, 1 at target) of the primary joint on each frame.
  const prog: Array<number | null> = demo.frames.map((f) => {
    const j = getKeypoint(f.pose, crit.joint);
    const a = getKeypoint(f.pose, crit.relativeTo[0]);
    const b = getKeypoint(f.pose, crit.relativeTo[1]);
    if (!j || !a || !b) return null;
    return Math.min(1, Math.max(0, (measureAngle(a, j, b, space) - rest) / span));
  });

  // Target = the frame nearest the extreme; rest = the lowest-progress frame
  // before it. The slice between them is the rest -> target sweep to animate.
  let targetIdx = -1;
  let targetVal = -Infinity;
  prog.forEach((p, i) => {
    if (p !== null && p > targetVal) {
      targetVal = p;
      targetIdx = i;
    }
  });
  if (targetIdx < 0) return [];

  let restIdx = targetIdx;
  let restVal = Infinity;
  for (let i = 0; i <= targetIdx; i++) {
    const p = prog[i];
    if (p !== null && p < restVal) {
      restVal = p;
      restIdx = i;
    }
  }
  if (restIdx >= targetIdx) return [];

  // Pair each rising-limb frame with its progress, drop unmeasured frames, and
  // sort ascending into a monotonic rest -> target sequence (also irons out
  // per-frame progress jitter).
  const pts = demo.frames
    .slice(restIdx, targetIdx + 1)
    .map((f, i) => ({ p: prog[restIdx + i], pose: f.pose }))
    .filter((x): x is { p: number; pose: Pose } => x.p !== null)
    .sort((a, b) => a.p - b.p);
  if (pts.length < 2) return pts.map((x) => x.pose);

  // Resample to uniform MOVEMENT steps by interpolating between the bracketing
  // frames. Uniform in progress (not recording time) means a pause the therapist
  // made at an extreme doesn't freeze the guide there; interpolating means a
  // range the arm swept through quickly — leaving few recorded frames — is still
  // shown smoothly instead of jumping.
  const STEPS = 32;
  const lo0 = pts[0].p;
  const hi0 = pts[pts.length - 1].p;
  const out: Pose[] = [];
  let seg = 0;
  for (let k = 0; k < STEPS; k++) {
    const wantP = lo0 + (hi0 - lo0) * (k / (STEPS - 1));
    while (seg < pts.length - 2 && pts[seg + 1].p < wantP) seg++;
    const lo = pts[seg];
    const hi = pts[seg + 1];
    const f = hi.p === lo.p ? 0 : Math.min(1, Math.max(0, (wantP - lo.p) / (hi.p - lo.p)));
    out.push(lerpPose(lo.pose, hi.pose, f));
  }
  return out;
}

// ---- Auto-trim of recorded demos ----

// Mean per-keypoint travel between consecutive frames that counts as "moving",
// in canonical keypoint units (see canonicalFrameSize — frame height is always
// 480 there, whatever the camera or clip resolution). Hands cover less of the
// frame, so a lower bar.
const TRIM_ENERGY_PX: Record<TrackingMode, number> = { body: 4, hand: 2.5 };
const TRIM_MARGIN_MS = 400; // rest kept on both sides of the active span

/**
 * Drop idle frames from the start and end of a recording — the dead seconds
 * between pressing Record and actually moving (and after finishing). Keeps a
 * short rest margin on both sides so derivation still sees the rest pose.
 * Static holds (no frame ever crosses the energy bar) are returned untouched,
 * as are recordings where trimming would leave too little data. Timestamps of
 * the kept frames are rebased to start at 0.
 */
export function trimIdleFrames<T extends { timestamp: number; pose: Pose }>(
  frames: T[],
  mode: TrackingMode
): T[] {
  if (frames.length < 20) return frames;

  // Movement energy per frame: mean displacement of confidently-seen keypoints.
  const energy: number[] = [0];
  for (let i = 1; i < frames.length; i++) {
    const prev = new Map(
      frames[i - 1].pose.keypoints
        .filter((k) => k.name && (k.score ?? 0) > 0.5)
        .map((k) => [k.name as string, k])
    );
    let sum = 0;
    let n = 0;
    for (const kp of frames[i].pose.keypoints) {
      if (!kp.name || (kp.score ?? 0) <= 0.5) continue;
      const p = prev.get(kp.name);
      if (!p) continue;
      sum += Math.hypot(kp.x - p.x, kp.y - p.y);
      n++;
    }
    energy.push(n > 0 ? sum / n : 0);
  }

  const smoothed = smoothSeries(energy, 5);
  const thr = TRIM_ENERGY_PX[mode];
  const first = smoothed.findIndex((e) => e > thr);
  if (first === -1) return frames; // static hold — nothing to trim
  let last = smoothed.length - 1;
  while (last > first && smoothed[last] <= thr) last--;

  const startTs = frames[first].timestamp - TRIM_MARGIN_MS;
  const endTs = frames[last].timestamp + TRIM_MARGIN_MS;
  const kept = frames.filter((f) => f.timestamp >= startTs && f.timestamp <= endTs);
  if (kept.length < 10 || kept.length === frames.length) return frames;

  const base = kept[0].timestamp;
  return kept.map((f) => ({ ...f, timestamp: f.timestamp - base }));
}

// ---- Storage compaction ----

// Frames kept per stored demo. Capture runs at ~30 fps and can hand back 600
// frames per demo, but nothing downstream reads that density: buildGuideFrames
// resamples to 32 poses, trajectory DTW resamples to 64 time points, and
// derivation works off percentiles over the whole series. Storing the raw
// capture put multiple megabytes into exercises.recorded_paths — which every
// patient session downloads on a phone before the model even loads.
export const MAX_STORED_FRAMES = 120;

const round = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

/** Strip a pose down to what storage actually needs. */
function compactPose(pose: Pose, keepWorld: boolean): Pose {
  const compactKeypoints = (keypoints: Keypoint[]): Keypoint[] =>
    keypoints.map((kp) => {
      // Canonical units, frame height 480 — a tenth of a unit is far below
      // pose-estimation jitter, and keeps small hand segments accurate.
      const out: Keypoint = { x: round(kp.x, 1), y: round(kp.y, 1) };
      if (kp.name !== undefined) out.name = kp.name;
      // Preserved rather than defaulted: getKeypoint treats a missing score as
      // 0 (invisible), so inventing one would change which frames validate.
      if (kp.score !== undefined) out.score = round(kp.score, 2);
      // Metric metres over a hand ~0.2 m across — 0.1 mm resolution.
      if (keepWorld && kp.world) {
        out.world = {
          x: round(kp.world.x, 4),
          y: round(kp.world.y, 4),
          z: round(kp.world.z, 4),
        };
      }
      return out;
    });

  const out: Pose = { keypoints: compactKeypoints(pose.keypoints) };
  if (pose.score !== undefined) out.score = round(pose.score, 2);
  if (pose.extraHands?.length) {
    out.extraHands = pose.extraHands.map((h) => {
      const hand: { keypoints: Keypoint[]; score?: number } = {
        keypoints: compactKeypoints(h.keypoints),
      };
      if (h.score !== undefined) hand.score = round(h.score, 2);
      return hand;
    });
  }
  return out;
}

/**
 * Shrink a recorded demo to what is worth persisting: at most
 * MAX_STORED_FRAMES evenly spaced frames (first and last always kept, so the
 * rest pose and the movement extreme survive), coordinates rounded, and world
 * coordinates dropped for body recordings — body criteria are derived and
 * validated in 2D (deriveCriteriaFromRecordings only reaches for '3d' in hand
 * mode), so those triples were pure payload.
 *
 * Run this AFTER trimIdleFrames, which needs the full-rate series to measure
 * per-frame movement energy.
 */
export function compactRecordedFrames<T extends { timestamp: number; pose: Pose }>(
  frames: T[],
  mode: TrackingMode
): T[] {
  const keepWorld = mode === 'hand';

  let kept: T[] = frames;
  if (frames.length > MAX_STORED_FRAMES) {
    const step = (frames.length - 1) / (MAX_STORED_FRAMES - 1);
    kept = Array.from({ length: MAX_STORED_FRAMES }, (_, i) => frames[Math.round(i * step)]);
  }

  return kept.map((f) => ({ ...f, pose: compactPose(f.pose, keepWorld) }));
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
 *
 * Superseded by RomCycleRepCounter and no longer wired to anything — both the
 * patient session and the editor's test mode go through createRepCounter.
 * Kept only so the behaviour stays available (and tested) for comparison.
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

/**
 * ROM-hysteresis rep counter for dynamic exercises. Where CycleRepCounter needs
 * the patient to land inside a tight angle band at the extreme — which a
 * saturating 2D angle, sensor jitter, or a patient with reduced range can miss
 * entirely — this counts by how far the primary joint travels along its
 * rest→target range (analysis.progress). A rep fires once the movement passes
 * `enterHigh` of the range and then returns below `exitLow`; the wide gap
 * between the two is a hysteresis band that keeps a single noisy frame from
 * flip-flopping the phase. Reaching the top is what counts a rep — an optional
 * top hold is tracked only to drive coaching (holdEarned) and the hold bar, so
 * a smooth continuous arc still counts without a deliberate pause.
 *
 * Consumes analysis.progress and is a no-op on frames where the primary joint
 * isn't measurable (progress undefined), holding the current phase.
 */
export class RomCycleRepCounter {
  private phase: CyclePhase = 'rest';
  private reachedTop = false;
  private holdStart = 0;
  private lastAboveAt = 0;
  private holdSatisfied = false;
  private repCount = 0;
  private lastRepTime = 0;
  private readonly minRepInterval = 1000; // ms cooldown between reps
  // A brief dip below the top threshold (jitter) shouldn't end the top phase;
  // only treat the top as left after it stays below for this long.
  private readonly exitGraceMs = 300;
  private holdThreshold: number;
  private readonly enterHigh: number;
  private readonly exitLow: number;

  constructor(holdThresholdMs = 500, enterHigh = 0.6, exitLow = 0.25) {
    this.holdThreshold = holdThresholdMs;
    this.enterHigh = enterHigh;
    this.exitLow = exitLow;
  }

  private holdProgressNow(now: number): number {
    return this.holdSatisfied
      ? 1
      : this.phase === 'holding'
        ? Math.min(1, (now - this.holdStart) / this.holdThreshold)
        : 0;
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
    const p = analysis.progress;
    let justCompleted = false;

    // No reading this frame (primary joint hidden) — keep the current phase.
    if (typeof p !== 'number') {
      return {
        repCount: this.repCount,
        justCompleted,
        holdProgress: this.holdProgressNow(now),
        holdMissed: false,
        holdEarned: this.holdSatisfied,
        phase: this.phase,
      };
    }

    const atTop = p >= this.enterHigh;
    const atRest = p <= this.exitLow;

    const completeIfReached = () => {
      if (this.reachedTop && now - this.lastRepTime >= this.minRepInterval) {
        this.repCount++;
        justCompleted = true;
        this.lastRepTime = now;
      }
      this.reachedTop = false;
      this.holdSatisfied = false;
    };

    const enterTop = () => {
      this.phase = 'holding';
      this.reachedTop = true;
      this.holdStart = now;
      this.lastAboveAt = now;
      this.holdSatisfied = false;
    };

    switch (this.phase) {
      case 'rest':
        if (atTop) enterTop();
        else if (!atRest) this.phase = 'lifting';
        break;

      case 'lifting':
        if (atTop) enterTop();
        else if (atRest) this.phase = 'rest'; // sank back without reaching the top
        break;

      case 'holding':
        if (atTop) {
          this.lastAboveAt = now;
          if (now - this.holdStart >= this.holdThreshold) this.holdSatisfied = true;
        } else if (now - this.lastAboveAt >= this.exitGraceMs) {
          // Really left the top (past the jitter grace window)
          if (atRest) {
            completeIfReached();
            this.phase = 'rest';
          } else {
            this.phase = 'lowering';
          }
        }
        break;

      case 'lowering':
        if (atTop) enterTop(); // came back up — resume the top (rep not yet counted)
        else if (atRest) {
          completeIfReached();
          this.phase = 'rest';
        }
        break;
    }

    return {
      repCount: this.repCount,
      justCompleted,
      holdProgress: this.holdProgressNow(now),
      // Top holds are optional in ROM mode, so a missed hold is never a failure.
      holdMissed: false,
      holdEarned: this.holdSatisfied,
      phase: this.phase,
    };
  }

  reset() {
    this.phase = 'rest';
    this.reachedTop = false;
    this.holdStart = 0;
    this.lastAboveAt = 0;
    this.holdSatisfied = false;
    this.repCount = 0;
    this.lastRepTime = 0;
  }

  getCount() {
    return this.repCount;
  }
}

// ---- Rep-counter selection (one decision, two call sites) ----

/** Any counter createRepCounter can hand back. `phase` is present only on the
 * cyclic one, so callers narrow with `'phase' in result`. */
export type RepCounter = GenericRepCounter | RomCycleRepCounter;

/**
 * True when reps should be counted as full movement cycles: a dynamic exercise
 * whose criteria define a rest pose, which is what makes analysis.progress
 * measurable. Everything else (static holds, dynamic exercises with no rest
 * angle) counts holds instead.
 */
export function isCyclicExercise(
  exerciseType: string | null | undefined,
  poseCriteria: PoseCriteria | null | undefined
): boolean {
  return (
    exerciseType === 'dynamic' &&
    (poseCriteria?.criteria ?? []).some((c) => typeof c.restAngle === 'number')
  );
}

/**
 * Build the rep counter for an exercise. The patient session and the editor's
 * test mode both go through here — they used to construct counters separately
 * and drifted apart (the editor demanded a landing inside the tight angle band
 * while the session fired on ROM travel), so tuning in the editor predicted
 * nothing about a real session.
 */
export function createRepCounter(
  exerciseType: string | null | undefined,
  poseCriteria: PoseCriteria | null | undefined,
  holdThresholdMs = 500
): RepCounter {
  return isCyclicExercise(exerciseType, poseCriteria)
    ? new RomCycleRepCounter(holdThresholdMs)
    : new GenericRepCounter(holdThresholdMs);
}
