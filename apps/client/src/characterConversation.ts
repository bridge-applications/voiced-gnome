import {
  ApiErrorSchema,
  CharacterSessionSchema,
} from '@bridge-applications/voiced-gnome-types';
export type CharacterMessage = {
  id: number;
  role: 'user' | 'agent';
  text: string;
};
import { demoAccess } from './demoAccess';
export async function characterSession(
  characterId: string,
  signal: AbortSignal,
) {
  const response = await demoAccess.request(
    '/api/characters/session',
    { characterId },
    signal,
  );
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = ApiErrorSchema.safeParse(body);
    throw new Error(
      error.success
        ? error.data.error.message
        : 'The character could not connect. Please try again.',
    );
  }
  const session = CharacterSessionSchema.parse(body);
  if (session.characterId !== characterId)
    throw new Error('The wrong character connected. Please try again.');
  return session;
}
export function conversationHistory(messages: CharacterMessage[]) {
  // Keep whole recent messages; never send a different character's transcript.
  const recent: CharacterMessage[] = [];
  let length = 0;
  for (const message of messages.slice(-20).reverse()) {
    if (length + message.text.length > 10000) break;
    recent.unshift(message);
    length += message.text.length;
  }
  return recent.length
    ? JSON.stringify(recent.map(({ role, text }) => ({ role, text })))
    : 'No previous conversation.';
}
export function speechChunks(text: string, limit = 360): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const prefix = remaining.slice(0, limit);
    let boundary = Math.max(
      prefix.lastIndexOf('. '),
      prefix.lastIndexOf('! '),
      prefix.lastIndexOf('? '),
    );
    if (boundary >= limit / 3) boundary++;
    else boundary = prefix.lastIndexOf(' ');
    if (boundary < 1) boundary = limit;
    chunks.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
