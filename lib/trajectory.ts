// Trajectory matching for dynamic exercises. The static band check in
// analyzeExercise answers "did the patient hit the extreme?"; this module
// answers "did the movement follow the demonstrated path?" by comparing the
// live angle-vs-time curve of each rep against the therapist's recorded demo
// curves with dynamic time warping. DTW aligns the two curves in time first,
// so a patient moving slower or faster than the demo isn't penalized — only
// deviating from the path is.

import {
  measureAngle,
  smoothSeries,
  type AngleSpace,
  type Pose,
  type PoseCriteria,
  type Keypoint,
} from './poseDetection';

/** Minimal shape of the stored demos this module needs. */
export interface DemoFrames {
  frames: Array<{ timestamp: number; pose: Pose }>;
}

interface ReferenceTrajectory {
  joint: string;
  relativeTo: [string, string];
  /** One resampled angle curve per usable demo — a rep is scored against its
   * best-matching demo, so natural variation between demos isn't punished. */
  curves: number[][];
}

export interface TrajectoryScore {
  /** 0–100: how closely the rep followed the demonstrated path. */
  score: number;
  /** Mean per-point angular deviation (degrees) after DTW alignment. */
  meanDeviationDeg: number;
  /** How many criterion joints the score is averaged over. */
  jointCount: number;
}

// Every curve (demo and live) is resampled onto this many uniformly-spaced
// time points before DTW, so distances are comparable across reps and demos.
const RESAMPLE_POINTS = 64;
// A rep needs at least this many detected frames to be scoreable.
const MIN_REP_SAMPLES = 8;
// A joint must be measurable in at least this share of a rep's frames.
const MIN_JOINT_COVERAGE = 0.5;
// Sakoe-Chiba band: DTW may warp at most this share of the curve length.
// Unlimited warping would let "hold still, then snap" align perfectly.
const DTW_WINDOW_RATIO = 0.2;
// Score mapping: deviations up to the deadzone are a perfect 100 (sensor
// jitter alone produces a few degrees); each degree beyond costs 3 points.
const DEV_DEADZONE_DEG = 5;
const DEV_COST_PER_DEG = 3;

function getKeypoint(pose: Pose | null, name: string, minConfidence = 0.5): Keypoint | null {
  if (!pose?.keypoints) return null;
  const kp = pose.keypoints.find((k) => k.name === name);
  if (!kp || (kp.score ?? 0) < minConfidence) return null;
  return kp;
}

/**
 * Resample a (t, v) series onto `n` uniformly spaced points across its time
 * span, linearly interpolating between samples. Frame rate varies (worker
 * latency, phone throttling), so index-based resampling would distort time.
 */
export function resampleByTime(points: Array<{ t: number; v: number }>, n: number): number[] {
  if (points.length === 0) return [];
  if (points.length === 1) return new Array(n).fill(points[0].v);

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = t1 - t0;
  if (span <= 0) return new Array(n).fill(points[0].v);

  const out: number[] = new Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + (span * i) / (n - 1);
    while (seg < points.length - 2 && points[seg + 1].t < t) seg++;
    const a = points[seg];
    const b = points[seg + 1];
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    out[i] = a.v + (b.v - a.v) * Math.min(1, Math.max(0, f));
  }
  return out;
}

/**
 * Dynamic time warping distance between two equal-domain angle curves, with a
 * Sakoe-Chiba band. Returns the mean per-step deviation in degrees along the
 * optimal alignment (total path cost normalized by the two curve lengths).
 */
export function dtwDistance(a: number[], b: number[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return Infinity;

  const window = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * DTW_WINDOW_RATIO));
  // Rolling two-row DP keeps memory at O(m).
  let prev = new Array<number>(m + 1).fill(Infinity);
  let curr = new Array<number>(m + 1).fill(Infinity);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    curr.fill(Infinity);
    const jStart = Math.max(1, i - window);
    const jEnd = Math.min(m, i + window);
    for (let j = jStart; j <= jEnd; j++) {
      const cost = Math.abs(a[i - 1] - b[j - 1]);
      curr[j] = cost + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m] / (n + m);
}

/**
 * Build per-joint reference curves from the therapist's recorded demos, one
 * curve per demo per criterion joint. Joints the demos never show reliably are
 * dropped. Returns [] when nothing is usable (e.g. static exercises recorded
 * before criteria existed).
 */
function buildReferenceTrajectories(
  demos: DemoFrames[],
  criteria: PoseCriteria
): ReferenceTrajectory[] {
  const space: AngleSpace = criteria.angleSpace === '3d' ? '3d' : '2d';
  const refs: ReferenceTrajectory[] = [];

  for (const criterion of criteria.criteria ?? []) {
    const curves: number[][] = [];
    for (const demo of demos) {
      if (!demo?.frames || demo.frames.length < MIN_REP_SAMPLES) continue;
      const points: Array<{ t: number; v: number }> = [];
      for (const frame of demo.frames) {
        const j = getKeypoint(frame.pose, criterion.joint);
        const a = getKeypoint(frame.pose, criterion.relativeTo[0]);
        const b = getKeypoint(frame.pose, criterion.relativeTo[1]);
        if (!j || !a || !b) continue;
        points.push({ t: frame.timestamp, v: measureAngle(a, j, b, space) });
      }
      if (points.length < MIN_REP_SAMPLES || points.length / demo.frames.length < MIN_JOINT_COVERAGE) {
        continue;
      }
      const smoothed = smoothSeries(points.map((p) => p.v));
      curves.push(
        resampleByTime(
          points.map((p, i) => ({ t: p.t, v: smoothed[i] })),
          RESAMPLE_POINTS
        )
      );
    }
    if (curves.length > 0) {
      refs.push({
        joint: criterion.joint,
        relativeTo: [...criterion.relativeTo] as [string, string],
        curves,
      });
    }
  }
  return refs;
}

/**
 * Collects the live angle curve during a session and scores each completed
 * rep against the demo curves. Wire-up: addSample() every detected frame,
 * markRepStart() when the movement leaves the rest pose, scoreRep() when the
 * rep counter fires.
 */
export class TrajectoryTracker {
  private samples: Array<{ t: number; angles: Array<number | null> }> = [];
  private repStartIndex = 0;
  // ~60s at 30fps — long enough for any rep, bounded so an idle session
  // doesn't grow the buffer forever.
  private static readonly MAX_SAMPLES = 1800;
  // Open the rep window a few frames before the detected rest-exit so the
  // start of the movement isn't clipped off the curve.
  private static readonly START_LOOKBACK = 3;

  constructor(
    private refs: ReferenceTrajectory[],
    private space: AngleSpace
  ) {}

  get enabled(): boolean {
    return this.refs.length > 0;
  }

  addSample(pose: Pose | null, timestampMs: number) {
    if (!pose || this.refs.length === 0) return;
    const angles = this.refs.map((r) => {
      const j = getKeypoint(pose, r.joint);
      const a = getKeypoint(pose, r.relativeTo[0]);
      const b = getKeypoint(pose, r.relativeTo[1]);
      return j && a && b ? measureAngle(a, j, b, this.space) : null;
    });
    this.samples.push({ t: timestampMs, angles });
    if (this.samples.length > TrajectoryTracker.MAX_SAMPLES) {
      const drop = this.samples.length - TrajectoryTracker.MAX_SAMPLES;
      this.samples.splice(0, drop);
      this.repStartIndex = Math.max(0, this.repStartIndex - drop);
    }
  }

  /** Call when the rep counter sees the movement leave the rest pose. */
  markRepStart() {
    this.repStartIndex = Math.max(0, this.samples.length - TrajectoryTracker.START_LOOKBACK);
  }

  /**
   * Score the rep spanning markRepStart()..now. Returns null when there isn't
   * enough clean data to judge — callers should fall back to their static
   * form score, not treat null as a bad rep.
   */
  scoreRep(): TrajectoryScore | null {
    const seg = this.samples.slice(this.repStartIndex);
    // The next rep starts fresh even if this one wasn't scoreable.
    this.repStartIndex = this.samples.length;
    if (seg.length < MIN_REP_SAMPLES) return null;

    let totalDeviation = 0;
    let jointCount = 0;
    for (let i = 0; i < this.refs.length; i++) {
      const points = seg
        .filter((s) => s.angles[i] !== null)
        .map((s) => ({ t: s.t, v: s.angles[i] as number }));
      if (points.length < MIN_REP_SAMPLES || points.length / seg.length < MIN_JOINT_COVERAGE) {
        continue;
      }
      const smoothed = smoothSeries(points.map((p) => p.v));
      const live = resampleByTime(
        points.map((p, j) => ({ t: p.t, v: smoothed[j] })),
        RESAMPLE_POINTS
      );
      // Best-matching demo wins — the therapist's own recordings vary too.
      const best = Math.min(...this.refs[i].curves.map((c) => dtwDistance(live, c)));
      totalDeviation += best;
      jointCount++;
    }
    if (jointCount === 0) return null;

    const meanDeviationDeg = totalDeviation / jointCount;
    const score = Math.round(
      Math.min(100, Math.max(0, 100 - Math.max(0, meanDeviationDeg - DEV_DEADZONE_DEG) * DEV_COST_PER_DEG))
    );
    return { score, meanDeviationDeg: Math.round(meanDeviationDeg * 10) / 10, jointCount };
  }

  reset() {
    this.samples = [];
    this.repStartIndex = 0;
  }
}

/**
 * Build a tracker for an exercise, or null when trajectory scoring can't work
 * for it (no demos, no criteria, or demos that never show the criterion
 * joints). Sessions treat null as "feature off" and keep the existing scoring.
 */
export function createTrajectoryTracker(
  demos: DemoFrames[] | null | undefined,
  criteria: PoseCriteria | null | undefined
): TrajectoryTracker | null {
  if (!demos?.length || !criteria?.criteria?.length) return null;
  const space: AngleSpace = criteria.angleSpace === '3d' ? '3d' : '2d';
  const refs = buildReferenceTrajectories(demos, criteria);
  return refs.length > 0 ? new TrajectoryTracker(refs, space) : null;
}
