import { describe, expect, it } from 'vitest';
import { resampleByTime, dtwDistance, createTrajectoryTracker, type DemoFrames } from '../trajectory';
import type { Keypoint, Pose, PoseCriteria } from '../poseDetection';

// ---- helpers (shared shape with poseDetection tests) ----

function kp(name: string, x: number, y: number, score = 1): Keypoint {
  return { name, x, y, score };
}

/** Body pose whose left-elbow angle equals `deg`. */
function elbowPose(deg: number): Pose {
  const r = (deg * Math.PI) / 180;
  return {
    keypoints: [
      kp('left_shoulder', 0, 0),
      kp('left_elbow', 0, 100),
      kp('left_wrist', 100 * Math.sin(r), 100 - 100 * Math.cos(r)),
    ],
  };
}

const CRITERIA: PoseCriteria = {
  targetBodyParts: ['left_shoulder', 'left_elbow', 'left_wrist'],
  criteria: [
    { joint: 'left_elbow', minAngle: 100, maxAngle: 140, targetAngle: 120, restAngle: 30, relativeTo: ['left_shoulder', 'left_wrist'] },
  ],
  levelingRules: [],
  angleSpace: '2d',
};

/** One demo rep: elbow ramps 30° → 120° across `n` frames at `dt` ms. */
function rampDemo(n = 20, dt = 50, offset = 0): DemoFrames {
  return {
    frames: Array.from({ length: n }, (_, i) => ({
      timestamp: i * dt,
      pose: elbowPose(30 + offset + (90 * i) / (n - 1)),
    })),
  };
}

// ---- resampleByTime ----

describe('resampleByTime', () => {
  it('returns an empty array for no points', () => {
    expect(resampleByTime([], 8)).toEqual([]);
  });

  it('fills with the single value when only one point exists', () => {
    expect(resampleByTime([{ t: 0, v: 7 }], 4)).toEqual([7, 7, 7, 7]);
  });

  it('linearly interpolates a two-point ramp onto uniform samples', () => {
    const out = resampleByTime([{ t: 0, v: 0 }, { t: 10, v: 10 }], 11);
    expect(out[0]).toBeCloseTo(0);
    expect(out[5]).toBeCloseTo(5);
    expect(out[10]).toBeCloseTo(10);
  });

  it('resamples correctly across non-uniform time gaps', () => {
    // Value jumps 0→100 between t=0 and t=1, then flat to t=100.
    const out = resampleByTime([{ t: 0, v: 0 }, { t: 1, v: 100 }, { t: 100, v: 100 }], 3);
    expect(out[0]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(100); // last sample
  });
});

// ---- dtwDistance ----

describe('dtwDistance', () => {
  it('is zero for identical curves', () => {
    expect(dtwDistance([1, 2, 3, 4], [1, 2, 3, 4])).toBe(0);
  });

  it('is Infinity when either curve is empty', () => {
    expect(dtwDistance([], [1, 2, 3])).toBe(Infinity);
    expect(dtwDistance([1, 2, 3], [])).toBe(Infinity);
  });

  it('reflects a constant offset as mean per-step deviation', () => {
    // Diagonal alignment: cost 5 at each of 3 steps = 15, normalized by n+m=6.
    expect(dtwDistance([0, 0, 0], [5, 5, 5])).toBeCloseTo(2.5);
  });

  it('is time-shift tolerant (same path, different pace ⇒ near zero)', () => {
    const fast = [0, 30, 60, 90];
    const slow = [0, 0, 30, 60, 90, 90];
    expect(dtwDistance(fast, slow)).toBeLessThan(dtwDistance(fast, [90, 60, 30, 0]));
  });
});

// ---- createTrajectoryTracker + scoring ----

describe('createTrajectoryTracker', () => {
  it('returns null without demos', () => {
    expect(createTrajectoryTracker(null, CRITERIA)).toBeNull();
    expect(createTrajectoryTracker([], CRITERIA)).toBeNull();
  });

  it('returns null without criteria', () => {
    expect(createTrajectoryTracker([rampDemo()], null)).toBeNull();
  });

  it('builds an enabled tracker from a usable demo', () => {
    const tracker = createTrajectoryTracker([rampDemo()], CRITERIA);
    expect(tracker).not.toBeNull();
    expect(tracker!.enabled).toBe(true);
  });

  it('scores a rep that matches the demo path near 100', () => {
    const tracker = createTrajectoryTracker([rampDemo()], CRITERIA)!;
    tracker.markRepStart();
    for (const f of rampDemo().frames) tracker.addSample(f.pose, f.timestamp);
    const score = tracker.scoreRep();
    expect(score).not.toBeNull();
    expect(score!.score).toBeGreaterThanOrEqual(90);
  });

  it('penalizes a rep that deviates from the demo path', () => {
    const tracker = createTrajectoryTracker([rampDemo()], CRITERIA)!;
    tracker.markRepStart();
    // Same timing, but the whole curve is offset ~35° off the demonstrated path.
    for (const f of rampDemo(20, 50, 35).frames) tracker.addSample(f.pose, f.timestamp);
    const score = tracker.scoreRep();
    expect(score).not.toBeNull();
    expect(score!.score).toBeLessThan(90);
  });

  it('returns null when a rep has too few samples to judge', () => {
    const tracker = createTrajectoryTracker([rampDemo()], CRITERIA)!;
    tracker.markRepStart();
    tracker.addSample(elbowPose(40), 0);
    tracker.addSample(elbowPose(50), 50);
    expect(tracker.scoreRep()).toBeNull();
  });
});
