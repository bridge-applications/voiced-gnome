import type {
  GnomeSpineActiveEmote,
  GnomeSpineEmote,
} from './gnomeSpineBody.ts';
import type {
  GnomeSpineBrowsPose,
  GnomeSpineExpression,
  GnomeSpineGazeDirection,
} from './gnomeSpineFace.ts';

export interface GnomeSpineEmoteFacePose {
  expression: GnomeSpineExpression | null;
  brows: Readonly<GnomeSpineBrowsPose> | null;
  pupils: number;
  gaze?: Readonly<GnomeSpineGazeDirection>;
}

interface EmoteFaceBeat {
  at: number;
  pose: Readonly<GnomeSpineEmoteFacePose>;
}

export interface GnomeSpineFaceChannels {
  expression: GnomeSpineExpression | null;
  brows: Readonly<GnomeSpineBrowsPose> | null;
  pupils: number | null;
}

const NEUTRAL: Readonly<GnomeSpineEmoteFacePose> = {
  expression: null,
  brows: null,
  pupils: 0,
};
const PROUD: Readonly<GnomeSpineEmoteFacePose> = {
  expression: 'expressions/proud',
  brows: { left: { raise: 0.22, tilt: 0 }, right: { raise: 0.22, tilt: 0 } },
  pupils: 0,
};
const HAPPY: Readonly<GnomeSpineEmoteFacePose> = {
  expression: 'expressions/big_happy',
  brows: { left: { raise: 0.3, tilt: 0 }, right: { raise: 0.3, tilt: 0 } },
  pupils: 0.15,
};
const SURPRISED: Readonly<GnomeSpineEmoteFacePose> = {
  expression: 'expressions/surprised',
  brows: null,
  pupils: 0.2,
};
const FACE_PLAYER: Readonly<GnomeSpineGazeDirection> = {
  horizontal: 0,
  vertical: 0,
};
const LOOK_LEFT: Readonly<GnomeSpineGazeDirection> = {
  horizontal: -0.65,
  vertical: -0.15,
};
const LOOK_RIGHT: Readonly<GnomeSpineGazeDirection> = {
  horizontal: 0.65,
  vertical: 0,
};

/** Facial beats are runtime layers; the native body clips never own them. */
const EMOTE_FACE_BEATS = {
  'animations/emotes/nailed_it': [
    { at: 0, pose: NEUTRAL },
    { at: 0.16, pose: PROUD },
    { at: 0.94, pose: NEUTRAL },
  ],
  'animations/emotes/mastered_it': [
    { at: 0, pose: NEUTRAL },
    { at: 0.24, pose: PROUD },
    { at: 1.18, pose: HAPPY },
    { at: 1.7, pose: PROUD },
    { at: 2.12, pose: NEUTRAL },
  ],
  'animations/emotes/me_promoted': [
    { at: 0, pose: NEUTRAL },
    { at: 0.12, pose: SURPRISED },
    { at: 0.6, pose: PROUD },
    { at: 1.05, pose: HAPPY },
    { at: 4.25, pose: PROUD },
    { at: 4.55, pose: NEUTRAL },
  ],
  'animations/emotes/look_what_i_earned': [
    { at: 0, pose: { ...NEUTRAL, gaze: FACE_PLAYER } },
    { at: 0.25, pose: { ...NEUTRAL, gaze: LOOK_LEFT } },
    { at: 0.26, pose: { ...SURPRISED, gaze: LOOK_LEFT } },
    { at: 0.55, pose: { ...PROUD, gaze: LOOK_LEFT } },
    { at: 1.05, pose: { ...PROUD, gaze: FACE_PLAYER } },
    { at: 1.68, pose: { ...NEUTRAL, gaze: FACE_PLAYER } },
  ],
  'animations/emotes/onwards': [
    { at: 0, pose: { ...NEUTRAL, gaze: FACE_PLAYER } },
    { at: 0.24, pose: { ...PROUD, gaze: FACE_PLAYER } },
    { at: 0.5, pose: { ...PROUD, gaze: LOOK_RIGHT } },
    { at: 1.3, pose: { ...PROUD, gaze: FACE_PLAYER } },
    { at: 1.52, pose: { ...NEUTRAL, gaze: FACE_PLAYER } },
  ],
  'animations/emotes/heel_click_hooray': [
    { at: 0, pose: NEUTRAL },
    { at: 0.45, pose: HAPPY },
    { at: 2.4, pose: NEUTRAL },
  ],
} as const satisfies Partial<Record<GnomeSpineEmote, readonly EmoteFaceBeat[]>>;

export function resolveGnomeSpineEmoteFace(
  active: Readonly<GnomeSpineActiveEmote> | null,
  animationTime: number | null,
): Readonly<GnomeSpineEmoteFacePose> | null {
  if (
    active === null ||
    animationTime === null ||
    !Number.isFinite(animationTime)
  )
    return null;
  if (!(active.emote in EMOTE_FACE_BEATS)) return null;
  const beats = EMOTE_FACE_BEATS[active.emote as keyof typeof EMOTE_FACE_BEATS];
  for (let index = beats.length - 1; index >= 0; index -= 1) {
    const beat = beats[index];
    if (beat !== undefined && animationTime + 1e-6 >= beat.at) return beat.pose;
  }
  return null;
}

/** Explicit props, including null, win over a profile's authored defaults. */
export function resolveGnomeSpineFaceChannels(
  profile: Readonly<GnomeSpineEmoteFacePose> | null,
  explicit: Readonly<Partial<GnomeSpineFaceChannels>>,
  fallback: Readonly<GnomeSpineFaceChannels>,
): Readonly<GnomeSpineFaceChannels> {
  if (profile === null) return fallback;
  return {
    expression:
      explicit.expression === undefined
        ? profile.expression
        : explicit.expression,
    brows: explicit.brows === undefined ? profile.brows : explicit.brows,
    pupils: explicit.pupils === undefined ? profile.pupils : explicit.pupils,
  };
}
