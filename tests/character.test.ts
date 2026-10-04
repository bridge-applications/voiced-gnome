import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGnomeSpineFaceController } from '../apps/client/src/gnome/gnomeSpineFace';
import { MOUTH_POSES } from '../apps/client/src/gnome/speech';
import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  Physics,
  Skeleton,
  SkeletonJson,
  Skin,
  TextureAtlas,
  type Spine,
} from '@esotericsoftware/spine-pixi-v8';

const root = new URL('../apps/client/public/gnome/', import.meta.url);
const json = JSON.parse(readFileSync(new URL('gnome.json', root), 'utf8'));
const atlas = new TextureAtlas(
  readFileSync(new URL('gnome.atlas', root), 'utf8'),
);
const data = new SkeletonJson(
  new AtlasAttachmentLoader(atlas),
).readSkeletonData(json);

describe('real standalone Spine export', () => {
  it('keeps a newly created preview looking forward just like an initialized character', () => {
    const pupils = (initialized: boolean, scaleY: number) => {
      const skeleton = new Skeleton(data);
      skeleton.scaleY = scaleY;
      skeleton.setSkin(data.defaultSkin);
      skeleton.setupPose();
      if (initialized) skeleton.updateWorldTransform(Physics.pose);
      const state = new AnimationState(new AnimationStateData(data));
      const rig = {
        skeleton,
        state,
        beforeUpdateWorldTransforms: () => undefined,
        afterUpdateWorldTransforms: () => undefined,
      } as unknown as Spine;
      const face = createGnomeSpineFaceController(rig);
      face.setExpression('expressions/dopey_neutral');
      face.setGazeDirection({ horizontal: 0, vertical: 0 });
      state.apply(skeleton);
      rig.beforeUpdateWorldTransforms(rig);
      skeleton.updateWorldTransform(Physics.pose);
      rig.afterUpdateWorldTransforms(rig);
      const result = ['l_pupil', 'r_pupil'].map((name) => {
        const bone = skeleton.findBone(name)!;
        return [bone.appliedPose.worldX, bone.appliedPose.worldY];
      });
      face.dispose();
      return result;
    };
    for (const scaleY of [-1, 1]) {
      const expected = pupils(true, scaleY),
        actual = pupils(false, scaleY);
      actual.forEach((point, i) =>
        point.forEach((value, axis) =>
          expect(value).toBeCloseTo(expected[i]![axis]!, 4),
        ),
      );
    }
  });
  it('contains nine independently selectable speech attachments', () => {
    const slot = data.findSlot('voice_mouth');
    expect(slot?.boneData.name).toBe('mouth_base');
    for (const pose of MOUTH_POSES)
      expect(
        data.defaultSkin?.getAttachment(slot!.index, `speech_${pose}`),
      ).toBeTruthy();
  });
  it('loads every atlas texture from committed local assets', () => {
    for (const page of atlas.pages)
      expect(readFileSync(new URL(page.name, root)).byteLength).toBeGreaterThan(
        0,
      );
  });
  it('poses the equipped character through every included clip without invalid coordinates', () => {
    const skeleton = new Skeleton(data);
    const skin = new Skin('test-outfit');
    for (const item of data.skins) skin.addSkin(item);
    skeleton.setSkin(skin);
    skeleton.setupPoseSlots();
    const state = new AnimationState(new AnimationStateData(data));
    for (const animation of data.animations) {
      skeleton.setupPose();
      state.clearTracks();
      state.setAnimation(0, animation.name, false);
      for (let index = 0; index < 12; index++) {
        const delta = Math.max(animation.duration / 11, 0.01);
        state.update(delta);
        skeleton.update(delta);
        state.apply(skeleton);
        skeleton.updateWorldTransform(Physics.update);
        for (const bone of skeleton.bones)
          expect(
            Number.isFinite(bone.appliedPose.worldX) &&
              Number.isFinite(bone.appliedPose.worldY),
            `${animation.name}:${bone.data.name}`,
          ).toBe(true);
      }
    }
  });
});
