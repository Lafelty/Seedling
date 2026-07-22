// Environment-agnostic detection engine. This module runs identically inside
// the detection Web Worker (the normal path — inference off the UI thread) and
// on the main thread (fallback for browsers without worker/ImageBitmap
// support). It must therefore never touch window/document: frames arrive as
// ImageBitmap (worker) or HTMLVideoElement (main-thread fallback), and
// timestamps are supplied by the caller.

/** Which landmark model an exercise is tracked with. */
export type TrackingMode = 'body' | 'hand';

/** A video frame in whichever form the current environment can produce. */
export type FrameSource = HTMLVideoElement | ImageBitmap;

export interface Keypoint {
  x: number;
  y: number;
  score?: number;
  name?: string;
  // Metric 3D coordinates (meters, origin at the hand/body center) when the
  // model provides them — MediaPipe hand world landmarks. Angles measured in
  // this space don't change when the patient rotates relative to the camera.
  world?: { x: number; y: number; z: number };
}

export interface Pose {
  keypoints: Keypoint[];
  score?: number;
  // Hand mode only: any additional detected hands beyond the primary one.
  // Validation checks these too — a two-hand exercise must pass on every
  // detected hand — and overlays draw them. Criteria derivation still works
  // off the primary `keypoints` only.
  extraHands?: Array<{
    keypoints: Keypoint[];
    score?: number;
  }>;
}

/** The 21 landmarks in canonical MediaPipe order. */
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

// Body tracking uses MediaPipe Tasks PoseLandmarker (self-hosted wasm + model
// in /public/mediapipe), replacing the old MoveNet/tfjs detector. PoseLandmarker
// returns metric world landmarks, so body angles can be measured in 3D — they no
// longer swing when the patient stands closer/further or rotates relative to the
// camera, which is what made 2D screen-angle body criteria unreliable.
let poseLandmarker: import('@mediapipe/tasks-vision').PoseLandmarker | null = null;
// Hand tracking uses MediaPipe Tasks HandLandmarker (self-hosted wasm + model in
// /public/mediapipe) — the old tfjs-runtime MediaPipeHands 'lite' model guessed
// badly under self-occlusion (fists) and re-detected the palm every frame with
// no temporal tracking, which is why fist/release tracking looked broken.
let handLandmarker: import('@mediapipe/tasks-vision').HandLandmarker | null = null;
// Light exponential smoothing over hand landmarks. Derived tolerance bands come
// from smoothed recordings, so raw per-frame jitter during a live test overshoots
// them — smoothing the live stream the same way keeps the two comparable (and
// steadies the overlay). One slot per detected hand, reset when the hand
// teleports (identity swap / re-entry) or drops out.
let smoothedHands: Array<
  Array<{ x: number; y: number; world?: { x: number; y: number; z: number } }>
> = [];
const SMOOTH_ALPHA = 0.55; // share of the new frame kept; ~1 frame of lag at 25 fps

// Generation counters, bumped on every dispose. Model loads take seconds; a
// dispose (mode switch, unmount, HMR) can land while createDetector is still
// in flight, and without this check the late resolver would assign a zombie
// detector next to the other mode's model.
let poseGen = 0;
let handGen = 0;

// The detect loops run per-frame while models load — warn once, not 200×.
let warnedPoseNotReady = false;
let warnedHandNotReady = false;

// detectForVideo hard-throws if a timestamp is not strictly greater than the
// previous one. Callers switch clocks (live preview vs uploaded-video media
// time), so clamp here as a last line of defense instead of crashing detection.
let lastHandTimestampMs = 0;
// PoseLandmarker.detectForVideo has the same strictly-increasing-timestamp
// requirement; clamp for the same clock-switch reason.
let lastPoseTimestampMs = 0;

function frameSize(source: FrameSource): { w: number; h: number } {
  if ('videoWidth' in source) {
    return { w: source.videoWidth, h: source.videoHeight };
  }
  return { w: source.width, h: source.height };
}

// MediaPipe emits 33 BlazePose landmarks; the whole downstream engine speaks the
// 17 MoveNet/COCO names (VALID_KEYPOINT_NAMES, in this order). Mapping the subset
// we use keeps references, connections, criteria, and overlays working unchanged
// while the body gains world coordinates.
const BLAZE_TO_COCO: ReadonlyArray<readonly [number, string]> = [
  [0, 'nose'],
  [2, 'left_eye'],
  [5, 'right_eye'],
  [7, 'left_ear'],
  [8, 'right_ear'],
  [11, 'left_shoulder'],
  [12, 'right_shoulder'],
  [13, 'left_elbow'],
  [14, 'right_elbow'],
  [15, 'left_wrist'],
  [16, 'right_wrist'],
  [23, 'left_hip'],
  [24, 'right_hip'],
  [25, 'left_knee'],
  [26, 'right_knee'],
  [27, 'left_ankle'],
  [28, 'right_ankle'],
];

/**
 * Initialize the MediaPipe Tasks PoseLandmarker. Wasm and the model are
 * self-hosted under /public/mediapipe — no CDN at runtime. VIDEO running mode
 * tracks the body between frames (steadier than per-frame re-detection) and,
 * unlike MoveNet, exposes metric world landmarks for rotation-invariant angles.
 */
async function initPoseCore(): Promise<boolean> {
  try {
    if (poseLandmarker) return true;
    const gen = poseGen;

    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

    const createWith = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/pose_landmarker_full.task',
          delegate,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });

    let created: import('@mediapipe/tasks-vision').PoseLandmarker;
    try {
      created = await createWith('GPU');
    } catch {
      // Some machines/browsers can't create the GPU delegate — CPU still runs
      // the full model in real time.
      console.warn('GPU delegate unavailable for pose landmarker, falling back to CPU');
      created = await createWith('CPU');
    }

    if (gen !== poseGen) {
      // Disposed while loading (mode switch / unmount) — don't resurrect.
      created.close();
      return false;
    }
    if (poseLandmarker) {
      // A concurrent init already won (StrictMode double-mount).
      created.close();
      return true;
    }
    poseLandmarker = created;
    warnedPoseNotReady = false;
    console.log('Pose landmarker initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize pose detector:', error);
    return false;
  }
}

/**
 * Detect a body pose, normalized into the same 17-keypoint Pose shape MoveNet
 * produced so the whole downstream engine works unchanged — now with metric
 * `world` coordinates attached. `timestampMs` must be monotonically increasing;
 * it feeds the internal tracker that carries the body across frames.
 */
async function detectPoseCore(source: FrameSource, timestampMs: number): Promise<Pose | null> {
  if (!poseLandmarker) {
    if (!warnedPoseNotReady) {
      console.warn('Pose detector not initialized yet — frames skipped until the model loads');
      warnedPoseNotReady = true;
    }
    return null;
  }

  try {
    const { w, h } = frameSize(source);
    if (!w || !h) return null;

    const ts = timestampMs > lastPoseTimestampMs ? timestampMs : lastPoseTimestampMs + 1;
    lastPoseTimestampMs = ts;
    const result = poseLandmarker.detectForVideo(source, ts);
    const landmarks = result.landmarks?.[0];
    if (!landmarks) return null;
    const world = result.worldLandmarks?.[0];

    const keypoints: Keypoint[] = BLAZE_TO_COCO.map(([idx, name]) => {
      const lm = landmarks[idx];
      const wl = world?.[idx];
      return {
        x: lm.x * w,
        y: lm.y * h,
        // BlazePose exposes visibility ∈ [0,1]; getKeypoint gates on it exactly
        // like MoveNet's per-keypoint score did.
        score: lm.visibility ?? 1,
        name,
        // Metric 3D — lets validation measure rotation-invariant body angles.
        world: wl ? { x: wl.x, y: wl.y, z: wl.z } : undefined,
      };
    });
    return { keypoints, score: 1 };
  } catch (error) {
    console.error('Pose detection error:', error);
    return null;
  }
}

function disposePoseCore() {
  poseGen++; // invalidate any createFromOptions still in flight
  lastPoseTimestampMs = 0;
  if (poseLandmarker) {
    poseLandmarker.close();
    poseLandmarker = null;
  }
}

/**
 * Initialize the MediaPipe Tasks HandLandmarker. Wasm and the full-accuracy
 * model are self-hosted under /public/mediapipe — no CDN at runtime. VIDEO
 * running mode tracks landmarks between frames instead of re-detecting the
 * palm each frame, which is what keeps a closing fist stable.
 */
async function initHandCore(): Promise<boolean> {
  try {
    if (handLandmarker) return true;
    const gen = handGen;

    console.log('Loading hand landmarker (~8 MB model on first use)…');
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

    const createWith = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/hand_landmarker.task',
          delegate,
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    let created: import('@mediapipe/tasks-vision').HandLandmarker;
    try {
      created = await createWith('GPU');
    } catch {
      // Some machines/browsers can't create the GPU delegate — CPU still runs
      // the full model in real time.
      console.warn('GPU delegate unavailable for hand landmarker, falling back to CPU');
      created = await createWith('CPU');
    }

    if (gen !== handGen) {
      // Disposed while loading (mode switch / unmount) — don't resurrect.
      created.close();
      return false;
    }
    if (handLandmarker) {
      // A concurrent init already won (StrictMode double-mount).
      created.close();
      return true;
    }
    handLandmarker = created;
    warnedHandNotReady = false;
    console.log('Hand landmarker initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize hand detector:', error);
    return false;
  }
}

/**
 * Detect hands in a frame, normalized into the same Pose shape MoveNet
 * produces so the whole downstream engine works unchanged. `timestampMs` must
 * be monotonically increasing — it feeds the internal landmark tracker that
 * carries hands across frames.
 */
async function detectHandCore(source: FrameSource, timestampMs: number): Promise<Pose | null> {
  if (!handLandmarker) {
    if (!warnedHandNotReady) {
      console.warn('Hand detector not initialized yet — frames skipped until the model loads');
      warnedHandNotReady = true;
    }
    return null;
  }

  try {
    const { w, h } = frameSize(source);
    if (!w || !h) return null;

    const ts = timestampMs > lastHandTimestampMs ? timestampMs : lastHandTimestampMs + 1;
    lastHandTimestampMs = ts;
    const result = handLandmarker.detectForVideo(source, ts);
    if (!result.landmarks || result.landmarks.length === 0) {
      smoothedHands = []; // hand lost — don't smooth across the gap
      return null;
    }

    // Landmarks come back normalized [0..1] in canonical MediaPipe order, which
    // HAND_KEYPOINT_NAMES mirrors — scale to pixels and attach names so the
    // overlay and the angle engine see the exact shape they always have.
    const sets = result.landmarks.map((landmarks, i) => {
      // Handedness classification confidence is the closest thing the task
      // returns to a per-hand score; landmarks carry no per-point score, and
      // getKeypoint rejects anything under 0.5, so copy it onto each point.
      const s = result.handedness?.[i]?.[0]?.score ?? 1;
      const world = result.worldLandmarks?.[i];
      return {
        keypoints: landmarks.map((lm, j) => ({
          x: lm.x * w,
          y: lm.y * h,
          name: HAND_KEYPOINT_NAMES[j],
          score: s,
          // Metric 3D — lets validation measure rotation-invariant angles.
          world: world?.[j]
            ? { x: world[j].x, y: world[j].y, z: world[j].z }
            : undefined,
        })),
        score: s,
      };
    });

    // Order hands left-to-right in the frame (wrist x). Confidence flaps
    // between hands frame to frame, which would swap which hand is "primary"
    // mid-rep and feed the trajectory sampler alternating hands; screen
    // position is stable. Validation checks every set, so primary choice only
    // matters for derivation and trajectory sampling.
    sets.sort((a, b) => a.keypoints[0].x - b.keypoints[0].x);

    // EMA-smooth each hand slot; a big wrist jump means the slot changed hands,
    // so restart that filter instead of dragging points across the screen.
    const jumpLimit = Math.hypot(w, h) * 0.2;
    sets.forEach((set, i) => {
      const prev = smoothedHands[i];
      const wrist = set.keypoints[0];
      if (!prev || Math.hypot(wrist.x - prev[0].x, wrist.y - prev[0].y) > jumpLimit) {
        smoothedHands[i] = set.keypoints.map((kp) => ({
          x: kp.x,
          y: kp.y,
          world: kp.world ? { ...kp.world } : undefined,
        }));
        return;
      }
      set.keypoints.forEach((kp, j) => {
        const p = prev[j];
        kp.x = p.x + (kp.x - p.x) * SMOOTH_ALPHA;
        kp.y = p.y + (kp.y - p.y) * SMOOTH_ALPHA;
        p.x = kp.x;
        p.y = kp.y;
        // Smooth world coords the same way so 3D angles are as steady as 2D ones.
        if (kp.world && p.world) {
          kp.world.x = p.world.x + (kp.world.x - p.world.x) * SMOOTH_ALPHA;
          kp.world.y = p.world.y + (kp.world.y - p.world.y) * SMOOTH_ALPHA;
          kp.world.z = p.world.z + (kp.world.z - p.world.z) * SMOOTH_ALPHA;
          p.world = { ...kp.world };
        } else {
          p.world = kp.world ? { ...kp.world } : undefined;
        }
      });
    });
    if (smoothedHands.length > sets.length) smoothedHands.length = sets.length;

    const [primary, ...rest] = sets;
    return { ...primary, extraHands: rest.length > 0 ? rest : undefined };
  } catch (error) {
    console.error('Hand detection error:', error);
    return null;
  }
}

function disposeHandCore() {
  handGen++; // invalidate any createFromOptions still in flight
  smoothedHands = [];
  lastHandTimestampMs = 0;
  if (handLandmarker) {
    handLandmarker.close();
    handLandmarker = null;
  }
}

// ---- Engine facade ----

// Blank frame for warm-up inference. Works in both homes of this module:
// OffscreenCanvas in the worker, a document canvas on the main thread.
async function makeBlankFrame(): Promise<ImageBitmap | null> {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(640, 480);
      c.getContext('2d')?.fillRect(0, 0, 1, 1);
      return await createImageBitmap(c);
    }
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      c.getContext('2d')?.fillRect(0, 0, 1, 1);
      return await createImageBitmap(c);
    }
  } catch {
    // No canvas support — skip warm-up, first real frame pays the cost.
  }
  return null;
}

// The first inference after model creation compiles WebGL shaders / GPU
// delegate programs — seconds on some machines. Run it on a blank frame during
// init so "model ready" means ready-to-answer-now: the overlay skeleton appears
// immediately and video processing never stalls on a cold first frame.
async function warmupCore(mode: TrackingMode): Promise<void> {
  const frame = await makeBlankFrame();
  if (!frame) return;
  try {
    await detectCore(frame, mode, performance.now());
  } catch {
    // Best-effort — a failed warm-up just means the first real frame is slow.
  } finally {
    frame.close();
  }
}

/** Init the detector for a mode, disposing the other model first (one model resident at a time). */
export async function initCore(mode: TrackingMode): Promise<boolean> {
  let ok: boolean;
  if (mode === 'hand') {
    disposePoseCore();
    ok = await initHandCore();
  } else {
    disposeHandCore();
    ok = await initPoseCore();
  }
  if (ok) await warmupCore(mode);
  return ok;
}

export async function detectCore(
  source: FrameSource,
  mode: TrackingMode,
  timestampMs: number
): Promise<Pose | null> {
  return mode === 'hand' ? detectHandCore(source, timestampMs) : detectPoseCore(source, timestampMs);
}

export function disposeCore() {
  disposePoseCore();
  disposeHandCore();
}
