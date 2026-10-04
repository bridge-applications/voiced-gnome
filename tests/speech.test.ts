import { describe, expect, it } from 'vitest';
import {
  MouthRelease,
  mouthPose,
  smoothLevel,
} from '../apps/client/src/gnome/speech';
import {
  ExpressionToolSchema,
  GestureToolSchema,
} from '@bridge-applications/voiced-gnome-types';

describe('audio-driven speech', () => {
  it('closes on silence and rejects invalid input levels', () => {
    expect(mouthPose(0, 'wide')).toBe('rest');
    expect(smoothLevel(0, NaN, 0.02)).toBe(0);
    expect(smoothLevel(0, -10, 0.02)).toBe(0);
  });
  it('uses hysteresis around quiet speech and wide mouth thresholds', () => {
    expect(mouthPose(0.05, 'rest')).toBe('rest');
    expect(mouthPose(0.05, 'mid')).toBe('mid');
    expect(mouthPose(0.3, 'wide')).toBe('wide');
    expect(mouthPose(0.3, 'mid')).toBe('mid');
  });
  it('smooths consistently at desktop and mobile frame rates', () => {
    let desktop = 0,
      mobile = 0;
    for (let index = 0; index < 60; index++)
      desktop = smoothLevel(desktop, 0.8, 1 / 60);
    for (let index = 0; index < 30; index++)
      mobile = smoothLevel(mobile, 0.8, 1 / 30);
    expect(desktop).toBeCloseTo(mobile, 8);
    expect(desktop).toBeCloseTo(0.8);
  });
  it('limits large frame gaps instead of jumping after a hidden tab', () => {
    expect(smoothLevel(0, 1, 30)).toEqual(smoothLevel(0, 1, 0.1));
  });
  it('allows only known character actions and rejects extra arguments', () => {
    expect(GestureToolSchema.safeParse({ gesture: 'wave' }).success).toBe(true);
    expect(
      GestureToolSchema.safeParse({ gesture: 'run_arbitrary_code' }).success,
    ).toBe(false);
    expect(
      GestureToolSchema.safeParse({ gesture: 'wave', script: 'bad' }).success,
    ).toBe(false);
    expect(
      ExpressionToolSchema.safeParse({ expression: 'surprised' }).success,
    ).toBe(true);
  });
});

describe('mouth release', () => {
  it.each([30, 60])('releases a sustained loud fallback at %i FPS', (fps) => {
    const release = new MouthRelease();
    let pose = 'rest' as ReturnType<typeof mouthPose>;
    let wideFrames = 0;
    for (let i = 0; i < fps * 2; i++) {
      pose = release.sample(mouthPose(0.6, pose), 0.6, 1 / fps);
      if (pose === 'wide') wideFrames++;
    }
    expect(wideFrames / fps).toBeLessThanOrEqual(0.22);
    expect(wideFrames / fps).toBeGreaterThan(0.16);
    expect(pose).toBe('mid');
  });
  it('closes a stale wide cue during silence and opens for the next syllable', () => {
    const release = new MouthRelease();
    expect(release.sample('wide', 0.7, 1 / 60)).toBe('wide');
    expect(release.sample('wide', 0, 1 / 60)).toBe('mid');
    for (let i = 0; i < 5; i++) release.sample('wide', 0, 1 / 60);
    expect(release.sample('wide', 0, 1 / 60)).toBe('rest');
    expect(release.sample('wide', 0.7, 1 / 60)).toBe('wide');
  });
  it('preserves consonants and rounded vowels and rearms after articulation', () => {
    const release = new MouthRelease();
    expect(release.sample('wide', 0.6, 0.3)).toBe('mid');
    for (const pose of ['pressed', 'fv', 'tongue', 'round', 'pucker'] as const)
      expect(release.sample(pose, 0.3, 1 / 60)).toBe(pose);
    expect(release.sample('wide', 0.6, 1 / 60)).toBe('wide');
    release.reset();
    expect(release.sample('wide', NaN, 0.1)).toBe('rest');
  });
});
