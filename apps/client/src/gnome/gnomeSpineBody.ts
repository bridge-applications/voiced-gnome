/**
 * Drives the Gnome's body on top of the Spine export: a looping idle on the
 * body track and one-shot emotes that hand back to the idle when they finish.
 * The face controller layers expressions and blinks on the tracks above (see
 * `gnomeSpineTracks.ts`), so a body animation can never take the face away
 * from the runtime.
 *
 * Under reduced motion the body track is emptied so the Gnome holds the setup
 * pose, and emote requests complete immediately so flows that wait for an
 * emote never stall.
 */
import type {
  Animation,
  Spine,
  TrackEntry,
} from '@esotericsoftware/spine-pixi-v8';
import { GNOME_SPINE_BODY_TRACK } from './gnomeSpineTracks.ts';

export const GNOME_SPINE_IDLES = [
  'animations/idle/idle',
  'animations/idle/idle_2',
] as const;

export type GnomeSpineIdle = (typeof GNOME_SPINE_IDLES)[number];

export const GNOME_SPINE_DEFAULT_IDLE =
  'animations/idle/idle' satisfies GnomeSpineIdle;

export const GNOME_SPINE_EMOTES = [
  'animations/emotes/overeager_hello',
  'animations/emotes/happy_hop',
  'animations/emotes/very_important_bow',
  'animations/emotes/who_me',
  'animations/emotes/pebbler_groove',
  'animations/emotes/awkward',
  'animations/emotes/balance_panic',
  'animations/emotes/buffering_bot',
  'animations/emotes/disco_gnome',
  'animations/emotes/heel_click_hooray',
  'animations/emotes/look_what_i_earned',
  'animations/emotes/mastered_it',
  'animations/emotes/me_promoted',
  'animations/emotes/nailed_it',
  'animations/emotes/onwards',
  'animations/emotes/sideflip_jump',
  'animations/emotes/ta_da',
  'animations/emotes/tiny_tantrum',
  'animations/emotes/victory_pump',
  'animations/job_complete/job_complete',
] as const;

export type GnomeSpineEmote = (typeof GNOME_SPINE_EMOTES)[number];

export const GNOME_SPINE_BODY_ANIMATIONS = [
  ...GNOME_SPINE_IDLES,
  ...GNOME_SPINE_EMOTES,
] as const;

export type GnomeSpineBodyAnimation =
  (typeof GNOME_SPINE_BODY_ANIMATIONS)[number];

export type GnomeSpineEmotePlaybackMode = 'loop' | 'once';

/**
 * A body emote to play. A new `requestId` restarts the emote even when the
 * previous request named the same one; `null` returns the body to its idle.
 */
export interface GnomeSpineEmoteRequest {
  emote: GnomeSpineEmote;
  playbackMode: GnomeSpineEmotePlaybackMode;
  requestId: string;
}

export interface GnomeSpineEmoteOptions {
  /** Called once a `once` emote has played through; never on interruption. */
  onComplete?: () => void;
  playbackMode?: GnomeSpineEmotePlaybackMode;
}

/** The emote the body is performing right now, and how. */
export interface GnomeSpineActiveEmote {
  emote: GnomeSpineEmote;
  playbackMode: GnomeSpineEmotePlaybackMode;
}

/**
 * What happened to an emote on the body track. `started` opens every emote,
 * a looping one reports `looped` at each seam, a `once` emote that plays
 * through reports `ended`, and anything cut short (stopped, replaced, reduced
 * motion, disposal) reports `interrupted`. Reduced motion completes emotes
 * without playing them, so it reports nothing.
 */
export type GnomeSpineEmoteEventType =
  'started' | 'looped' | 'ended' | 'interrupted';

export interface GnomeSpineEmoteEvent extends GnomeSpineActiveEmote {
  type: GnomeSpineEmoteEventType;
}

export type GnomeSpineEmoteListener = (
  event: Readonly<GnomeSpineEmoteEvent>,
) => void;

export interface GnomeSpineBodyController {
  dispose: () => void;
  /** The animation on the body track, or null while it holds the setup pose. */
  getActiveAnimation: () => GnomeSpineBodyAnimation | null;
  /** The emote in progress, or null while the body idles (or is still). */
  getActiveEmote: () => Readonly<GnomeSpineActiveEmote> | null;
  /** Time within the active clip, following Spine's clock and loop wrapping. */
  getActiveEmoteTime: () => number | null;
  playEmote: (
    emote: GnomeSpineEmote,
    options?: Readonly<GnomeSpineEmoteOptions>,
  ) => void;
  setIdle: (idle: GnomeSpineIdle) => void;
  /** Reduced motion: empties the body track and completes emotes at once. */
  setMotionEnabled: (isEnabled: boolean) => void;
  /** Mixes out of a playing emote straight back into the idle. */
  stopEmote: () => void;
  /** Hears every emote lifecycle event; returns the unsubscribe. */
  subscribeToEmoteEvents: (listener: GnomeSpineEmoteListener) => () => void;
}

const BODY_TRACK = GNOME_SPINE_BODY_TRACK;
/** Mixing into an emote is quick so the reaction reads as immediate. */
const EMOTE_MIX_IN_DURATION_SECONDS = 0.18;
/** Settling back into the idle is a little softer than the way in. */
const EMOTE_MIX_OUT_DURATION_SECONDS = 0.3;
/** Idle variants trade places with a slow cross-fade. */
const IDLE_MIX_DURATION_SECONDS = 0.45;
/** Emptying the body track under reduced motion is not animated. */
const MOTION_DISABLED_MIX_DURATION_SECONDS = 0;

function isIdle(
  animation: GnomeSpineBodyAnimation,
): animation is GnomeSpineIdle {
  return GNOME_SPINE_IDLES.some((idle) => idle === animation);
}

function requireBodyAnimation(
  character: Spine,
  animationName: GnomeSpineBodyAnimation,
): Animation {
  const animation = character.skeleton.data.findAnimation(animationName);
  if (animation !== null) return animation;

  throw new Error(
    `The Spine Gnome export is missing body animation "${animationName}".`,
  );
}

function registerBodyMixes(
  character: Spine,
  animations: ReadonlyMap<GnomeSpineBodyAnimation, Animation>,
): void {
  animations.forEach((fromAnimation, fromName) => {
    animations.forEach((toAnimation, toName) => {
      if (fromName === toName) return;

      const duration = isIdle(toName)
        ? isIdle(fromName)
          ? IDLE_MIX_DURATION_SECONDS
          : EMOTE_MIX_OUT_DURATION_SECONDS
        : EMOTE_MIX_IN_DURATION_SECONDS;
      character.state.data.setMix(fromAnimation, toAnimation, duration);
    });
  });
}

export function createGnomeSpineBodyController(
  character: Spine,
  initialIdle: GnomeSpineIdle = GNOME_SPINE_DEFAULT_IDLE,
): GnomeSpineBodyController {
  const animations = new Map(
    GNOME_SPINE_BODY_ANIMATIONS.map(
      (animationName) =>
        [
          animationName,
          requireBodyAnimation(character, animationName),
        ] as const,
    ),
  );
  registerBodyMixes(character, animations);

  const requireAnimation = (
    animationName: GnomeSpineBodyAnimation,
  ): Animation => {
    const animation = animations.get(animationName);
    if (animation !== undefined) return animation;

    throw new Error(
      `The Spine Gnome body controller lost animation "${animationName}".`,
    );
  };

  let currentIdle = initialIdle;
  let isMotionEnabled = true;
  let isDisposed = false;
  let activeEmoteEntry: TrackEntry | null = null;
  let activeAnimation: GnomeSpineBodyAnimation | null = null;
  let activeEmote: GnomeSpineActiveEmote | null = null;
  const emoteListeners = new Set<GnomeSpineEmoteListener>();

  const emitEmoteEvent = (
    type: GnomeSpineEmoteEventType,
    emote: GnomeSpineActiveEmote,
  ): void => {
    if (emoteListeners.size === 0) return;

    const event: GnomeSpineEmoteEvent = { ...emote, type };
    // Copied so a listener that unsubscribes mid-event keeps the order.
    for (const listener of [...emoteListeners]) listener(event);
  };

  /** Reports the running emote as cut short and forgets it. */
  const interruptActiveEmote = (): void => {
    const interrupted = activeEmote;
    if (activeEmoteEntry !== null) activeEmoteEntry.listener = null;
    activeEmoteEntry = null;
    activeEmote = null;
    if (interrupted !== null) emitEmoteEvent('interrupted', interrupted);
  };

  const playIdle = (): void => {
    activeEmoteEntry = null;
    activeEmote = null;
    activeAnimation = currentIdle;
    character.state.setAnimation(
      BODY_TRACK,
      requireAnimation(currentIdle),
      true,
    );
  };

  const queueIdleAfterEmote = (emoteEntry: TrackEntry): void => {
    character.state.clearNext(emoteEntry);
    character.state.addAnimation(
      BODY_TRACK,
      requireAnimation(currentIdle),
      true,
      0,
    );
  };

  const playEmote: GnomeSpineBodyController['playEmote'] = (
    emote,
    { onComplete, playbackMode = 'once' } = {},
  ) => {
    if (isDisposed) return;
    if (!isMotionEnabled) {
      onComplete?.();
      return;
    }

    const isLooping = playbackMode === 'loop';
    // Replacing an entry before its first frame can end it synchronously,
    // so the previous emote is let go of before Spine hears about it.
    interruptActiveEmote();
    const emoteEntry = character.state.setAnimation(
      BODY_TRACK,
      requireAnimation(emote),
      isLooping,
    );
    const startedEmote: GnomeSpineActiveEmote = { emote, playbackMode };
    activeEmoteEntry = emoteEntry;
    activeAnimation = emote;
    activeEmote = startedEmote;
    emitEmoteEvent('started', startedEmote);
    if (isLooping) {
      emoteEntry.listener = {
        complete: () => {
          if (activeEmoteEntry !== emoteEntry) return;
          emitEmoteEvent('looped', startedEmote);
        },
      };
      return;
    }

    queueIdleAfterEmote(emoteEntry);
    const completeEmote = (): void => {
      if (activeEmoteEntry !== emoteEntry) return;
      activeEmoteEntry = null;
      activeEmote = null;
      activeAnimation = currentIdle;
      emitEmoteEvent('ended', startedEmote);
      onComplete?.();
    };
    emoteEntry.listener = {
      complete: completeEmote,
      // The idle mix can finish a rounding error before the emote's
      // final time, causing Spine to end it without a complete event.
      // The active-entry guard also excludes interrupted emotes and
      // prevents reporting both events as separate completions.
      end: completeEmote,
    };
  };

  playIdle();

  return {
    dispose: () => {
      if (isDisposed) return;

      isDisposed = true;
      interruptActiveEmote();
      character.state.clearTrack(BODY_TRACK);
      activeAnimation = null;
      emoteListeners.clear();
    },
    getActiveAnimation: () => activeAnimation,
    getActiveEmote: () => activeEmote,
    getActiveEmoteTime: () => activeEmoteEntry?.getAnimationTime() ?? null,
    playEmote,
    setIdle: (idle) => {
      if (isDisposed || idle === currentIdle) return;

      currentIdle = idle;
      if (!isMotionEnabled) return;
      if (activeEmoteEntry === null) {
        playIdle();
        return;
      }
      if (!activeEmoteEntry.loop) queueIdleAfterEmote(activeEmoteEntry);
    },
    setMotionEnabled: (isEnabled) => {
      if (isDisposed || isEnabled === isMotionEnabled) return;

      isMotionEnabled = isEnabled;
      if (isEnabled) {
        playIdle();
        return;
      }

      interruptActiveEmote();
      activeAnimation = null;
      character.state.setEmptyAnimation(
        BODY_TRACK,
        MOTION_DISABLED_MIX_DURATION_SECONDS,
      );
    },
    stopEmote: () => {
      if (isDisposed || activeEmoteEntry === null) return;

      interruptActiveEmote();
      playIdle();
    },
    subscribeToEmoteEvents: (listener) => {
      if (isDisposed) return () => undefined;

      emoteListeners.add(listener);
      return () => {
        emoteListeners.delete(listener);
      };
    },
  };
}
