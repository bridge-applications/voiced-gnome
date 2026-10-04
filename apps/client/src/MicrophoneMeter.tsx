import { useEffect, useRef } from 'react';
import { smoothLevel } from './gnome/speech';

const BAR_WEIGHTS = [0.45, 0.75, 1, 0.75, 0.45];

export function MicrophoneMeter({
  getLevel,
  muted,
}: {
  getLevel: () => number;
  muted: boolean;
}) {
  const meter = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = meter.current;
    if (!host) return;
    const bars = [...host.querySelectorAll('i')];
    let frame = 0;
    let last = performance.now();
    let lastAccessibleUpdate = -Infinity;
    let level = 0;
    const draw = (now: number) => {
      // Sample the SDK-owned input, independent of the gnome's speaking mode.
      // Update this small meter directly at 30 FPS without rerendering the app.
      if (now - last >= 1000 / 30 || muted) {
        const dt = (now - last) / 1000;
        last = now;
        level = muted ? 0 : smoothLevel(level, getLevel() * 2.4, dt);
        bars.forEach((bar, i) => {
          bar.style.transform = `scaleY(${0.15 + level * BAR_WEIGHTS[i]! * 0.85})`;
        });
        if (now - lastAccessibleUpdate >= 200 || muted) {
          host.setAttribute('aria-valuenow', String(Math.round(level * 100)));
          host.setAttribute(
            'aria-valuetext',
            muted
              ? 'Microphone paused'
              : level > 0.08
                ? 'Input detected'
                : 'No input detected',
          );
          lastAccessibleUpdate = now;
        }
      }
      if (!muted) frame = requestAnimationFrame(draw);
    };
    // Muting flattens the bars immediately and stops sampling until unmuted.
    if (muted) draw(last);
    else frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [getLevel, muted]);

  return (
    <div className={`microphone-status${muted ? ' is-muted' : ''}`}>
      <div
        className="microphone-meter"
        ref={meter}
        role="meter"
        aria-label="Microphone input level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        aria-valuetext={muted ? 'Microphone paused' : 'No input detected'}
      >
        <span aria-hidden="true">
          {BAR_WEIGHTS.map((_, i) => (
            <i key={i} />
          ))}
        </span>
      </div>
      <span>{muted ? 'Microphone paused' : 'Your microphone'}</span>
    </div>
  );
}
