// Use Pixi's precompiled shader/uniform handlers under the production CSP.
import 'pixi.js/unsafe-eval';
import { assetUrl } from '../assetUrl';
import { characterScale } from './framing';
import { carouselPose, carouselMoves, interpolatePose } from './carousel';
import { EMOTES } from '@bridge-applications/voiced-gnome-types';
import { resolveGnomeSpineEmoteFace } from './gnomeSpineEmoteFace';
import { Application, Assets, type Ticker } from 'pixi.js';
import { Spine, Physics, type Skin } from '@esotericsoftware/spine-pixi-v8';
import type {
  CharacterPhase,
  Expression,
  Gesture,
  Outfit,
  SkinColor,
} from '@bridge-applications/voiced-gnome-types';
import { createWardrobeLoader } from './wardrobe';
import { createGnomeSpineFaceController } from './gnomeSpineFace';
import {
  createGnomeSpineBodyController,
  type GnomeSpineEmote,
} from './gnomeSpineBody';
import {
  MOUTH_POSES,
  MouthRelease,
  mouthPose,
  smoothLevel,
  type MouthPose,
} from './speech';

export type NeighbourOutfits = {
  previous: Outfit;
  next: Outfit;
  previousSkinColor?: SkinColor;
  nextSkinColor?: SkinColor;
};
export interface CharacterInput {
  neighbours?: NeighbourOutfits;
  phase: CharacterPhase;
  expression: Expression;
  level: () => number;
  mouth: (level: number) => MouthPose | undefined;
  reducedMotion: boolean;
  outfit: Outfit;
  skinColor?: SkinColor;
}
export interface CharacterRenderer {
  dispose: () => void;
  gesture: (gesture: Gesture) => void;
  stopGesture: () => void;
  slideCharacters: (
    direction: -1 | 1,
    neighbours: NeighbourOutfits,
    signal?: AbortSignal,
  ) => Promise<void>;
  changeOutfit: (
    outfit: Outfit,
    signal?: AbortSignal,
    neighbours?: NeighbourOutfits,
  ) => Promise<void>;
}

// Tint only authored skin surfaces, leaving clothing, eyes, teeth and the
// transparent speech mouths untouched. Match Pebbler Telegram's slot list.
const skinSlots = [
  'body',
  'l_foot',
  'l_leg',
  'r_foot',
  'r_leg',
  'l_forearm',
  'l_hand',
  'l_shoulder',
  'r_forearm',
  'r_hand',
  'r_shoulder',
  'head_base',
  'head_highlight',
  'nose',
  'l_ear',
  'r_ear',
  'l_eyelid_up',
  'r_eyelid_up',
  'eyelid_l_dwn',
  'eyelid_r_dwn',
  'big_happy_l_cheek',
  'big_happy_r_cheek',
  'proud_idiot_l_cheek',
  'proud_idiot_r_cheek',
  'proud_idiot_chin',
];
const gestureAnimations = Object.fromEntries(
  Object.entries(EMOTES).map(([id, emote]) => [id, emote.animation]),
) as Record<Gesture, GnomeSpineEmote>;
const expressions = {
  neutral: 'expressions/dopey_neutral',
  happy: 'expressions/big_happy',
  curious: 'expressions/buffering',
  surprised: 'expressions/surprised',
  proud: 'expressions/proud',
} as const;

export async function createCharacter(
  host: HTMLElement,
  read: () => CharacterInput,
  signal: AbortSignal,
): Promise<CharacterRenderer> {
  const app = new Application();
  let initialized = false;
  let disposed = false;
  let character: Spine | null = null;
  let face: ReturnType<typeof createGnomeSpineFaceController> | null = null;
  let body: ReturnType<typeof createGnomeSpineBodyController> | null = null;
  let observer: ResizeObserver | null = null;
  let outfitVersion = 0;
  type Rig = {
    spine: Spine;
    face: ReturnType<typeof createGnomeSpineFaceController>;
    body: ReturnType<typeof createGnomeSpineBodyController>;
  };
  const neighbours: Rig[] = [];
  let spare: Rig | null = null;
  let carouselMotion: {
    direction: -1 | 1;
    elapsed: number;
    duration: number;
    rigs: Rig[];
    complete: () => void;
    cancel: () => void;
  } | null = null;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    carouselMotion?.cancel();
    observer?.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    signal.removeEventListener('abort', dispose);
    face?.dispose();
    body?.dispose();
    neighbours.forEach(({ face, body }) => {
      face.dispose();
      body.dispose();
    });
    spare?.face.dispose();
    spare?.body.dispose();
    if (initialized) app.destroy({ removeView: true }, { children: true });
  };
  const visibility = () => {
    if (!initialized || disposed) return;
    document.hidden ? app.stop() : app.start();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    await app.init({
      width: host.clientWidth,
      height: host.clientHeight,
      autoStart: false,
      autoDensity: true,
      resolution: Math.min(
        devicePixelRatio || 1,
        matchMedia('(pointer: coarse)').matches ? 1.5 : 2,
      ),
      preference: 'webgl',
      backgroundAlpha: 0,
      antialias: true,
      powerPreference: 'low-power',
    });
    initialized = true;
    if (signal.aborted) {
      app.destroy({ removeView: true }, { children: true });
      throw new DOMException('Cancelled', 'AbortError');
    }
    await Assets.load([
      assetUrl('/gnome/gnome.json'),
      assetUrl('/gnome/gnome.atlas'),
    ]);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    character = Spine.from({
      skeleton: assetUrl('/gnome/gnome.json'),
      atlas: assetUrl('/gnome/gnome.atlas'),
      autoUpdate: false,
    });
    const wardrobe = createWardrobeLoader(character.skeleton.data);
    const skin = await wardrobe(read().outfit);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    character.skeleton.setSkin(skin);
    character.skeleton.setupPoseSlots();
    character.skeleton.updateWorldTransform(Physics.update);
    app.stage.addChild(character);
    face = createGnomeSpineFaceController(character);
    body = createGnomeSpineBodyController(character);
    const mouth = character.skeleton.findSlot('voice_mouth');
    if (!mouth) throw new Error('Missing speech slot');
    const mouthAttachments = Object.fromEntries(
      MOUTH_POSES.map((pose) => {
        const attachment = skin.getAttachment(
          mouth.data.index,
          `speech_${pose}`,
        );
        if (!attachment) throw new Error(`Missing speech pose: ${pose}`);
        return [pose, attachment];
      }),
    );
    const originalMouths = [
      'awkward',
      'proud_idiot_mouth',
      'surprised',
      'big_happy_mouth',
      'buffering',
      'dopey_neutral',
    ].map((name) => character!.skeleton.findSlot(name));
    let level = 0;
    let pose: MouthPose = 'rest';
    const mouthRelease = new MouthRelease();
    let speechActive = false;
    let useRestMouth = true;
    let blinkIn = 2.4;
    let neighbourBlinkIn = 3.8;
    let elapsed = 0;
    let targetScale = 0;
    let stageWidth = 0,
      stageHeight = 0;
    let lastExpression: string | undefined;
    let lastReducedMotion: boolean | undefined;
    const rigColors = new WeakMap<Spine, SkinColor>();
    const installMouth = (spine: Spine, color: SkinColor = null) => {
      rigColors.set(spine, color);
      const tintedSlots = skinSlots.map((name) => {
        const slot = spine.skeleton.findSlot(name);
        if (!slot) throw new Error(`Missing skin surface: ${name}`);
        return slot;
      });
      const afterUpdate = spine.afterUpdateWorldTransforms;
      const originalSlots = originalMouths.map((slot) =>
        slot ? spine.skeleton.findSlot(slot.data.name) : null,
      );
      const speechSlot = spine.skeleton.findSlot('voice_mouth');
      spine.afterUpdateWorldTransforms = (instance) => {
        afterUpdate(instance);
        // Expressions and setup poses may restore slot colors; apply after animation.
        const tint = rigColors.get(spine);
        tintedSlots.forEach((slot) => {
          if (tint) slot.pose.color.setFromString(tint);
          else slot.pose.color.set(1, 1, 1, 1);
        });
        const selected = spine === character;
        if (!selected || speechActive || useRestMouth) {
          originalSlots.forEach((slot) => slot?.pose.setAttachment(null));
          speechSlot?.pose.setAttachment(
            mouthAttachments[selected ? pose : 'rest'] ?? null,
          );
        } else speechSlot?.pose.setAttachment(null);
      };
    };
    installMouth(character, read().skinColor);
    const makePreview = (skin: Skin | null, color?: SkinColor): Rig => {
      const spine = Spine.from({
        skeleton: assetUrl('/gnome/gnome.json'),
        atlas: assetUrl('/gnome/gnome.atlas'),
        autoUpdate: false,
      });
      spine.skeleton.setSkin(skin);
      spine.skeleton.setupPoseSlots();
      const previewFace = createGnomeSpineFaceController(spine);
      const previewBody = createGnomeSpineBodyController(spine);
      previewFace.setExpression('expressions/dopey_neutral');
      installMouth(spine, color);
      app.stage.addChildAt(spine, 0);
      return { spine, face: previewFace, body: previewBody };
    };
    const neighbourOutfits = read().neighbours;
    if (neighbourOutfits) {
      const skins = await Promise.all([
        wardrobe(neighbourOutfits.previous),
        wardrobe(neighbourOutfits.next),
      ]);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      skins.forEach((skin, i) =>
        neighbours.push(
          makePreview(
            skin,
            i === 0
              ? neighbourOutfits.previousSkinColor
              : neighbourOutfits.nextSkinColor,
          ),
        ),
      );
      spare = makePreview(skins[0]!);
      spare.spine.visible = false;
    }
    const applyPose = (rig: Rig, slot: number) => {
      const next = carouselPose(slot, stageWidth, stageHeight);
      rig.spine.position.set(next.x, next.y);
      rig.spine.scale.set(next.scale);
    };
    const frameCharacters = () => {
      if (!character || carouselMotion) return;
      neighbours.forEach((rig, i) => applyPose(rig, i === 0 ? -1 : 1));
      character.position.set(
        stageWidth / 2,
        stageHeight * (neighbours.length ? 0.86 : 0.88),
      );
    };
    const slideCharacters = async (
      direction: -1 | 1,
      adjacent: NeighbourOutfits,
      requestSignal?: AbortSignal,
    ) => {
      if (
        !character ||
        !face ||
        !body ||
        !spare ||
        neighbours.length !== 2 ||
        carouselMotion
      )
        throw new Error('Carousel unavailable');
      const version = ++outfitVersion;
      const skin = await wardrobe(
        direction === 1 ? adjacent.previous : adjacent.next,
      );
      if (
        disposed ||
        signal.aborted ||
        requestSignal?.aborted ||
        version !== outfitVersion
      )
        throw new DOMException('Cancelled', 'AbortError');
      rigColors.set(
        spare.spine,
        (direction === 1
          ? adjacent.previousSkinColor
          : adjacent.nextSkinColor) ?? null,
      );
      spare.spine.skeleton.setSkin(skin);
      spare.spine.skeleton.setupPoseSlots();
      spare.spine.update(0);
      spare.body.stopEmote();
      spare.body.setMotionEnabled(!read().reducedMotion);
      spare.spine.visible = true;
      const centre = { spine: character, face, body };
      const rigs = [neighbours[0]!, centre, neighbours[1]!, spare];
      const oldSpare = spare;
      await new Promise<void>((resolve, reject) => {
        const clear = () => requestSignal?.removeEventListener('abort', cancel);
        const cancel = () => {
          clear();
          carouselMotion = null;
          oldSpare.spine.visible = false;
          if (!disposed) {
            frameCharacters();
            character!.scale.set(characterScale(stageWidth * 0.5, stageHeight));
            app.render();
          }
          host.dataset.carousel = 'idle';
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        const complete = () => {
          clear();
          carouselMotion = null;
          const incoming = direction === 1 ? neighbours[0]! : neighbours[1]!;
          const outgoing = direction === 1 ? neighbours[1]! : neighbours[0]!;
          character = incoming.spine;
          face = incoming.face;
          body = incoming.body;
          if (direction === 1) neighbours.splice(0, 2, oldSpare, centre);
          else neighbours.splice(0, 2, centre, oldSpare);
          spare = outgoing;
          spare.spine.visible = false;
          lastExpression = undefined;
          level = 0;
          pose = 'rest';
          speechActive = false;
          mouthRelease.reset();
          face.setBrowPose({
            left: { raise: 0, tilt: 0 },
            right: { raise: 0, tilt: 0 },
          });
          face.setPupilDilation(0);
          face.setHeadPose({ bob: 0, lean: 0, tilt: 0 });
          centre.face.setExpression('expressions/dopey_neutral');
          centre.face.setHeadPose({ bob: 0, lean: 0, tilt: 0 });
          app.stage.addChild(character);
          character.scale.set(characterScale(stageWidth * 0.5, stageHeight));
          frameCharacters();
          host.dataset.carousel = 'idle';
          app.render();
          resolve();
        };
        requestSignal?.addEventListener('abort', cancel, { once: true });
        const duration = read().reducedMotion ? 0 : 0.44;
        carouselMotion = {
          direction,
          elapsed: 0,
          duration,
          rigs,
          complete,
          cancel,
        };
        host.dataset.carousel =
          direction === 1 ? 'moving-right' : 'moving-left';
        carouselMoves(direction).forEach(({ from }, i) =>
          applyPose(rigs[i]!, from),
        );
        if (duration === 0) complete();
      });
    };
    const resize = () => {
      if (!character || disposed) return;
      const width = host.clientWidth,
        height = host.clientHeight;
      app.renderer.resize(width, height);
      stageWidth = width;
      stageHeight = height;
      // Authored envelopes keep the full motion visible without sampling bounds per frame.
      const scale = characterScale(
        neighbours.length ? width * 0.5 : width,
        height,
        body?.getActiveEmote()?.emote,
      );
      targetScale = scale;
      character.scale.set(scale);
      character.position.set(
        width / 2,
        height * (neighbours.length ? 0.86 : 0.88),
      );
      if (neighbours.length) frameCharacters();
      if (!app.ticker.started) app.render();
    };
    observer = new ResizeObserver(resize);
    observer.observe(host);
    host.appendChild(app.canvas);
    app.canvas.setAttribute('aria-hidden', 'true');
    app.ticker.maxFPS = matchMedia('(pointer: coarse)').matches ? 30 : 60;
    app.ticker.minFPS = 10;
    const tick = (ticker: Ticker) => {
      if (!character || !face || !body) return;
      const input = read();
      const dt = Math.min(0.1, ticker.deltaMS / 1000);
      elapsed += dt;
      targetScale = characterScale(
        neighbours.length ? stageWidth * 0.5 : stageWidth,
        stageHeight,
        body.getActiveEmote()?.emote,
      );
      const scale =
        character.scale.x +
        (targetScale - character.scale.x) * (1 - Math.exp(-dt * 22));
      if (!carouselMotion) character.scale.set(scale);
      if (input.reducedMotion !== lastReducedMotion) {
        body.setMotionEnabled(!input.reducedMotion);
        lastReducedMotion = input.reducedMotion;
        neighbours.forEach(({ body }) =>
          body.setMotionEnabled(!input.reducedMotion),
        );
      }
      const expression =
        input.phase === 'listening' && input.expression === 'neutral'
          ? 'curious'
          : input.expression;
      const emoteFace = input.reducedMotion
        ? null
        : resolveGnomeSpineEmoteFace(
            body.getActiveEmote(),
            body.getActiveEmoteTime(),
          );
      const facialExpression = emoteFace?.expression ?? expressions[expression];
      if (facialExpression !== lastExpression) {
        face.setExpression(facialExpression);
        lastExpression = facialExpression;
      }
      face.setBrowPose(
        emoteFace?.brows ?? {
          left: { raise: 0, tilt: 0 },
          right: { raise: 0, tilt: 0 },
        },
      );
      face.setPupilDilation(emoteFace?.pupils ?? 0);
      host.dataset.skinColor = rigColors.get(character) ?? 'source';
      if (neighbours.length) {
        host.dataset.previousSkinColor =
          rigColors.get(neighbours[0]!.spine) ?? 'source';
        host.dataset.nextSkinColor =
          rigColors.get(neighbours[1]!.spine) ?? 'source';
      }
      host.dataset.emote = body.getActiveEmote()?.emote ?? 'idle';
      // Maintain eye contact, with a small purposeful glance while thinking.
      // The face controller smooths the return to its authored neutral gaze.
      const lookingAway = input.phase === 'thinking' && !input.reducedMotion;
      face.setGazeDirection({
        horizontal: emoteFace?.gaze?.horizontal ?? (lookingAway ? 0.2 : 0),
        vertical: emoteFace?.gaze?.vertical ?? (lookingAway ? 0.12 : 0),
      });
      speechActive = input.phase === 'speaking';
      useRestMouth =
        facialExpression === 'expressions/dopey_neutral' ||
        facialExpression === 'expressions/big_happy';
      if (!speechActive) {
        level = 0;
        pose = 'rest';
        mouthRelease.reset();
      } else {
        const rawLevel = input.level();
        level = smoothLevel(level, rawLevel, dt);
        const timedPose = input.mouth(rawLevel);
        pose = mouthRelease.sample(
          timedPose ?? mouthPose(level, pose),
          rawLevel,
          dt,
        );
        host.dataset.lipSync = timedPose ? 'timed' : 'audio';
      }
      if (!input.reducedMotion) {
        blinkIn -= dt;
        if (blinkIn <= 0) {
          face.blink();
          blinkIn = 3.5 + Math.random() * 2;
        }
        face.setHeadPose({
          bob:
            input.phase === 'speaking'
              ? Math.sin(elapsed * 3) * level * 0.4
              : 0,
          lean: input.phase === 'listening' ? 0.15 : 0,
          tilt: input.phase === 'thinking' ? 0.25 : 0,
        });
      } else face.setHeadPose({ bob: 0, lean: 0, tilt: 0 });
      neighbourBlinkIn -= dt;
      const blinkNeighbours = !input.reducedMotion && neighbourBlinkIn <= 0;
      if (blinkNeighbours) neighbourBlinkIn = 4.5;
      neighbours.forEach(({ spine, face }) => {
        if (blinkNeighbours) face.blink();
        spine.update(dt);
      });
      if (carouselMotion && spare) spare.spine.update(dt);
      character.update(dt);
      if (carouselMotion) {
        const motion = carouselMotion;
        motion.elapsed += dt;
        const progress = input.reducedMotion
          ? 1
          : Math.min(1, motion.elapsed / motion.duration);
        const eased = progress * progress * (3 - 2 * progress);
        carouselMoves(motion.direction).forEach(({ from, to }, i) => {
          const pose = interpolatePose(
            carouselPose(from, stageWidth, stageHeight),
            carouselPose(to, stageWidth, stageHeight),
            eased,
          );
          const rig = motion.rigs[i]!;
          rig.spine.position.set(pose.x, pose.y);
          rig.spine.scale.set(pose.scale);
        });
        if (progress >= 1) motion.complete();
      }
      if (host.dataset.mouth !== pose) host.dataset.mouth = pose;
    };
    app.ticker.add(tick);
    document.addEventListener('visibilitychange', visibility);
    resize();
    visibility();
    return {
      dispose,
      slideCharacters,
      changeOutfit: async (selection, requestSignal, adjacent) => {
        const version = ++outfitVersion;
        const [next, beforeSkin, afterSkin] = await Promise.all([
          wardrobe(selection),
          adjacent ? wardrobe(adjacent.previous) : undefined,
          adjacent ? wardrobe(adjacent.next) : undefined,
        ]);
        if (
          disposed ||
          signal.aborted ||
          requestSignal?.aborted ||
          version !== outfitVersion
        )
          throw new DOMException('Cancelled', 'AbortError');
        character!.skeleton.setSkin(next);
        character!.skeleton.setupPoseSlots();
        if (beforeSkin && afterSkin)
          neighbours.forEach(({ spine }, i) => {
            spine.skeleton.setSkin(i === 0 ? beforeSkin : afterSkin);
            spine.skeleton.setupPoseSlots();
            spine.update(0);
          });
        character!.update(0);
        app.render();
      },
      stopGesture: () => body?.stopEmote(),
      gesture: (gesture) =>
        body?.playEmote(gestureAnimations[gesture], { playbackMode: 'once' }),
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
