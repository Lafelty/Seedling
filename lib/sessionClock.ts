/** Counts active exercise time only. Pauses, countdowns and saving add no time. */
export class SessionClock {
  private elapsed = 0;
  private activeSince: number | null = null;

  start(now = performance.now()): void {
    this.activeSince ??= now;
  }

  pause(now = performance.now()): void {
    if (this.activeSince !== null) {
      this.elapsed += Math.max(0, now - this.activeSince);
      this.activeSince = null;
    }
  }

  seconds(now = performance.now()): number {
    const current = this.activeSince === null ? 0 : Math.max(0, now - this.activeSince);
    return Math.floor((this.elapsed + current) / 1000);
  }
}
