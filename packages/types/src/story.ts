import { z } from 'zod';
import { ExpressionSchema, GestureSchema } from './character.js';
import { OUTFIT_LOOKS } from './wardrobe.js';
export const SpeakerSchema = z.enum(['Narrator', 'Hero', 'Friend']);
export type Speaker = z.infer<typeof SpeakerSchema>;
export const StoryChoiceSchema = z
  .object({ topic: z.string().trim().min(3).max(240) })
  .strict();
export const HeroNameSchema = z
  .object({ name: z.string().trim().min(1).max(40) })
  .strict();
export const ActorSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    look: z.enum(
      Object.keys(OUTFIT_LOOKS) as [
        keyof typeof OUTFIT_LOOKS,
        ...Array<keyof typeof OUTFIT_LOOKS>,
      ],
    ),
    personality: z.string().min(1).max(180),
  })
  .strict();
export const StoryTurnSchema = z
  .object({
    speaker: SpeakerSchema,
    text: z.string().trim().min(1).max(360),
    expression: ExpressionSchema,
    gesture: GestureSchema.optional(),
  })
  .strict();
export const StorySchema = z
  .object({
    title: z.string().min(1).max(100),
    cast: z
      .object({ Narrator: ActorSchema, Hero: ActorSchema, Friend: ActorSchema })
      .strict(),
    turns: z.array(StoryTurnSchema).min(9).max(14),
  })
  .strict()
  .superRefine((story, ctx) => {
    if (story.turns.reduce((n, t) => n + t.text.length, 0) > 3000)
      ctx.addIssue({ code: 'custom', message: 'Story is too long.' });
    for (const speaker of SpeakerSchema.options)
      if (!story.turns.some((t) => t.speaker === speaker))
        ctx.addIssue({
          code: 'custom',
          message: `Missing dialogue for ${speaker}.`,
        });
    if (
      new Set(Object.values(story.cast).map((a) => a.name.toLowerCase()))
        .size !== 3
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Characters need distinct names.',
      });
    if (new Set(Object.values(story.cast).map((a) => a.look)).size !== 3)
      ctx.addIssue({
        code: 'custom',
        message: 'Characters need distinct looks.',
      });
  });
export type Story = z.infer<typeof StorySchema>;
export type StoryTurn = z.infer<typeof StoryTurnSchema>;
export const StorySpeechSchema = z
  .object({ speaker: SpeakerSchema, text: z.string().trim().min(1).max(360) })
  .strict();
export const StorySessionRequestSchema = z
  .object({ purpose: z.enum(['plan', 'setup', 'question']) })
  .strict();
export const StorySessionSchema = z.object({
  signedUrl: z
    .string()
    .url()
    .max(8000)
    .refine((url) => {
      const u = new URL(url);
      return u.protocol === 'wss:' && u.hostname === 'api.elevenlabs.io';
    }),
  maxSessionSeconds: z.number().int().positive(),
});
export const STORY_VOICES: Record<Speaker, string> = {
  Narrator: 'nPczCjzI2devNBz1zQrb',
  Hero: 'JBFqnCBsd6RMkjVDRZzb',
  Friend: 'TX3LPaxmHKxFdv7VOQHJ',
};
export function revealedStory(story: Story, turn: number, spokenText = '') {
  return {
    title: story.title,
    cast: story.cast,
    heard: story.turns.slice(0, Math.max(0, turn)),
    currentLine: spokenText,
    currentSpeaker: story.turns[turn]?.speaker ?? 'Narrator',
  };
}
