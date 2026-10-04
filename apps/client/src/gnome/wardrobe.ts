import { assetUrl } from '../assetUrl';
import { Assets } from 'pixi.js';
import {
  AtlasAttachmentLoader,
  ClippingAttachment,
  SkeletonJson,
  Skin,
  type SkeletonData,
  type TextureAtlas,
} from '@esotericsoftware/spine-pixi-v8';
import {
  WARDROBE_CATEGORIES,
  WARDROBE_ITEMS,
  OutfitSchema,
  type Outfit,
} from '@bridge-applications/voiced-gnome-types';

// Clothing is installed into the existing rig. Default attachments and animation
// identities stay intact, so eyes, mouth, expression and gestures keep running.
export function createWardrobeLoader(data: SkeletonData) {
  const pending = new Map<string, Promise<Skin>>();
  const load = (name: string): Promise<Skin> => {
    const existing = data.findSkin(name);
    if (existing) return Promise.resolve(existing);
    const cached = pending.get(name);
    if (cached) return cached;
    const base = assetUrl(`/gnome/wardrobe/${name.replace('/', '-')}`);
    const promise = Promise.all([
      Assets.load(base + '.json'),
      Assets.load(
        assetUrl(
          `/gnome/wardrobe/pebbler_gnome-${name.replace('/', '-')}.atlas`,
        ),
      ),
    ])
      .then(([json, atlas]) => {
        const source = new SkeletonJson(
          new AtlasAttachmentLoader(atlas as TextureAtlas),
        ).readSkeletonData(json);
        if (
          source.bones.length !== data.bones.length ||
          source.slots.length !== data.slots.length ||
          source.bones.some((bone, i) => bone.name !== data.bones[i]!.name) ||
          source.slots.some((slot, i) => slot.name !== data.slots[i]!.name)
        )
          throw new Error('Clothing does not match this character.');
        const skin = source.findSkin(name);
        if (!skin) throw new Error('Clothing skin is missing.');
        skin.bones = skin.bones.map((bone) => data.bones[bone.index]!);
        skin.constraints = skin.constraints.map((constraint) => {
          const target = data.constraints.find(
            (item) => item.name === constraint.name,
          );
          if (!target) throw new Error('Clothing constraint is missing.');
          return target;
        });
        for (const { attachment } of skin.getAttachments())
          if (attachment instanceof ClippingAttachment && attachment.endSlot)
            attachment.endSlot = data.slots[attachment.endSlot.index]!;
        data.skins.push(skin);
        return skin;
      })
      .catch((error) => {
        pending.delete(name);
        throw error;
      });
    pending.set(name, promise);
    return promise;
  };
  return async (selection: Outfit): Promise<Skin> => {
    const outfit = OutfitSchema.parse(selection);
    const names = [
      'beard/beard_001',
      ...WARDROBE_CATEGORIES.flatMap((category) => {
        const id = outfit[category];
        return id === null ? [] : [WARDROBE_ITEMS[category][id]!.skin];
      }),
    ];
    const pieces = await Promise.all(names.map(load));
    if (!data.defaultSkin) throw new Error('Character base skin is missing.');
    const skin = new Skin('voice-outfit');
    skin.addSkin(data.defaultSkin);
    pieces.forEach((piece) => skin.addSkin(piece));
    return skin;
  };
}
