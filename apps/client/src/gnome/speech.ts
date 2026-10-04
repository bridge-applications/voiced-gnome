export const MOUTH_POSES = [
  'rest',
  'pressed',
  'teeth',
  'mid',
  'wide',
  'round',
  'pucker',
  'fv',
  'tongue',
] as const;
export type MouthPose = (typeof MOUTH_POSES)[number];
export const VISEME_POSES = {
  X: 'rest',
  A: 'pressed',
  B: 'teeth',
  C: 'mid',
  D: 'wide',
  E: 'round',
  F: 'pucker',
  G: 'fv',
  H: 'tongue',
} as const satisfies Record<string, MouthPose>;
export type Viseme = keyof typeof VISEME_POSES;
export interface MouthCue {
  start: number;
  end: number;
  value: Viseme;
}

export function parseMouthCues(value: unknown): MouthCue[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('mouthCues' in value) ||
    !Array.isArray(value.mouthCues)
  )
    return [];
  const cues: MouthCue[] = [];
  for (const item of value.mouthCues.slice(0, 10000)) {
    if (!item || typeof item !== 'object') return [];
    const { start, end, value: pose } = item;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > 600 ||
      typeof pose !== 'string' ||
      !Object.hasOwn(VISEME_POSES, pose) ||
      (cues.length && start < cues[cues.length - 1]!.end - 0.001)
    )
      return [];
    cues.push({ start, end, value: pose as Viseme });
  }
  return cues;
}

export function cueAt(
  cues: readonly MouthCue[],
  time: number,
  anticipation = 0.025,
): MouthPose {
  if (!Number.isFinite(time) || time < 0) return 'rest';
  const target = time + anticipation;
  let low = 0,
    high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const cue = cues[mid]!;
    if (target < cue.start) high = mid - 1;
    else if (target >= cue.end) low = mid + 1;
    else return VISEME_POSES[cue.value];
  }
  return 'rest';
}

export function smoothLevel(
  current: number,
  input: number,
  dt: number,
): number {
  const target = Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : 0;
  const response = target > current ? 24 : 15;
  return (
    current +
    (target - current) *
      (1 - Math.exp(-response * Math.min(0.1, Math.max(0, dt))))
  );
}

// Hysteresis keeps quiet speech from flickering between two attachments.
export function mouthPose(level: number, previous: MouthPose): MouthPose {
  if (level < (previous === 'rest' ? 0.065 : 0.035)) return 'rest';
  if (level > (previous === 'wide' ? 0.27 : 0.35)) return 'wide';
  return 'mid';
}

// A wide jaw is an articulation accent, not a pose to freeze on while a loud
// fallback or estimated vowel continues. Preserve other visemes, relax wide
// to mid after its attack, and close promptly when either source goes quiet.
export class MouthRelease {
  private quietFor = 0;
  private wideFor = 0;
  reset(): void {
    this.quietFor = 0;
    this.wideFor = 0;
  }
  sample(requested: MouthPose, level: number, dt: number): MouthPose {
    const amplitude = Number.isFinite(level)
      ? Math.max(0, Math.min(1, level))
      : 0;
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.quietFor = amplitude < 0.035 ? this.quietFor + elapsed : 0;
    if (this.quietFor >= 0.075) {
      this.wideFor = 0;
      return 'rest';
    }
    if (requested !== 'wide') {
      this.wideFor = 0;
      return requested;
    }
    this.wideFor += elapsed;
    return this.wideFor <= 0.22 && amplitude >= 0.2 ? 'wide' : 'mid';
  }
}
