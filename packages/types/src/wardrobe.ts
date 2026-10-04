import { z } from 'zod';
import catalog from './wardrobe-catalog.json';

export const WARDROBE_CATEGORIES = [
  'headwear',
  'glasses',
  'shirt',
  'pants',
  'footwear',
] as const;
export type WardrobeCategory = (typeof WARDROBE_CATEGORIES)[number];
export interface WardrobeItem {
  label: string;
  skin: string;
}
export const WARDROBE_ITEMS: Record<
  WardrobeCategory,
  Record<string, WardrobeItem>
> = catalog.items;
const choices = (category: WardrobeCategory, extra: string[] = []) =>
  z.enum([...Object.keys(WARDROBE_ITEMS[category]), ...extra] as [
    string,
    ...string[],
  ]);
export const OutfitSchema = z
  .object({
    headwear: choices('headwear').nullable(),
    glasses: choices('glasses').nullable(),
    shirt: choices('shirt'),
    pants: choices('pants'),
    footwear: choices('footwear'),
  })
  .strict();
export type Outfit = z.infer<typeof OutfitSchema>;
export const OUTFIT_LOOKS = Object.fromEntries(
  Object.entries(catalog.looks).map(([id, look]) => [
    id,
    { label: look.label, outfit: OutfitSchema.parse(look.outfit) },
  ]),
) as Record<keyof typeof catalog.looks, { label: string; outfit: Outfit }>;
export type OutfitLook = keyof typeof OUTFIT_LOOKS;
export const DEFAULT_OUTFIT = OUTFIT_LOOKS.classic.outfit;
export const OutfitToolSchema = z
  .object({
    look: z.enum(['custom', ...Object.keys(OUTFIT_LOOKS)] as [
      string,
      ...string[],
    ]),
    headwear: choices('headwear', ['keep', 'none']).optional(),
    glasses: choices('glasses', ['keep', 'none']).optional(),
    shirt: choices('shirt', ['keep']).optional(),
    pants: choices('pants', ['keep']).optional(),
    footwear: choices('footwear', ['keep']).optional(),
  })
  .strict();
export type OutfitRequest = z.infer<typeof OutfitToolSchema>;
export const WardrobeToolSchema = z.object({}).strict();

export function resolveOutfit(request: OutfitRequest, current: Outfit): Outfit {
  const result = {
    ...(request.look === 'custom'
      ? current
      : OUTFIT_LOOKS[request.look as OutfitLook].outfit),
  };
  for (const category of WARDROBE_CATEGORIES) {
    const value = request[category];
    if (value !== undefined) {
      const next =
        value === 'keep' ? current[category] : value === 'none' ? null : value;
      // Validate the complete selection below, including non-removable clothing.
      Object.assign(result, { [category]: next });
    }
  }
  return OutfitSchema.parse(result);
}
export function outfitLabel(outfit: Outfit): string {
  return (
    Object.values(OUTFIT_LOOKS).find((look) =>
      WARDROBE_CATEGORIES.every(
        (category) => look.outfit[category] === outfit[category],
      ),
    )?.label ?? 'Your own mix'
  );
}
export function wardrobeSnapshot(outfit: Outfit) {
  return {
    current: outfit,
    currentLook: outfitLabel(outfit),
    looks: Object.fromEntries(
      Object.entries(OUTFIT_LOOKS).map(([id, look]) => [id, look.label]),
    ),
    items: Object.fromEntries(
      WARDROBE_CATEGORIES.map((category) => [
        category,
        Object.fromEntries(
          Object.entries(WARDROBE_ITEMS[category]).map(([id, item]) => [
            id,
            item.label,
          ]),
        ),
      ]),
    ),
    instructions:
      'Use a named look for a whole outfit, or look=custom to change individual pieces. Unspecified pieces stay unchanged for custom. Explicit keep preserves that current piece even with a named look. Only headwear and glasses allow none. The white beard stays on.',
  };
}
