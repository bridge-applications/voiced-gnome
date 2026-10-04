/**
 * Drives the Gnome's face on top of the Spine export: gaze (through the rig's
 * IK gaze controller), expressions (the expression track), blinking (the
 * blink track), the eyebrows (an offset on top of the expression's brow
 * pose), and the pupil limits that keep the pupils inside the eyelids of an
 * expression. Both face tracks sit above the body track driven by
 * `gnomeSpineBody.ts`; see `gnomeSpineTracks.ts` for why that order matters.
 *
 * The pupil limits work in two stages. Once, at creation, every expression
 * animation is posed on the lids and the lid meshes are sampled into curved
 * edge profiles in eye space, together with how far the resting pupil already
 * tucks under the lids. Then, after each world transform update, the pupil
 * bones are nudged back inside the aperture of the active expression. See docs/character.md for the rig assumptions and speech layering.
 */
import {
  MeshAttachment,
  MixFrom,
  Physics,
  RegionAttachment,
  Vector2,
  type Animation,
  type Bone,
  type Skeleton,
  type Slot,
  type Spine,
  type TrackEntry,
} from '@esotericsoftware/spine-pixi-v8';
const GNOME_FACIAL_EXPRESSIONS = [
  'expressions/awkward',
  'expressions/big_happy',
  'expressions/buffering',
  'expressions/dopey_neutral',
  'expressions/proud',
  'expressions/surprised',
] as const;
import {
  measurePupilLidOverlap,
  rasterizeLidEdge,
  resolvePupilUp,
  type GnomeSpineEyePoint,
  type GnomeSpineLidBound,
  type GnomeSpineLidProfile,
  type GnomeSpineLidSampling,
  type GnomeSpineLidSide,
} from './gnomeSpinePupilLimits.ts';
import {
  GNOME_SPINE_BLINK_TRACK,
  GNOME_SPINE_EXPRESSION_TRACK,
} from './gnomeSpineTracks.ts';

/** Expression poses available in the standalone export. */
export const GNOME_SPINE_EXPRESSIONS = [
  ...GNOME_FACIAL_EXPRESSIONS,
  'expressions/angry',
] as const;

export type GnomeSpineExpression = (typeof GNOME_SPINE_EXPRESSIONS)[number];

export const GNOME_SPINE_DEFAULT_EXPRESSION =
  'expressions/dopey_neutral' satisfies GnomeSpineExpression;

interface GnomeSpinePoint {
  x: number;
  y: number;
}

/** A look relative to the viewer; each axis is -1..1, see `GAZE_DIRECTION_RANGE`. */
export interface GnomeSpineGazeDirection {
  /** -1 looks to the viewer's left, +1 to the viewer's right. */
  horizontal: number;
  /** -1 looks down, +1 looks up. */
  vertical: number;
}

/** One eyebrow's offset from the expression's pose; each axis is -1..1. */
export interface GnomeSpineBrowPose {
  /** -1 pulls the brow down (furrowed), +1 raises it as far as surprised. */
  raise: number;
  /** +1 raises the outer tip (inner-down angry), -1 is inner-up worried. */
  tilt: number;
}

/** Sides are the Gnome's own: `left` is `l_brow`, on the viewer's right. */
export interface GnomeSpineBrowsPose {
  left: Readonly<GnomeSpineBrowPose>;
  right: Readonly<GnomeSpineBrowPose>;
}

export const GNOME_SPINE_NEUTRAL_BROWS: Readonly<GnomeSpineBrowsPose> = {
  left: { raise: 0, tilt: 0 },
  right: { raise: 0, tilt: 0 },
};

/** A head offset over the body animation; each axis is -1..1. */
export interface GnomeSpineHeadPose {
  /** -1 dips the head (a nod down), +1 lifts it. */
  bob: number;
  /** +1 grows the head a touch, as if leaning in; -1 shrinks it back. */
  lean: number;
  /** Rolls the head; +1 tips the top towards the viewer's right. */
  tilt: number;
}

export const GNOME_SPINE_NEUTRAL_HEAD: Readonly<GnomeSpineHeadPose> = {
  bob: 0,
  lean: 0,
  tilt: 0,
};

/** How much the pupils are dilated: -1 constricts, +1 dilates, 0 is drawn. */
export type GnomeSpinePupilDilation = number;

export type GnomeSpineBlinkKind =
  'double' | 'half' | 'normal' | 'slow' | 'wink';

export interface GnomeSpineBlinkOptions {
  kind?: GnomeSpineBlinkKind;
  /** For a wink: which of the Gnome's own eyes closes. Defaults to left. */
  side?: 'left' | 'right';
}

export interface GnomeSpineFaceController {
  blink: (options?: Readonly<GnomeSpineBlinkOptions>) => void;
  dispose: () => void;
  resetGaze: () => void;
  /** Adds a smoothed offset to the brows over whatever the expression does. */
  setBrowPose: (brows: Readonly<GnomeSpineBrowsPose>) => void;
  /** Adds a smoothed offset to the head over whatever the body does. */
  setHeadPose: (head: Readonly<GnomeSpineHeadPose>) => void;
  /** Grows or shrinks the pupils smoothly; the lids still clip them. */
  setPupilDilation: (dilation: GnomeSpinePupilDilation) => void;
  setExpression: (expression: GnomeSpineExpression | null) => void;
  /** Looks away from the neutral gaze in a viewer-relative direction. */
  setGazeDirection: (direction: Readonly<GnomeSpineGazeDirection>) => void;
  setGazeTarget: (target: Readonly<GnomeSpinePoint>) => void;
}

const GAZE_CONTROLLER_BONE = 'IK_gaze_cntrl';
const BLINK_ANIMATION = 'blinking';
export const GNOME_SPINE_EXPRESSION_SLOTS = {
  'expressions/angry': ['awkward'],
  'expressions/awkward': ['awkward'],
  'expressions/big_happy': [
    'big_happy_l_cheek',
    'big_happy_mouth',
    'big_happy_r_cheek',
  ],
  'expressions/buffering': ['buffering'],
  'expressions/dopey_neutral': ['dopey_neutral'],
  'expressions/proud': [
    'proud_idiot_chin',
    'proud_idiot_l_cheek',
    'proud_idiot_mouth',
    'proud_idiot_r_cheek',
  ],
  'expressions/surprised': ['surprised'],
} as const satisfies Record<GnomeSpineExpression, readonly string[]>;
const GNOME_SPINE_FACE_SLOT_NAMES = [
  ...new Set(Object.values(GNOME_SPINE_EXPRESSION_SLOTS).flat()),
] as const;
/**
 * Each eye of the rig: the pupil rides an IK bone under the eye bone, and the
 * eyelids are meshes whose inner edge is the visible lash line. The eye bone's
 * local x axis points up the face, so lid limits are measured along it.
 */
const GNOME_SPINE_EYES = [
  {
    eyeBone: 'l_eyeball',
    lowerLidSlot: 'eyelid_l_dwn',
    pupilBone: 'l_pupil',
    pupilSlot: 'l_pupil',
    upperLidSlot: 'l_eyelid_up',
  },
  {
    eyeBone: 'r_eyeball',
    lowerLidSlot: 'eyelid_r_dwn',
    pupilBone: 'r_pupil',
    pupilSlot: 'r_pupil',
    upperLidSlot: 'r_eyelid_up',
  },
] as const;
/**
 * The eyebrows are lone bones under the face; their local x runs up the face
 * and their rotation tilts them. The right brow is mirrored (`scaleX: -1`),
 * so a symmetric tilt needs opposite rotations on the two bones.
 */
const GNOME_SPINE_BROWS = [
  { bone: 'l_brow', side: 'left', tiltSign: 1 },
  { bone: 'r_brow', side: 'right', tiltSign: -1 },
] as const;
/** Skeleton units a full raise or furrow moves a brow; surprised raises ~34. */
const BROW_RAISE_RANGE = 35;
const BROW_FURROW_RANGE = 25;
/** Degrees a full runtime tilt offset turns a brow. */
const BROW_TILT_RANGE_DEGREES = 10;
const BROW_RESPONSE_PER_SECOND = 12;
const EXPRESSION_TRACK = GNOME_SPINE_EXPRESSION_TRACK;
const BLINK_TRACK = GNOME_SPINE_BLINK_TRACK;
const EXPRESSION_MIX_DURATION_SECONDS = 0.12;
const BLINK_MIX_OUT_DURATION_SECONDS = 0.06;
const BLINK_ALPHA = 0.9;
/** A half blink only drops the lids part of the way. */
const HALF_BLINK_ALPHA = 0.45;
const SLOW_BLINK_TIME_SCALE = 0.55;
/** The head bone's local x runs up the head; y is across; rotation rolls. */
const HEAD_BONE = 'head';
const HEAD_BOB_RANGE = 10;
const HEAD_TILT_RANGE_DEGREES = 8;
const HEAD_LEAN_SCALE_RANGE = 0.05;
const HEAD_RESPONSE_PER_SECOND = 10;
/** A full dilation or constriction scales the pupils by this much. */
const PUPIL_DILATION_RANGE = 0.25;
const PUPIL_RESPONSE_PER_SECOND = 8;
/** The eyelid control bones the blink moves, per eye, for winks. */
const GNOME_SPINE_EYELID_CONTROLS = {
  left: ['eyelid_l_dwn_cntrl', 'l_eyelid_up_cntrl'],
  right: ['eyelid_r_dwn_cntrl', 'r_eyelid_up_cntrl'],
} as const;
const GAZE_RESPONSE_PER_SECOND = 14;
const MAX_GAZE_FRAME_DELTA_SECONDS = 0.1;
/** Positions along the lid at which its curved edge is sampled. */
const LID_PROFILE_SAMPLE_COUNT = 41;
/**
 * Skeleton units the pupil may always slip under a lid so it reads as nestled
 * against the lash line rather than floating just above it.
 */
const PUPIL_LID_MIN_OVERLAP = 3;
/**
 * Added to the measured resting overlap so sampling error can never nudge the
 * pupil of the neutral face.
 */
const RESTING_OVERLAP_SLACK = 0.5;
/** Distance the gaze target is pushed to find how far the pupil can travel. */
const GAZE_REACH_PROBE_DISTANCE = 1_000;
/**
 * Skeleton units a full-strength gaze direction moves the target from
 * neutral: far enough to read as a clear look, short of the pupil's limit.
 */
const GAZE_DIRECTION_RANGE = 260;
/** The eye bone's local x axis must point up the face to at least this cosine. */
const MIN_EYE_UP_AXIS_ALIGNMENT = 0.5;

interface GnomeSpineEyeLidProfiles {
  readonly lower: GnomeSpineLidProfile;
  readonly upper: GnomeSpineLidProfile;
}

interface GnomeSpineExpressionAnimation {
  readonly animation: Animation;
  readonly expression: GnomeSpineExpression;
}

interface GnomeSpineEyeRig {
  readonly eye: Bone;
  readonly lowerLid: Slot;
  readonly pupil: Bone;
  readonly pupilRadius: number;
  readonly upperLid: Slot;
}

interface GnomeSpinePupilLimiter {
  readonly eye: Bone;
  readonly lower: GnomeSpineLidBound;
  /** How far under the lower lash line the pupil may sit. */
  readonly lowerOverlap: number;
  readonly profiles: ReadonlyMap<
    GnomeSpineExpression,
    GnomeSpineEyeLidProfiles
  >;
  readonly pupil: Bone;
  /** The pupil's drawn radius, before any dilation. */
  readonly pupilRadius: number;
  readonly upper: GnomeSpineLidBound;
  readonly upperOverlap: number;
}

function requireAnimation(character: Spine, animationName: string): Animation {
  const animation = character.skeleton.data.findAnimation(animationName);
  if (animation !== null) return animation;

  throw new Error(
    `The Spine Gnome export is missing facial animation "${animationName}".`,
  );
}

function requireBone(character: Spine, boneName: string): Bone {
  const bone = character.skeleton.findBone(boneName);
  if (bone !== null) return bone;

  throw new Error(`The Spine Gnome export is missing bone "${boneName}".`);
}

function requireSlot(character: Spine, slotName: string): Slot {
  const slot = character.skeleton.findSlot(slotName);
  if (slot !== null) return slot;

  throw new Error(`The Spine Gnome export is missing slot "${slotName}".`);
}

function measurePupilRadius(slot: Slot): number {
  const attachment = slot.pose.getAttachment();
  if (attachment instanceof RegionAttachment) {
    return (
      Math.min(
        attachment.width * Math.abs(attachment.scaleX),
        attachment.height * Math.abs(attachment.scaleY),
      ) / 2
    );
  }
  if (attachment instanceof MeshAttachment) {
    return Math.min(attachment.width, attachment.height) / 2;
  }

  throw new Error(
    `The Spine Gnome pupil slot "${slot.data.name}" needs a region or mesh attachment.`,
  );
}

function readEyePoint(
  eye: Bone,
  worldX: number,
  worldY: number,
  point: Vector2,
): GnomeSpineEyePoint {
  eye.appliedPose.worldToLocal(point.set(worldX, worldY));

  return { left: point.y, up: point.x };
}

/** The lid mesh hull, which traces the lid artwork, in the eye's local space. */
function readLidHull(
  skeleton: Skeleton,
  eye: Bone,
  slot: Slot,
  point: Vector2,
): GnomeSpineEyePoint[] {
  const attachment = slot.pose.getAttachment();
  if (!(attachment instanceof MeshAttachment)) {
    throw new Error(
      `The Spine Gnome eyelid slot "${slot.data.name}" needs a mesh attachment.`,
    );
  }

  const hullValueCount = attachment.hullLength;
  const worldVertices = new Float32Array(hullValueCount);
  attachment.computeWorldVertices(
    skeleton,
    slot,
    0,
    hullValueCount,
    worldVertices,
    0,
    2,
  );
  const hull: GnomeSpineEyePoint[] = [];
  for (let index = 0; index + 1 < hullValueCount; index += 2) {
    const worldX = worldVertices[index];
    const worldY = worldVertices[index + 1];
    if (worldX === undefined || worldY === undefined) break;

    hull.push(readEyePoint(eye, worldX, worldY, point));
  }

  return hull;
}

function requireEyeUpAxis(skeleton: Skeleton, eye: Bone): void {
  const { a, c } = eye.appliedPose;
  const alignment = (Math.sign(skeleton.scaleY) * c) / Math.hypot(a, c);
  if (alignment >= MIN_EYE_UP_AXIS_ALIGNMENT) return;

  throw new Error(
    `The Spine Gnome eye bone "${eye.data.name}" must point its local x axis up the face.`,
  );
}

/**
 * Unit vectors in skeleton world space that point to the viewer's right and
 * up, taken from the eye bone's axes so a mirrored or rotated rig still
 * looks where the viewer expects. The skeleton's scale tells which way its
 * world axes face on screen.
 */
function readViewerAxes(skeleton: Skeleton): {
  right: GnomeSpinePoint;
  /** Multiplies a local rotation so positive tips the top screen-right. */
  tiltSign: 1 | -1;
  up: GnomeSpinePoint;
} {
  const eye = skeleton.findBone(GNOME_SPINE_EYES[0].eyeBone);
  if (eye === null) {
    throw new Error(
      `The Spine Gnome export is missing bone "${GNOME_SPINE_EYES[0].eyeBone}".`,
    );
  }

  const { a, b, c, d } = eye.appliedPose;
  const screenX = Math.sign(skeleton.scaleX) || 1;
  const screenY = Math.sign(skeleton.scaleY) || 1;
  const normalize = (x: number, y: number, towards: number) => {
    const length = Math.hypot(x, y) || 1;
    const sign = Math.sign(towards) || 1;
    return { x: (sign * x) / length, y: (sign * y) / length };
  };

  // Rotating counter-clockwise in a y-up world tips an upright axis left;
  // the y-down runtime mirrors that, so the sign follows the world's y.
  const tiltSign: 1 | -1 = screenX * screenY > 0 ? -1 : 1;

  return {
    // The eye's local y axis runs across the face; face it screen-right.
    right: normalize(b, d, b * screenX),
    tiltSign,
    // The eye's local x axis runs up the face; face it screen-up.
    up: normalize(a, c, c * screenY),
  };
}

function createLidBound(
  side: GnomeSpineLidSide,
  profile: GnomeSpineLidProfile,
  pupilRadius: number,
): GnomeSpineLidBound {
  return { from: profile, mix: 1, pupilRadius, side, to: profile };
}

function requireLidProfiles(
  limiter: GnomeSpinePupilLimiter,
  expression: GnomeSpineExpression,
): GnomeSpineEyeLidProfiles {
  const profiles = limiter.profiles.get(expression);
  if (profiles !== undefined) return profiles;

  throw new Error(
    `The Spine Gnome eye "${limiter.eye.data.name}" has no lid profiles for "${expression}".`,
  );
}

/**
 * Samples where each eyelid edge sits for every expression by posing the lids
 * exactly as the expression animation does, and measures how far the resting
 * pupil already tucks under the lids so the neutral face is left untouched.
 * Blinking is deliberately not sampled: the pupil may disappear under a blink.
 */
function calibratePupilLimiters(
  character: Spine,
  gazeController: Bone,
  gazeParent: Bone,
  neutralGaze: Readonly<GnomeSpinePoint>,
  expressionAnimations: readonly GnomeSpineExpressionAnimation[],
): GnomeSpinePupilLimiter[] {
  const { skeleton, state } = character;
  const point = new Vector2();
  const eyeRigs: GnomeSpineEyeRig[] = GNOME_SPINE_EYES.map((names) => ({
    eye: requireBone(character, names.eyeBone),
    lowerLid: requireSlot(character, names.lowerLidSlot),
    pupil: requireBone(character, names.pupilBone),
    pupilRadius: measurePupilRadius(requireSlot(character, names.pupilSlot)),
    upperLid: requireSlot(character, names.upperLidSlot),
  }));
  const slotAttachments = skeleton.slots.map(
    (slot) => [slot, slot.pose.getAttachment()] as const,
  );

  const poseGaze = (worldX: number, worldY: number): void => {
    skeleton.setupPoseBones();
    gazeParent.appliedPose.worldToLocal(point.set(worldX, worldY));
    gazeController.pose.setPosition(point.x, point.y);
    skeleton.updateWorldTransform(Physics.pose);
  };
  const poseLids = (animation: Animation | null): void => {
    skeleton.setupPoseBones();
    animation?.apply(
      skeleton,
      0,
      0,
      false,
      null,
      1,
      MixFrom.setup,
      false,
      false,
      false,
    );
    skeleton.updateWorldTransform(Physics.pose);
  };

  try {
    return eyeRigs.map((rig): GnomeSpinePupilLimiter => {
      const { eye, lowerLid, pupil, pupilRadius, upperLid } = rig;
      const readPupilUp = (): number =>
        readEyePoint(
          eye,
          pupil.appliedPose.worldX,
          pupil.appliedPose.worldY,
          point,
        ).up;
      poseLids(null);
      requireEyeUpAxis(skeleton, eye);
      // The eye's local x axis in world space, so the gaze probes run
      // straight down and up the face whichever way the world is flipped.
      const { a: upWorldX, c: upWorldY } = eye.appliedPose;
      const upLength = Math.hypot(upWorldX, upWorldY);
      const probeX = (GAZE_REACH_PROBE_DISTANCE * upWorldX) / upLength;
      const probeY = (GAZE_REACH_PROBE_DISTANCE * upWorldY) / upLength;
      poseGaze(neutralGaze.x - probeX, neutralGaze.y - probeY);
      const reachDown = Math.abs(readPupilUp());
      poseGaze(neutralGaze.x + probeX, neutralGaze.y + probeY);
      const reachUp = Math.abs(readPupilUp());
      const halfWidth = Math.max(reachDown, reachUp) + pupilRadius;
      const sampling: GnomeSpineLidSampling = {
        count: LID_PROFILE_SAMPLE_COUNT,
        start: -halfWidth,
        step: (2 * halfWidth) / (LID_PROFILE_SAMPLE_COUNT - 1),
      };
      const readLidProfiles = (
        animation: Animation | null,
      ): GnomeSpineEyeLidProfiles => {
        poseLids(animation);

        return {
          lower: rasterizeLidEdge(
            readLidHull(skeleton, eye, lowerLid, point),
            'lower',
            sampling,
          ),
          upper: rasterizeLidEdge(
            readLidHull(skeleton, eye, upperLid, point),
            'upper',
            sampling,
          ),
        };
      };
      const resting = readLidProfiles(null);
      const profiles = new Map(
        expressionAnimations.map(
          ({ animation, expression }) =>
            [expression, readLidProfiles(animation)] as const,
        ),
      );
      const overlap = (
        side: GnomeSpineLidSide,
        profile: GnomeSpineLidProfile,
        reach: number,
      ): number =>
        Math.max(
          PUPIL_LID_MIN_OVERLAP,
          measurePupilLidOverlap({
            profile,
            pupilRadius,
            reach,
            side,
          }) + RESTING_OVERLAP_SLACK,
        );
      const lowerOverlap = overlap('lower', resting.lower, reachDown);
      const upperOverlap = overlap('upper', resting.upper, reachUp);

      return {
        eye,
        lower: createLidBound(
          'lower',
          resting.lower,
          pupilRadius - lowerOverlap,
        ),
        lowerOverlap,
        profiles,
        pupil,
        pupilRadius,
        upper: createLidBound(
          'upper',
          resting.upper,
          pupilRadius - upperOverlap,
        ),
        upperOverlap,
      };
    });
  } finally {
    skeleton.setupPoseBones();
    slotAttachments.forEach(([slot, attachment]) => {
      slot.pose.setAttachment(attachment);
    });
    state.apply(skeleton);
    skeleton.updateWorldTransform(Physics.pose);
  }
}

export function createGnomeSpineFaceController(
  character: Spine,
): GnomeSpineFaceController {
  // New carousel rigs have not ticked yet. Resolve bones before capturing
  // the neutral gaze and viewer axes, so every instance starts with eye contact.
  character.skeleton.updateWorldTransform(Physics.pose);
  const gazeController = character.skeleton.findBone(GAZE_CONTROLLER_BONE);
  if (gazeController === null || gazeController.parent === null) {
    throw new Error(
      `The Spine Gnome export is missing gaze controller "${GAZE_CONTROLLER_BONE}".`,
    );
  }

  requireAnimation(character, BLINK_ANIMATION);
  const expressionAnimations: GnomeSpineExpressionAnimation[] =
    GNOME_SPINE_EXPRESSIONS.map((expression) => ({
      animation: requireAnimation(character, expression),
      expression,
    }));

  const neutralGaze = {
    x: gazeController.appliedPose.worldX,
    y: gazeController.appliedPose.worldY,
  };
  const currentGaze = { ...neutralGaze };
  const targetGaze = { ...neutralGaze };
  const viewerAxes = readViewerAxes(character.skeleton);
  const brows = GNOME_SPINE_BROWS.map(({ bone, side, tiltSign }) => ({
    applied: { rotation: 0, x: 0 },
    bone: requireBone(character, bone),
    current: { raise: 0, tilt: 0 },
    side,
    target: { raise: 0, tilt: 0 },
    tiltSign,
  }));
  const headBone = requireBone(character, HEAD_BONE);
  const head = {
    applied: { rotation: 0, scale: 0, x: 0 },
    current: { bob: 0, lean: 0, tilt: 0 },
    target: { bob: 0, lean: 0, tilt: 0 },
  };
  const pupils = {
    applied: 0,
    current: 0,
    target: 0,
  };
  // The lids of the eye that stays open during a wink, and where they were.
  let winkHold: {
    bones: readonly { bone: Bone; x: number; y: number }[];
    untilMs: number;
  } | null = null;
  const gazeParent = gazeController.parent;
  const gazeParentPoint = new Vector2();
  const eyePoint = new Vector2();
  const previousBeforeUpdateWorldTransforms =
    character.beforeUpdateWorldTransforms;
  const previousAfterUpdateWorldTransforms =
    character.afterUpdateWorldTransforms;
  const faceSlots = GNOME_SPINE_FACE_SLOT_NAMES.map((slotName) => {
    const slot = character.skeleton.findSlot(slotName);
    if (slot === null) {
      throw new Error(
        `The Spine Gnome export is missing facial slot "${slotName}".`,
      );
    }

    const setupAttachment = slot.pose.getAttachment();
    if (setupAttachment === null) {
      throw new Error(
        `The Spine Gnome facial slot "${slotName}" has no setup attachment.`,
      );
    }

    return { setupAttachment, slot, slotName };
  });
  const pupilLimiters = calibratePupilLimiters(
    character,
    gazeController,
    gazeParent,
    neutralGaze,
    expressionAnimations,
  );
  let currentExpression: GnomeSpineExpression | undefined;
  let lastGazeUpdateTimeMs = performance.now();

  const applyExpressionAttachments = (): void => {
    const visibleSlotNames: readonly string[] =
      GNOME_SPINE_EXPRESSION_SLOTS[
        currentExpression ?? GNOME_SPINE_DEFAULT_EXPRESSION
      ];

    faceSlots.forEach(({ setupAttachment, slot, slotName }) => {
      slot.pose.setAttachment(
        visibleSlotNames.includes(slotName) ? setupAttachment : null,
      );
    });
  };

  const setExpression = (expression: GnomeSpineExpression | null): void => {
    const nextExpression = expression ?? GNOME_SPINE_DEFAULT_EXPRESSION;
    if (nextExpression === currentExpression) return;

    const mixDuration =
      currentExpression === undefined ? 0 : EXPRESSION_MIX_DURATION_SECONDS;
    const previousExpression = currentExpression ?? nextExpression;
    currentExpression = nextExpression;
    const expressionEntry = character.state.setAnimation(
      EXPRESSION_TRACK,
      nextExpression,
      false,
    );
    expressionEntry.mixDuration = mixDuration;
    applyExpressionAttachments();
    pupilLimiters.forEach((limiter) => {
      const from = requireLidProfiles(limiter, previousExpression);
      const to = requireLidProfiles(limiter, nextExpression);
      limiter.lower.from = from.lower;
      limiter.lower.to = to.lower;
      limiter.upper.from = from.upper;
      limiter.upper.to = to.upper;
    });
  };

  const applyGaze = (spine: Spine): void => {
    previousBeforeUpdateWorldTransforms(spine);
    // The export uses the setup pose to hold every facial attachment and
    // the proud animation does not key its own slots. Keep visibility
    // deterministic after AnimationState has applied its timelines.
    applyExpressionAttachments();

    const nowMs = performance.now();
    const deltaSeconds = Math.min(
      Math.max((nowMs - lastGazeUpdateTimeMs) / 1_000, 0),
      MAX_GAZE_FRAME_DELTA_SECONDS,
    );
    lastGazeUpdateTimeMs = nowMs;
    const progress = 1 - Math.exp(-GAZE_RESPONSE_PER_SECOND * deltaSeconds);
    currentGaze.x += (targetGaze.x - currentGaze.x) * progress;
    currentGaze.y += (targetGaze.y - currentGaze.y) * progress;

    gazeParentPoint.set(currentGaze.x, currentGaze.y);
    gazeParent.appliedPose.worldToLocal(gazeParentPoint);
    gazeController.pose.setPosition(gazeParentPoint.x, gazeParentPoint.y);

    // The brows ride on top of whatever the expression track just posed.
    // The offset is taken back out after the world transforms are built
    // (see `applyPupilLimits`), because AnimationState only rewrites the
    // channels an expression keys and the rest would otherwise pile up.
    const browProgress = 1 - Math.exp(-BROW_RESPONSE_PER_SECOND * deltaSeconds);
    brows.forEach((brow) => {
      brow.current.raise +=
        (brow.target.raise - brow.current.raise) * browProgress;
      brow.current.tilt +=
        (brow.target.tilt - brow.current.tilt) * browProgress;
      brow.applied.x =
        brow.current.raise *
        (brow.current.raise >= 0 ? BROW_RAISE_RANGE : BROW_FURROW_RANGE);
      brow.applied.rotation =
        brow.tiltSign * brow.current.tilt * BROW_TILT_RANGE_DEGREES;
      brow.bone.pose.x += brow.applied.x;
      brow.bone.pose.rotation += brow.applied.rotation;
    });

    const headProgress = 1 - Math.exp(-HEAD_RESPONSE_PER_SECOND * deltaSeconds);
    head.current.bob += (head.target.bob - head.current.bob) * headProgress;
    head.current.lean += (head.target.lean - head.current.lean) * headProgress;
    head.current.tilt += (head.target.tilt - head.current.tilt) * headProgress;
    head.applied.x = head.current.bob * HEAD_BOB_RANGE;
    head.applied.rotation =
      viewerAxes.tiltSign * head.current.tilt * HEAD_TILT_RANGE_DEGREES;
    head.applied.scale = head.current.lean * HEAD_LEAN_SCALE_RANGE;
    headBone.pose.x += head.applied.x;
    headBone.pose.rotation += head.applied.rotation;
    headBone.pose.scaleX += head.applied.scale;
    headBone.pose.scaleY += head.applied.scale;

    const pupilProgress =
      1 - Math.exp(-PUPIL_RESPONSE_PER_SECOND * deltaSeconds);
    pupils.current += (pupils.target - pupils.current) * pupilProgress;
    pupils.applied = pupils.current * PUPIL_DILATION_RANGE;
    pupilLimiters.forEach(({ pupil }) => {
      pupil.pose.scaleX += pupils.applied;
      pupil.pose.scaleY += pupils.applied;
    });

    // A wink is the blink with one eye held where the expression left it.
    if (winkHold !== null) {
      if (nowMs >= winkHold.untilMs) {
        winkHold = null;
      } else {
        winkHold.bones.forEach(({ bone, x, y }) => {
          bone.pose.x = x;
          bone.pose.y = y;
        });
      }
    }
  };

  /**
   * The expression track mixes lid poses linearly between two expressions,
   * so the pupil limits follow the same mix. Blinks live on their own track
   * and are ignored on purpose: a blink may sweep over the pupil.
   */
  const readExpressionMix = (): number => {
    const entry = character.state.tracks[EXPRESSION_TRACK];
    if (entry === undefined || entry === null || entry.mixingFrom === null) {
      return 1;
    }

    return entry.mix();
  };

  // Runs after the skeleton's world transforms so the pupil can be nudged
  // back inside the lid aperture of the active expression. The pupil bone
  // has no children, so only its own world position needs updating.
  const applyPupilLimits = (spine: Spine): void => {
    previousAfterUpdateWorldTransforms(spine);

    brows.forEach((brow) => {
      brow.bone.pose.x -= brow.applied.x;
      brow.bone.pose.rotation -= brow.applied.rotation;
      brow.applied.x = 0;
      brow.applied.rotation = 0;
    });
    headBone.pose.x -= head.applied.x;
    headBone.pose.rotation -= head.applied.rotation;
    headBone.pose.scaleX -= head.applied.scale;
    headBone.pose.scaleY -= head.applied.scale;
    head.applied.x = 0;
    head.applied.rotation = 0;
    head.applied.scale = 0;
    pupilLimiters.forEach(({ pupil }) => {
      pupil.pose.scaleX -= pupils.applied;
      pupil.pose.scaleY -= pupils.applied;
    });

    const mix = readExpressionMix();
    const pupilScale = 1 + pupils.applied;
    pupilLimiters.forEach((limiter) => {
      const { eye, lower, pupil, upper } = limiter;
      lower.mix = mix;
      upper.mix = mix;
      // A dilated pupil is a bigger disc; the lids clip the same way.
      lower.pupilRadius =
        limiter.pupilRadius * pupilScale - limiter.lowerOverlap;
      upper.pupilRadius =
        limiter.pupilRadius * pupilScale - limiter.upperOverlap;
      const { left, up } = readEyePoint(
        eye,
        pupil.appliedPose.worldX,
        pupil.appliedPose.worldY,
        eyePoint,
      );
      const resolvedUp = resolvePupilUp({ left, lower, up, upper });
      if (resolvedUp === up) return;

      eye.appliedPose.localToWorld(eyePoint.set(resolvedUp, left));
      pupil.appliedPose.worldX = eyePoint.x;
      pupil.appliedPose.worldY = eyePoint.y;
    });
  };

  character.beforeUpdateWorldTransforms = applyGaze;
  character.afterUpdateWorldTransforms = applyPupilLimits;
  setExpression(null);

  return {
    blink: ({ kind = 'normal', side = 'left' } = {}) => {
      const configureBlink = (entry: TrackEntry): void => {
        entry.additive = true;
        entry.alpha = kind === 'half' ? HALF_BLINK_ALPHA : BLINK_ALPHA;
        if (kind === 'slow') entry.timeScale = SLOW_BLINK_TIME_SCALE;
      };
      const blinkEntry = character.state.setAnimation(
        BLINK_TRACK,
        BLINK_ANIMATION,
        false,
      );
      configureBlink(blinkEntry);
      if (kind === 'double') {
        configureBlink(
          character.state.addAnimation(BLINK_TRACK, BLINK_ANIMATION, false, 0),
        );
      }
      character.state.addEmptyAnimation(
        BLINK_TRACK,
        BLINK_MIX_OUT_DURATION_SECONDS,
        0,
      );
      if (kind === 'wink') {
        const openEye = side === 'left' ? 'right' : 'left';
        winkHold = {
          bones: GNOME_SPINE_EYELID_CONTROLS[openEye].map((boneName) => {
            const bone = requireBone(character, boneName);
            return { bone, x: bone.pose.x, y: bone.pose.y };
          }),
          untilMs:
            performance.now() +
            (blinkEntry.animationEnd + BLINK_MIX_OUT_DURATION_SECONDS) * 1_000,
        };
      } else {
        winkHold = null;
      }
    },
    dispose: () => {
      if (character.beforeUpdateWorldTransforms === applyGaze) {
        character.beforeUpdateWorldTransforms =
          previousBeforeUpdateWorldTransforms;
      }
      if (character.afterUpdateWorldTransforms === applyPupilLimits) {
        character.afterUpdateWorldTransforms =
          previousAfterUpdateWorldTransforms;
      }
    },
    resetGaze: () => {
      targetGaze.x = neutralGaze.x;
      targetGaze.y = neutralGaze.y;
    },
    setBrowPose: (pose) => {
      brows.forEach((brow) => {
        const { raise, tilt } = pose[brow.side];
        brow.target.raise = Math.max(-1, Math.min(1, raise));
        brow.target.tilt = Math.max(-1, Math.min(1, tilt));
      });
    },
    setHeadPose: ({ bob, lean, tilt }) => {
      head.target.bob = Math.max(-1, Math.min(1, bob));
      head.target.lean = Math.max(-1, Math.min(1, lean));
      head.target.tilt = Math.max(-1, Math.min(1, tilt));
    },
    setPupilDilation: (dilation) => {
      pupils.target = Math.max(-1, Math.min(1, dilation));
    },
    setExpression,
    setGazeDirection: ({ horizontal, vertical }) => {
      const right = Math.max(-1, Math.min(1, horizontal));
      const up = Math.max(-1, Math.min(1, vertical));
      targetGaze.x =
        neutralGaze.x +
        GAZE_DIRECTION_RANGE *
          (right * viewerAxes.right.x + up * viewerAxes.up.x);
      targetGaze.y =
        neutralGaze.y +
        GAZE_DIRECTION_RANGE *
          (right * viewerAxes.right.y + up * viewerAxes.up.y);
    },
    setGazeTarget: (target) => {
      targetGaze.x = target.x;
      targetGaze.y = target.y;
    },
  };
}
