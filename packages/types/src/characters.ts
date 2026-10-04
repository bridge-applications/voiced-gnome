import { z } from 'zod';
import catalog from './characters.json';
import { GestureSchema } from './character.js';
import { OutfitSchema, OUTFIT_LOOKS } from './wardrobe.js';
import { StorySessionSchema } from './story.js';
// Existing Pebbler Telegram skin palette; null preserves the original artwork.
export const SKIN_COLORS = {
  source: null,
  skin_01: '#f9d8c8',
  skin_02: '#fdbaa8',
  skin_03: '#e2b193',
  skin_04: '#d6a56b',
  skin_05: '#855e4a',
  skin_06: '#573936',
  skin_07: '#b07cbe',
} as const;
export type SkinColor = (typeof SKIN_COLORS)[keyof typeof SKIN_COLORS];
const CharacterSchema = z
  .object({
    id: z.string().regex(/^[a-z_]+$/),
    name: z.string().max(40),
    role: z.string().max(80),
    look: z.string(),
    skinColorId: z.enum(
      Object.keys(SKIN_COLORS) as [
        keyof typeof SKIN_COLORS,
        ...(keyof typeof SKIN_COLORS)[],
      ],
    ),
    voiceId: z.string().min(1).max(40),
    voiceName: z.string(),
    tagline: z.string().max(160),
    backstory: z.string().max(800),
    personality: z.string().max(400),
    greetingEmote: GestureSchema,
    starter: z.string().max(200),
    introduction: z.string().max(250),
  })
  .strict();
export const CHARACTERS = catalog.map((entry) => {
  const character = CharacterSchema.parse(entry);
  const look = OUTFIT_LOOKS[character.look as keyof typeof OUTFIT_LOOKS];
  if (!look) throw new Error('Missing character outfit');
  return {
    ...character,
    skinColor: SKIN_COLORS[character.skinColorId],
    outfit: OutfitSchema.parse(look.outfit),
  };
});
export type GnomeCharacter = (typeof CHARACTERS)[number];
export const CharacterIdSchema = z.enum(
  CHARACTERS.map((c) => c.id) as [string, ...string[]],
);
export function getCharacter(id: string) {
  return CHARACTERS.find((c) => c.id === id);
}
export const CharacterSessionRequestSchema = z
  .object({ characterId: CharacterIdSchema })
  .strict();
export const CharacterSpeechSchema = z
  .object({
    characterId: CharacterIdSchema,
    text: z.string().trim().min(1).max(360),
  })
  .strict();
export const CharacterSessionSchema = StorySessionSchema.extend({
  characterId: CharacterIdSchema,
  voiceId: z.string().min(1).max(40),
});
