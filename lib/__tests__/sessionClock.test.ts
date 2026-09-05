import { describe, expect, it } from 'vitest';
import { SessionClock } from '../sessionClock';

describe('active session clock', () => {
  it('excludes countdowns, pauses and saving, retaining fractional active time', () => {
    const clock = new SessionClock();
    expect(clock.seconds(10000)).toBe(0);
    clock.start(10000);
    clock.pause(11500);
    expect(clock.seconds(60000)).toBe(1);
    clock.start(63000);
    clock.pause(64500);
    expect(clock.seconds(120000)).toBe(3);
  });

  it('tolerates repeated start and pause events', () => {
    const clock = new SessionClock();
    clock.start(0);
    clock.start(1500);
    expect(clock.seconds(2000)).toBe(2);
    clock.pause(3000);
    clock.pause(6000);
    expect(clock.seconds(9000)).toBe(3);
  });
});
