import { z } from 'zod';

export const DEFAULT_SESSION_SECONDS = 180;
export const ConfigSchema = z.object({
  liveAvailable: z.boolean(),
  maxSessionSeconds: z.number().int().min(30).max(DEFAULT_SESSION_SECONDS),
  storyAvailable: z.boolean().optional(),
  charactersAvailable: z.boolean().optional(),
  verification: z
    .object({ required: z.boolean(), siteKey: z.string().optional() })
    .optional(),
});
export const SessionSchema = z.object({
  conversationToken: z.string().min(1).max(16000),
  conversationId: z.string().optional(),
  maxSessionSeconds: z.number().int().min(30).max(DEFAULT_SESSION_SECONDS),
});
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type AppConfig = z.infer<typeof ConfigSchema>;
export type Session = z.infer<typeof SessionSchema>;

export * from './wardrobe.js';

export * from './story.js';

export * from './character.js';

export * from './characters.js';

export const DemoSessionSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}\.\d{13}\.[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive(),
});
