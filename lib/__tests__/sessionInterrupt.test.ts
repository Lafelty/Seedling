import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericRepCounter, RomCycleRepCounter, type ExerciseAnalysis } from '../poseDetection';

const frame = (progress?: number, good = false): ExerciseAnalysis => ({
  progress, meetsAllCriteria: good, atRest: progress === 0,
  feedback: progress === undefined && !good ? 'analyzing' : good ? 'good' : 'adjust',
  message: '', failedCriteria: [],
});

describe('interrupted exercise counting', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); });
  afterEach(() => vi.useRealTimers());

  it('does not credit time spent paused toward a hold', () => {
    const counter = new GenericRepCounter(500);
    counter.count(frame(undefined, true));
    vi.advanceTimersByTime(300);
    counter.interrupt();
    vi.advanceTimersByTime(30000);
    expect(counter.count(frame(undefined, true)).justCompleted).toBe(false);
    vi.advanceTimersByTime(500);
    expect(counter.count(frame(undefined, true)).repCount).toBe(1);
    counter.interrupt();
    expect(counter.getCount()).toBe(1);
  });

  it('discards an interrupted cycle but preserves completed repetitions', () => {
    const counter = new RomCycleRepCounter(500);
    counter.count(frame(0));
    counter.count(frame(0.9));
    vi.advanceTimersByTime(400);
    expect(counter.count(frame(0)).repCount).toBe(1);
    counter.count(frame(0.9));
    counter.interrupt();
    vi.advanceTimersByTime(30000);
    expect(counter.count(frame(0)).repCount).toBe(1);
    expect(counter.count(frame(0)).justCompleted).toBe(false);
  });

  it('does not bridge a cycle over lost tracking', () => {
    const counter = new RomCycleRepCounter(500);
    counter.count(frame(0.9));
    vi.advanceTimersByTime(100);
    expect(counter.count(frame()).holdProgress).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(counter.count(frame(0)).repCount).toBe(0);
    expect(counter.count(frame(0.9)).holdEarned).toBe(false);
  });
});
