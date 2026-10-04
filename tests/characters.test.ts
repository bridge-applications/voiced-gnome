import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTERS,
  EMOTES,
  CharacterSpeechSchema,
  getCharacter,
} from '@bridge-applications/voiced-gnome-types';
import { handleRequest } from '../apps/worker/src/index';
import {
  conversationHistory,
  speechChunks,
} from '../apps/client/src/characterConversation';
import { testEnv as env, paidRequest as request } from './demo-env';
afterEach(() => vi.unstubAllGlobals());
describe('character conversations', () => {
  it('provides distinct identities and wardrobes with male voices and available greeting animations', () => {
    expect(CHARACTERS.length).toBeGreaterThanOrEqual(18);
    for (const field of ['id', 'name', 'look'] as const)
      expect(new Set(CHARACTERS.map((c) => c[field])).size).toBe(
        CHARACTERS.length,
      );
    // These stock voices were checked against ElevenLabs' male labels.
    const maleVoices = new Set([
      'JBFqnCBsd6RMkjVDRZzb',
      'IKne3meq5aSn9XLyUdCD',
      'nPczCjzI2devNBz1zQrb',
      'pqHfZKP75CvOlQylNhV4',
      'TX3LPaxmHKxFdv7VOQHJ',
      'pNInz6obpgDQGcFmaJgB',
      'iP95p4xoKVk53GoZ742B',
      'SOYHLrjzK2X1ezoPC6cr',
      'onwK4e9ZLuTAKqWW03F9',
      'bIHbv24MWmeRgasZH58o',
      'cjVigY5qzO86Huf0OWal',
      'N2lVS1w4EtoT3dr4eOWO',
      'CwhRBWXzGAHq8TQ4Fs17',
    ]);
    expect(new Set(CHARACTERS.map((c) => c.voiceId)).size).toBe(13);
    for (const c of CHARACTERS) {
      expect(maleVoices.has(c.voiceId), c.name).toBe(true);
      expect(getCharacter(c.id)).toBe(c);
      expect(EMOTES[c.greetingEmote]).toBeTruthy();
      expect(c.backstory.length).toBeGreaterThan(80);
    }
  });
  it('preserves a long reply across bounded speech chunks', () => {
    const text =
      'One fine morning, a little gnome found a talking hat. It asked him for directions! '
        .repeat(20)
        .trim();
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toBe(text);
    for (const chunk of chunks)
      expect(
        CharacterSpeechSchema.safeParse({ characterId: 'pip', text: chunk })
          .success,
      ).toBe(true);
    const word = 'a'.repeat(800);
    expect(speechChunks(word).join('')).toBe(word);
  });
  it('includes only recent whole messages in reconnect context', () => {
    const messages = Array.from({ length: 40 }, (_, id) => ({
      id,
      role: 'user' as const,
      text: String(id) + 'x'.repeat(1000),
    }));
    const context = JSON.parse(conversationHistory(messages));
    expect(context.length).toBeLessThan(20);
    expect(context.at(-1).text).toBe(messages.at(-1)!.text);
    expect(context[0].id).toBeUndefined();
    expect(conversationHistory([])).toBe('No previous conversation.');
  });
  it('pins the selected voice and configured agent on the server', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?token=test',
      }),
    );
    const response = await handleRequest(
      request('session', { characterId: 'ember' }),
      env(),
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      characterId: 'ember',
      voiceId: getCharacter('ember')!.voiceId,
      maxSessionSeconds: 180,
    });
    expect(String(fetcher.mock.calls[0]![0])).toContain('agent_id=characters');
  });
  it('refuses unapproved origins, unknown characters and arbitrary voice overrides', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      (
        await handleRequest(
          request('session', { characterId: 'pip' }, 'https://other.example'),
          env(),
          fetcher,
        )
      ).status,
    ).toBe(403);
    for (const body of [
      { characterId: 'unknown' },
      { characterId: 'pip', voiceId: 'arbitrary' },
    ])
      expect(
        (await handleRequest(request('session', body), env(), fetcher)).status,
      ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds messages and rejects cost-bearing requests when throttled', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      (
        await handleRequest(
          request('speech', { characterId: 'pip', text: 'a'.repeat(361) }),
          env(),
          fetcher,
        )
      ).status,
    ).toBe(400);
    const limited = env();
    limited.SESSION_RATE_LIMITER.limit = vi.fn(async () => ({
      success: false,
    }));
    const response = await handleRequest(
      request('session', { characterId: 'pip' }),
      limited,
      fetcher,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the selected stock voice for timestamped speech', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('{"audio_base64":"AA=="}\n'),
    );
    const response = await handleRequest(
      request('speech', { characterId: 'olive', text: 'Hello there.' }),
      env(),
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({
      model_id: 'eleven_v4_turbo',
      inputs: [
        { text: 'Hello there.', voice_id: getCharacter('olive')!.voiceId },
      ],
    });
  });
  it('refuses unsafe session destinations and does not expose provider errors', async () => {
    const unsafe = vi.fn<typeof fetch>(async () =>
      Response.json({ signed_url: 'wss://other.example/token' }),
    );
    const response = await handleRequest(
      request('session', { characterId: 'pip' }),
      env(),
      unsafe,
    );
    expect(response.status).toBe(502);
    const failed = vi.fn<typeof fetch>(
      async () => new Response('private-test-key', { status: 401 }),
    );
    expect(
      await (
        await handleRequest(
          request('session', { characterId: 'pip' }),
          env(),
          failed,
        )
      ).text(),
    ).not.toContain('private-test-key');
  });
});
