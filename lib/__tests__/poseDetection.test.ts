import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateAngle,
  measureAngle,
  smoothSeries,
  subjectInFrame,
  analyzeExercise,
  deriveCriteriaFromRecordings,
  trimIdleFrames,
  GenericRepCounter,
  CycleRepCounter,
  RomCycleRepCounter,
  type Keypoint,
  type Pose,
  type PoseCriteria,
  type ExerciseAnalysis,
} from '../poseDetection';

// ---- helpers ----

function kp(name: string, x: number, y: number, score = 1, world?: Keypoint['world']): Keypoint {
  return { name, x, y, score, world };
}

/** A body pose whose left-elbow angle equals `deg`. Shoulder and elbow are
 * fixed; the wrist is placed on a circle around the elbow so the angle at the
 * elbow (shoulder–elbow–wrist) is exactly `deg`. */
function elbowPose(deg: number, score = 1): Pose {
  const r = (deg * Math.PI) / 180;
  return {
    keypoints: [
      kp('left_shoulder', 0, 0, score),
      kp('left_elbow', 0, 100, score),
      kp('left_wrist', 100 * Math.sin(r), 100 - 100 * Math.cos(r), score),
    ],
  };
}

const ELBOW_CRITERIA: PoseCriteria = {
  targetBodyParts: ['left_shoulder', 'left_elbow', 'left_wrist'],
  criteria: [
    {
      joint: 'left_elbow',
      minAngle: 80,
      maxAngle: 100,
      targetAngle: 90,
      restAngle: 180,
      relativeTo: ['left_shoulder', 'left_wrist'],
    },
  ],
  levelingRules: [],
};

// ---- calculateAngle ----

describe('calculateAngle', () => {
  it('measures a right angle at the vertex', () => {
    expect(calculateAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
  });

  it('measures a straight line as 180', () => {
    expect(calculateAngle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180);
  });

  it('measures collinear same-side points as 0', () => {
    expect(calculateAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(0);
  });

  it('never exceeds 180 (reflex angles fold back)', () => {
    const a = calculateAngle({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: -1, y: 1 });
    expect(a).toBeLessThanOrEqual(180);
  });
});

// ---- measureAngle (2d vs 3d) ----

describe('measureAngle', () => {
  it('falls back to 2d screen coordinates by default', () => {
    const a = kp('a', 1, 0);
    const j = kp('j', 0, 0);
    const c = kp('c', 0, 1);
    expect(measureAngle(a, j, c)).toBeCloseTo(90);
  });

  it('uses world coordinates in 3d space, ignoring screen x/y', () => {
    // All three share the same screen position, so a 2d read would be ~0.
    // Their world vectors are orthogonal → a 3d read must be 90.
    const a = kp('a', 5, 5, 1, { x: 1, y: 0, z: 0 });
    const j = kp('j', 5, 5, 1, { x: 0, y: 0, z: 0 });
    const c = kp('c', 5, 5, 1, { x: 0, y: 1, z: 0 });
    expect(measureAngle(a, j, c, '3d')).toBeCloseTo(90);
    expect(measureAngle(a, j, c, '2d')).toBeCloseTo(0);
  });

  it('falls back to 2d when world coords are missing on any point', () => {
    const a = kp('a', 1, 0, 1, { x: 1, y: 0, z: 0 });
    const j = kp('j', 0, 0, 1, { x: 0, y: 0, z: 0 });
    const c = kp('c', 0, 1); // no world
    expect(measureAngle(a, j, c, '3d')).toBeCloseTo(90);
  });
});

// ---- smoothSeries ----

describe('smoothSeries', () => {
  it('returns a copy (not the same ref) when shorter than the window', () => {
    const input = [1, 2, 3];
    const out = smoothSeries(input, 5);
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(input);
  });

  it('centered moving average with clamped edges', () => {
    expect(smoothSeries([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1.5, 2, 3, 4, 5, 6, 6.5]);
  });

  it('leaves a constant series unchanged', () => {
    expect(smoothSeries([4, 4, 4, 4, 4, 4], 3)).toEqual([4, 4, 4, 4, 4, 4]);
  });
});

// ---- subjectInFrame ----

describe('subjectInFrame', () => {
  it('is true when both body anchors are confidently visible', () => {
    const pose: Pose = { keypoints: [kp('left_shoulder', 0, 0), kp('right_shoulder', 50, 0)] };
    expect(subjectInFrame(pose, 'body')).toBe(true);
  });

  it('is false when an anchor is below the confidence floor', () => {
    const pose: Pose = { keypoints: [kp('left_shoulder', 0, 0, 0.2), kp('right_shoulder', 50, 0)] };
    expect(subjectInFrame(pose, 'body')).toBe(false);
  });

  it('is false for a null pose', () => {
    expect(subjectInFrame(null, 'body')).toBe(false);
  });
});

// ---- analyzeExercise ----

describe('analyzeExercise', () => {
  it('passes when the joint angle sits inside the band', () => {
    const res = analyzeExercise(elbowPose(90), ELBOW_CRITERIA, null);
    expect(res.meetsAllCriteria).toBe(true);
    expect(res.feedback).toBe('good');
    expect(res.failedCriteria).toEqual([]);
  });

  it('fails and reports atRest when the joint is at the rest pose', () => {
    const res = analyzeExercise(elbowPose(180), ELBOW_CRITERIA, null);
    expect(res.meetsAllCriteria).toBe(false);
    expect(res.atRest).toBe(true);
    expect(res.feedback).toBe('adjust');
  });

  it('reports a visibility problem when target parts are not detected', () => {
    const res = analyzeExercise(elbowPose(90, 0.1), ELBOW_CRITERIA, null);
    expect(res.failedCriteria).toContain('visibility');
    expect(res.feedback).toBe('analyzing');
  });

  it('refuses to validate an exercise with no criteria', () => {
    const empty: PoseCriteria = { targetBodyParts: [], criteria: [], levelingRules: [] };
    const res = analyzeExercise(elbowPose(90), empty, null);
    expect(res.meetsAllCriteria).toBe(false);
    expect(res.failedCriteria).toContain('notConfigured');
  });

  it('requires EVERY detected hand to pass, not just the primary', () => {
    const good = elbowPose(90);
    const bad = elbowPose(180);
    const twoHands: Pose = { ...good, extraHands: [{ keypoints: bad.keypoints }] };
    expect(analyzeExercise(twoHands, ELBOW_CRITERIA, null).meetsAllCriteria).toBe(false);
  });

  it('honors custom feedback messages', () => {
    const res = analyzeExercise(elbowPose(90), ELBOW_CRITERIA, { perfect: 'Nice!' });
    expect(res.message).toBe('Nice!');
  });
});

// ---- deriveCriteriaFromRecordings ----

describe('deriveCriteriaFromRecordings', () => {
  it('derives a target near the movement extreme and rest near the start', () => {
    // A demo sweeping the elbow from ~30° (rest) to ~120° (target) over 30 frames.
    const frames = Array.from({ length: 30 }, (_, i) => {
      const deg = 30 + (90 * i) / 29;
      return { pose: elbowPose(deg) };
    });
    const criteria = deriveCriteriaFromRecordings([{ frames }], 'body');

    const elbow = criteria.criteria.find((c) => c.joint === 'left_elbow');
    expect(elbow).toBeDefined();
    expect(elbow!.targetAngle).toBeGreaterThan(105);
    expect(elbow!.restAngle!).toBeLessThan(45);
    expect(elbow!.relativeTo).toEqual(['left_shoulder', 'left_wrist']);
    expect(elbow!.minAngle).toBeLessThan(elbow!.maxAngle);
    expect(criteria.angleSpace).toBe('2d');
  });

  it('produces no criteria from an empty recording', () => {
    const criteria = deriveCriteriaFromRecordings([{ frames: [] }], 'body');
    expect(criteria.criteria).toEqual([]);
  });
});

// ---- trimIdleFrames ----

describe('trimIdleFrames', () => {
  function frameAt(t: number, x: number) {
    return { timestamp: t, pose: { keypoints: [kp('left_shoulder', x, 0)] } };
  }

  it('drops idle head/tail and rebases timestamps to 0', () => {
    // 0–14 idle, 15–24 moving, 25–39 idle again (40 frames @ 100ms).
    const frames = Array.from({ length: 40 }, (_, i) => {
      let x = 100;
      if (i >= 15 && i <= 24) x = 100 + (i - 14) * 20;
      else if (i > 24) x = 100 + 10 * 20;
      return frameAt(i * 100, x);
    });
    const trimmed = trimIdleFrames(frames, 'body');
    expect(trimmed.length).toBeLessThan(frames.length);
    expect(trimmed.length).toBeGreaterThanOrEqual(10);
    expect(trimmed[0].timestamp).toBe(0);
  });

  it('leaves a static hold (no motion) untouched', () => {
    const frames = Array.from({ length: 40 }, (_, i) => frameAt(i * 100, 100));
    expect(trimIdleFrames(frames, 'body')).toHaveLength(40);
  });

  it('leaves very short recordings untouched', () => {
    const frames = Array.from({ length: 5 }, (_, i) => frameAt(i * 100, i * 50));
    expect(trimIdleFrames(frames, 'body')).toHaveLength(5);
  });
});

// ---- rep counters (fake timers) ----

describe('GenericRepCounter', () => {
  afterEach(() => vi.useRealTimers());

  const good = { meetsAllCriteria: true, atRest: false, feedback: 'good' as const, message: '', failedCriteria: [] };
  const bad = { ...good, meetsAllCriteria: false, feedback: 'adjust' as const };

  it('counts a rep once the hold threshold is met', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const rc = new GenericRepCounter(500);

    expect(rc.count(good).repCount).toBe(0); // just entered
    vi.advanceTimersByTime(600);
    const r = rc.count(good);
    expect(r.repCount).toBe(1);
    expect(r.justCompleted).toBe(true);
    expect(r.holdEarned).toBe(true);
  });

  it('flags a missed hold when the position is left too early', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const rc = new GenericRepCounter(500);

    rc.count(good);
    vi.advanceTimersByTime(200);
    rc.count(good); // still holding, under threshold
    vi.advanceTimersByTime(400); // past the 300ms exit grace
    const r = rc.count(bad);
    expect(r.repCount).toBe(0);
    expect(r.holdMissed).toBe(true);
  });
});

describe('CycleRepCounter', () => {
  afterEach(() => vi.useRealTimers());

  const atTarget = { meetsAllCriteria: true, atRest: false, feedback: 'good' as const, message: '', failedCriteria: [] };
  const atRest = { ...atTarget, meetsAllCriteria: false, atRest: true, feedback: 'adjust' as const };
  const moving = { ...atTarget, meetsAllCriteria: false, atRest: false, feedback: 'adjust' as const };

  it('counts one rep for a full rest → target → hold → rest cycle', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const rc = new CycleRepCounter(500);

    rc.count(atRest);   // rest
    rc.count(moving);   // lifting
    rc.count(atTarget); // holding starts
    vi.advanceTimersByTime(600);
    rc.count(atTarget); // hold satisfied
    vi.advanceTimersByTime(400); // past exit grace
    const r = rc.count(atRest); // returned to rest → rep completes
    expect(r.repCount).toBe(1);
    expect(r.justCompleted).toBe(true);
    expect(r.phase).toBe('rest');
  });

  it('does not count a partial rep that never held the target', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const rc = new CycleRepCounter(500);

    rc.count(atRest);
    rc.count(moving);
    rc.count(atTarget); // reached target
    vi.advanceTimersByTime(100); // but only briefly
    vi.advanceTimersByTime(400); // past exit grace
    const r = rc.count(atRest); // dropped back before the hold
    expect(r.repCount).toBe(0);
  });
});

// ---- ROM hysteresis rep counter ----

describe('RomCycleRepCounter', () => {
  afterEach(() => vi.useRealTimers());

  // Analysis frames carrying only the primary-mover progress the counter reads.
  const prog = (p: number): ExerciseAnalysis => ({
    meetsAllCriteria: false,
    atRest: false,
    feedback: 'adjust',
    message: '',
    failedCriteria: [],
    progress: p,
  });
  // A frame where the primary joint isn't measurable (progress undefined).
  const noRead: ExerciseAnalysis = {
    meetsAllCriteria: false,
    atRest: false,
    feedback: 'analyzing',
    message: '',
    failedCriteria: [],
  };

  it('counts a continuous arc (top reached, no deliberate hold) on return to rest', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const rc = new RomCycleRepCounter(500);

    rc.count(prog(0.1)); // rest
    rc.count(prog(0.9)); // swept past enterHigh → top reached
    vi.advanceTimersByTime(400); // past the exit grace, never held 500ms
    const r = rc.count(prog(0.05)); // returned below exitLow
    expect(r.repCount).toBe(1);
    expect(r.justCompleted).toBe(true);
    expect(r.phase).toBe('rest');
  });

  it('does not count a partial movement that never reaches the top', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const rc = new RomCycleRepCounter(500);

    rc.count(prog(0.1)); // rest
    rc.count(prog(0.45)); // lifting, but below enterHigh (0.6)
    const r = rc.count(prog(0.05)); // sank back
    expect(r.repCount).toBe(0);
    expect(r.phase).toBe('rest');
  });

  it('earns the hold when the top is held past the threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const rc = new RomCycleRepCounter(500);

    rc.count(prog(0.1));
    rc.count(prog(0.9)); // top reached, hold starts
    vi.advanceTimersByTime(600);
    const held = rc.count(prog(0.9));
    expect(held.holdEarned).toBe(true);
    vi.advanceTimersByTime(400);
    const done = rc.count(prog(0.05));
    expect(done.repCount).toBe(1);
  });

  it('holds its phase on a frame with no reading (joint hidden)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const rc = new RomCycleRepCounter(500);

    rc.count(prog(0.1));
    rc.count(prog(0.9)); // holding
    const r = rc.count(noRead); // undefined progress → no-op
    expect(r.phase).toBe('holding');
    expect(r.repCount).toBe(0);
  });
});
