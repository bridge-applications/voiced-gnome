import { EMOTES } from '@bridge-applications/voiced-gnome-types';
import { characterScale } from '../apps/client/src/gnome/framing';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Assets } from 'pixi.js';
import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  Physics,
  Skeleton,
  SkeletonJson,
  TextureAtlas,
} from '@esotericsoftware/spine-pixi-v8';
import {
  DEFAULT_OUTFIT,
  OUTFIT_LOOKS,
  OutfitToolSchema,
  WARDROBE_ITEMS,
  resolveOutfit,
} from '../packages/types/src/wardrobe';
import { createWardrobeLoader } from '../apps/client/src/gnome/wardrobe';
vi.mock('pixi.js', () => ({ Assets: { load: vi.fn() } }));
const root = new URL('../apps/client/public/', import.meta.url);
const loadAsset = (path: string) =>
  path.endsWith('.json')
    ? JSON.parse(readFileSync(new URL('.' + path, root), 'utf8'))
    : new TextureAtlas(readFileSync(new URL('.' + path, root), 'utf8'));
const createData = () =>
  new SkeletonJson(
    new AtlasAttachmentLoader(loadAsset('/gnome/gnome.atlas') as TextureAtlas),
  ).readSkeletonData(loadAsset('/gnome/gnome.json'));
describe('wardrobe requests', () => {
  it('keeps unspecified pieces for a single-item change', () => {
    expect(
      resolveOutfit(
        { look: 'custom', glasses: 'gold_sunglasses' },
        DEFAULT_OUTFIT,
      ),
    ).toEqual({ ...DEFAULT_OUTFIT, glasses: 'gold_sunglasses' });
  });
  it('preserves an explicit current piece even with a complete look', () => {
    expect(
      resolveOutfit({ look: 'dragon', footwear: 'keep' }, DEFAULT_OUTFIT),
    ).toEqual({
      ...OUTFIT_LOOKS.dragon.outfit,
      footwear: DEFAULT_OUTFIT.footwear,
    });
  });
  it('removes optional headwear and glasses', () => {
    expect(
      resolveOutfit(
        { look: 'custom', headwear: 'none', glasses: 'none' },
        DEFAULT_OUTFIT,
      ),
    ).toEqual({ ...DEFAULT_OUTFIT, headwear: null, glasses: null });
  });
  it.each([
    { look: 'unknown' },
    { look: 'custom', shirt: 'none' },
    { look: 'custom', headwear: '../../file' },
    { look: 'custom', extra: true },
  ])('rejects unsupported requests %j', (request) => {
    expect(OutfitToolSchema.safeParse(request).success).toBe(false);
  });
});
describe('real wardrobe skins on the animated rig', () => {
  it('loads all available pieces and validates their local texture pages', async () => {
    vi.mocked(Assets.load).mockImplementation(async (path: unknown) =>
      loadAsset(path as string),
    );
    const data = createData();
    const load = createWardrobeLoader(data);
    const mouth = data.defaultSkin!.getAttachment(
      data.findSlot('voice_mouth')!.index,
      'speech_rest',
    );
    for (const [category, items] of Object.entries(WARDROBE_ITEMS))
      for (const item of Object.keys(items)) {
        const outfit = resolveOutfit(
          OutfitToolSchema.parse({ look: 'custom', [category]: item }),
          DEFAULT_OUTFIT,
        );
        const skin = await load(outfit);
        expect(
          skin.getAttachment(
            data.findSlot('voice_mouth')!.index,
            'speech_rest',
          ),
        ).toBe(mouth);
        const name = items[item]!.skin.replace('/', '-');
        const atlas = loadAsset(
          '/gnome/wardrobe/pebbler_gnome-' + name + '.atlas',
        ) as TextureAtlas;
        for (const page of atlas.pages)
          expect(
            readFileSync(new URL('./gnome/wardrobe/' + page.name, root))
              .byteLength,
          ).toBeGreaterThan(0);
      }
    expect(data.skins.length).toBe(47);
    const skeleton = new Skeleton(data);
    const state = new AnimationState(new AnimationStateData(data));
    for (const look of Object.values(OUTFIT_LOOKS)) {
      skeleton.setSkin(await load(look.outfit));
      skeleton.setupPoseSlots();
      for (const animation of data.animations) {
        state.clearTracks();
        state.setAnimation(0, animation.name, false);
        skeleton.setupPose();
        for (let frame = 0; frame < 16; frame++) {
          const delta = Math.max(animation.duration / 15, 0.01);
          state.update(delta);
          skeleton.update(delta);
          state.apply(skeleton);
          skeleton.updateWorldTransform(Physics.update);
          if (
            Object.values(EMOTES).some(
              (emote) => emote.animation === animation.name,
            )
          ) {
            const bounds = skeleton.getBoundsRect();
            for (const [width, height] of [
              [320, 410],
              [386, 410],
              [760, 528],
            ]) {
              const scale = characterScale(width!, height!, animation.name);
              const label = `${animation.name}, ${width}px`;
              expect(
                width! / 2 + bounds.x * scale,
                label,
              ).toBeGreaterThanOrEqual(0);
              expect(
                width! / 2 + (bounds.x + bounds.width) * scale,
                label,
              ).toBeLessThanOrEqual(width!);
              expect(
                height! * 0.88 + bounds.y * scale,
                label,
              ).toBeGreaterThanOrEqual(0);
              expect(
                height! * 0.88 + (bounds.y + bounds.height) * scale,
                label,
              ).toBeLessThanOrEqual(height!);
            }
          }
          for (const bone of skeleton.bones)
            expect(
              Number.isFinite(bone.appliedPose.worldX) &&
                Number.isFinite(bone.appliedPose.worldY),
            ).toBe(true);
        }
      }
    }
    const count = vi.mocked(Assets.load).mock.calls.length;
    await load(OUTFIT_LOOKS.dragon.outfit);
    expect(vi.mocked(Assets.load).mock.calls.length).toBe(count);
  });
  it('retries failed loads without replacing the existing skeleton skin', async () => {
    const data = createData();
    const load = createWardrobeLoader(data);
    const skeleton = new Skeleton(data);
    skeleton.setSkin(await load(DEFAULT_OUTFIT));
    const old = skeleton.skin;
    vi.mocked(Assets.load).mockRejectedValueOnce(new Error('offline'));
    await expect(load(OUTFIT_LOOKS.pirate.outfit)).rejects.toThrow('offline');
    expect(skeleton.skin).toBe(old);
    vi.mocked(Assets.load).mockImplementation(async (path: unknown) =>
      loadAsset(path as string),
    );
    expect(await load(OUTFIT_LOOKS.pirate.outfit)).toBeTruthy();
    expect(skeleton.skin).toBe(old);
  });
});
