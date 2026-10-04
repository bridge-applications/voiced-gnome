import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewPlayer } from '../apps/client/src/audio';
import { playbackDrainMs } from '../apps/client/src/playbackDrain';
class FakeAudio {
  static latest: FakeAudio;
  paused = false;
  src = '';
  onended: (() => void) | null = null;
  onerror = null;
  onplaying = null;
  ontimeupdate = null;
  constructor() {
    FakeAudio.latest = this;
  }
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn();
}
class FakeContext {
  static latest: FakeContext;
  baseLatency = 0.005;
  outputLatency = 0.215;
  destination = {};
  constructor() {
    FakeContext.latest = this;
  }
  close = vi.fn(async () => undefined);
  createAnalyser = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    getByteTimeDomainData: vi.fn(),
  });
  createMediaElementSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const player = (ended: () => void) => {
  vi.useFakeTimers();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ mouthCues: [] })),
  );
  return new PreviewPlayer({ file: '/introductions/archie.mp3' }, ended);
};
describe('recorded playback completion', () => {
  it('keeps the audio graph open while the final device samples are pending', () => {
    let clip: PreviewPlayer;
    const done = vi.fn(() => clip.dispose());
    clip = player(done);
    FakeAudio.latest.onended!();
    vi.advanceTimersByTime(219);
    expect(done).not.toHaveBeenCalled();
    expect(FakeContext.latest.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(51);
    expect(done).toHaveBeenCalledOnce();
    expect(FakeContext.latest.close).toHaveBeenCalledOnce();
  });
  it('still stops immediately and cancels a pending completion when the visitor stops or switches', () => {
    const done = vi.fn();
    const clip = player(done);
    FakeAudio.latest.onended!();
    clip.dispose();
    expect(FakeAudio.latest.pause).toHaveBeenCalledOnce();
    expect(FakeContext.latest.close).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(done).not.toHaveBeenCalled();
  });
  it('ignores repeated end events while draining', () => {
    const done = vi.fn();
    const clip = player(done);
    FakeAudio.latest.onended!();
    FakeAudio.latest.onended!();
    vi.runAllTimers();
    expect(done).toHaveBeenCalledOnce();
    clip.dispose();
  });
  it('uses the device timestamp when it reports a longer remaining tail', () => {
    const delay = playbackDrainMs(
      {
        baseLatency: 0.005,
        outputLatency: 0.02,
        currentTime: 10,
        getOutputTimestamp: () => ({
          contextTime: 9.6,
          performanceTime: 1000,
        }),
      },
      1100,
    );
    expect(delay).toBeGreaterThanOrEqual(350);
    expect(delay).toBeLessThanOrEqual(351);
  });
  it('has a safe fallback for missing or invalid latency reports', () => {
    expect(playbackDrainMs({})).toBe(300);
    expect(
      playbackDrainMs({
        baseLatency: NaN,
        outputLatency: Infinity,
        getOutputTimestamp: () => {
          throw Error('unavailable');
        },
      }),
    ).toBe(300);
    expect(playbackDrainMs({ outputLatency: 20 })).toBe(2000);
  });
});
