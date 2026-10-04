interface OutputClock {
  baseLatency?: number;
  outputLatency?: number;
  currentTime?: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
}
const valid = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

// Media 'ended' means decoding finished, while the output device may still
// have samples queued. Keep the graph connected long enough to play them.
export function playbackDrainMs(clock: OutputClock, nowMs = performance.now()) {
  let observed: number | undefined;
  try {
    const stamp = clock.getOutputTimestamp?.();
    if (
      stamp &&
      valid(clock.currentTime) &&
      valid(stamp.contextTime) &&
      valid(stamp.performanceTime) &&
      stamp.performanceTime > 0
    ) {
      const age = Math.max(0, (nowMs - stamp.performanceTime) / 1000);
      observed = Math.max(0, clock.currentTime - stamp.contextTime - age);
    }
  } catch {
    /* Older audio implementations can omit device timestamps. */
  }
  const base = valid(clock.baseLatency) ? clock.baseLatency : 0;
  const output = valid(clock.outputLatency)
    ? clock.outputLatency
    : observed === undefined
      ? 0.25
      : 0;
  // Include one small scheduling margin and bound inconsistent device reports.
  return Math.ceil(
    Math.min(2, Math.max(base + output, observed ?? 0) + 0.05) * 1000,
  );
}
