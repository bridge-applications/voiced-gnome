import { Conversation } from '@elevenlabs/react';
import {
  StorySchema,
  StorySessionSchema,
  type Story,
} from '@bridge-applications/voiced-gnome-types';
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export async function storySession(
  purpose: 'plan' | 'setup' | 'question',
  signal: AbortSignal,
) {
  const response = await fetch(base + '/api/story/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose }),
    signal,
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Please wait a minute before starting another conversation.'
        : 'The story connection is unavailable. Please try again.',
    );
  return StorySessionSchema.parse(await response.json());
}
export async function createStory(
  topic: string,
  name: string,
  signal: AbortSignal,
): Promise<Story> {
  const session = await storySession('plan', signal);
  let connection:
    Awaited<ReturnType<typeof Conversation.startSession>> | undefined;
  let received = false;
  let closed = false;
  let resolve!: (story: Story) => void, reject!: (cause: Error) => void;
  const result = new Promise<Story>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Attach a handler before connection startup so an early abort cannot produce an unhandled rejection.
  void result.catch(() => undefined);
  const cancel = () => {
    reject(new DOMException('Cancelled', 'AbortError'));
    void connection?.endSession().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(
    () => reject(new Error('The storyteller took too long. Please try again.')),
    60000,
  );
  try {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const startup = Conversation.startSession({
      signedUrl: session.signedUrl,
      textOnly: true,
      onConversationCreated: (c) => {
        connection = c;
        if (signal.aborted || closed)
          void c.endSession().catch(() => undefined);
      },
      onError: () =>
        reject(
          new Error('The storyteller lost its connection. Please try again.'),
        ),
      onDisconnect: () => {
        if (!received)
          reject(
            new Error(
              'The storyteller disconnected before finishing. Please retry.',
            ),
          );
      },
      clientTools: {
        publish_story: (parameters) => {
          const parsed = StorySchema.safeParse(parameters);
          if (!parsed.success)
            return 'Invalid story. Use 9–14 turns, all three speakers, distinct names and looks, at most 3000 characters total and 360 per turn. Retry publish_story once.';
          if (parsed.data.cast.Hero.name !== name)
            return (
              'Use exactly the hero name ' +
              JSON.stringify(name) +
              ' and retry.'
            );
          received = true;
          resolve(parsed.data);
          return 'Story received. Thank you.';
        },
      },
    });
    connection = await Promise.race([
      startup,
      result.then(() => new Promise<never>(() => undefined)),
    ]);
    connection.sendUserMessage(
      'Create the complete story now. Subject: ' +
        JSON.stringify(topic) +
        '. Main character name: ' +
        JSON.stringify(name) +
        '. Call publish_story with the complete script.',
    );
    const story = await result;
    await new Promise<void>((r) => setTimeout(r, 100));
    return story;
  } finally {
    closed = true;
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
    await connection?.endSession().catch(() => undefined);
  }
}
