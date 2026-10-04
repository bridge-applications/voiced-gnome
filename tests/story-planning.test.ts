import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conversation } from '@elevenlabs/react';
import { createStory } from '../apps/client/src/storyApi';
vi.mock('@elevenlabs/react', () => ({
  Conversation: { startSession: vi.fn() },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function startup() {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      signedUrl: 'wss://api.elevenlabs.io/v1/convai/conversation?test=1',
      maxSessionSeconds: 180,
    }),
  );
  vi.mocked(Conversation.startSession).mockImplementation(
    () => new Promise(() => undefined),
  );
  const abort = new AbortController();
  const result = createStory('A friendly dragon', 'Pip', abort.signal);
  return { abort, result };
}
describe('story planning cancellation', () => {
  it('cancels during connection startup and closes a late-created session', async () => {
    const { abort, result } = startup();
    await vi.waitFor(() =>
      expect(Conversation.startSession).toHaveBeenCalledOnce(),
    );
    const rejected = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    });
    abort.abort();
    await rejected;
    const connection = { endSession: vi.fn(async () => undefined) };
    const options = vi.mocked(Conversation.startSession).mock.calls[0]![0];
    options.onConversationCreated?.(connection as never);
    expect(connection.endSession).toHaveBeenCalledOnce();
  });
  it('times out a stalled startup rather than leaving generation pending', async () => {
    vi.useFakeTimers();
    const { result } = startup();
    const rejected = expect(result).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(60001);
    await rejected;
  });
});
