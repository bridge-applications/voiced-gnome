import { testEnv } from './demo-env';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StorySchema,
  revealedStory,
  type Story,
} from '@bridge-applications/voiced-gnome-types';
import { handleRequest } from '../apps/worker/src/index';
import {
  loadStoryClip,
  sentenceResumeTime,
  StoryPlayer,
} from '../apps/client/src/storyAudio';
const story: Story = {
  title: 'The little island',
  cast: {
    Narrator: { name: 'Moss', look: 'classic', personality: 'Warm' },
    Hero: { name: 'Pip', look: 'pirate', personality: 'Curious' },
    Friend: { name: 'Fern', look: 'dragon', personality: 'Kind' },
  },
  turns: Array.from({ length: 9 }, (_, i) => ({
    speaker: (['Narrator', 'Hero', 'Friend'] as const)[i % 3]!,
    text: 'Hello. A new adventure!',
    expression: 'happy' as const,
  })),
};
const chars = Array.from('Hello. Again!', (text, i) => ({
  text,
  start: i * 0.1,
  end: (i + 1) * 0.1,
}));
const clipBody = () =>
  JSON.stringify({
    audio_base64: 'AA==',
    alignment: {
      characters: chars.map((c) => c.text),
      character_start_times_seconds: chars.map((c) => c.start),
      character_end_times_seconds: chars.map((c) => c.end),
    },
  }) + '\n';
afterEach(() => vi.unstubAllGlobals());
describe('story boundaries', () => {
  it('requires three distinct named and dressed speaking characters', () => {
    expect(StorySchema.safeParse(story).success).toBe(true);
    const sameLook = structuredClone(story);
    sameLook.cast.Hero.look = 'classic';
    expect(StorySchema.safeParse(sameLook).success).toBe(false);
    const missingSpeaker = structuredClone(story);
    missingSpeaker.turns.forEach((t) => (t.speaker = 'Narrator'));
    expect(StorySchema.safeParse(missingSpeaker).success).toBe(false);
  });
  it('shares only heard turns and the actual spoken fragment with question agents', () => {
    const context = revealedStory(story, 2, 'Hello');
    expect(context.heard).toEqual(story.turns.slice(0, 2));
    expect(context.currentLine).toBe('Hello');
    expect(revealedStory(story, 2).currentLine).toBe('');
    expect(JSON.stringify(context)).not.toContain('turns');
  });
  it('resumes the interrupted sentence instead of cutting into its middle', () => {
    expect(sentenceResumeTime(chars, 0.4)).toBe(0);
    expect(sentenceResumeTime(chars, 0.95)).toBeCloseTo(0.6);
  });
});
describe('retired story Worker routes', () => {
  it('does not expose the old paid endpoints', async () => {
    const upstream = vi.fn();
    for (const path of [
      '/api/story/session',
      '/api/story/speech',
      '/api/session',
    ]) {
      const response = await handleRequest(
        new Request('https://worker.example' + path, {
          method: 'POST',
          headers: { Origin: 'https://gnome.example' },
        }),
        testEnv(),
        upstream,
      );
      expect(response.status).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
});
class FakeAudio {
  static instances: FakeAudio[] = [];
  currentTime = 0;
  paused = true;
  muted = false;
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn();
}
class FakeContext {
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createAnalyser() {
    return {
      fftSize: 256,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getByteTimeDomainData: (a: Uint8Array) => a.fill(128),
    };
  }
  createMediaElementSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
}
function setupPlayer(fetcher: typeof fetch) {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('fetch', fetcher);
  const callbacks = {
    prepare: vi.fn(async () => undefined),
    state: vi.fn(),
    line: vi.fn(),
  };
  return {
    player: new StoryPlayer(story, {}, callbacks),
    callbacks,
    audio: FakeAudio.instances[0]!,
  };
}
describe('timed story playback', () => {
  it('parses alignment split across network chunks and rejects malformed timing', async () => {
    const bytes = new TextEncoder().encode(clipBody());
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(bytes.slice(0, 19));
              c.enqueue(bytes.slice(19));
              c.close();
            },
          }),
        ),
    );
    const clip = await loadStoryClip(
      story.turns[0]!,
      {},
      new AbortController().signal,
    );
    expect(clip.characters.map((c) => c.text).join('')).toBe('Hello. Again!');
    expect(clip.cues.length).toBeGreaterThan(0);
    URL.revokeObjectURL(clip.url);
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            audio_base64: 'AA==',
            alignment: {
              characters: ['a'],
              character_start_times_seconds: [1],
              character_end_times_seconds: [0],
            },
          }),
        ),
    );
    await expect(
      loadStoryClip(story.turns[0]!, {}, new AbortController().signal),
    ).rejects.toThrow('timing');
  });
  it('pauses instantly and replays only the interrupted sentence without repeating transcript entries', async () => {
    const { player, callbacks, audio } = setupPlayer(
      async () => new Response(clipBody()),
    );
    await player.play();
    audio.currentTime = 0.95;
    player.pause();
    expect(audio.paused).toBe(true);
    expect(player.getCheckpoint().spokenText).toBe('Hello. Ag');
    await player.play();
    expect(audio.currentTime).toBeCloseTo(0.6);
    expect(callbacks.line).toHaveBeenCalledOnce();
    player.dispose();
  });
  it('does not restart late-loading audio after a pause', async () => {
    let resolve!: (value: Response) => void;
    const { player, callbacks, audio } = setupPlayer(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = player.play();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    player.pause();
    resolve(new Response(clipBody()));
    await pending;
    expect(audio.play).not.toHaveBeenCalled();
    expect(callbacks.prepare).not.toHaveBeenCalled();
    player.dispose();
  });
  it('starts the next line at zero when interrupted while it is loading', async () => {
    let resolve!: (value: Response) => void;
    let n = 0;
    const { player, audio } = setupPlayer(async () =>
      ++n === 1
        ? new Response(clipBody())
        : new Promise((r) => {
            resolve = r;
          }),
    );
    await player.play();
    audio.currentTime = 1.2;
    audio.onended!();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    player.pause();
    expect(player.getCheckpoint()).toMatchObject({
      turn: 1,
      time: 0,
      spokenText: '',
    });
    resolve(new Response(clipBody()));
    await player.play();
    expect(audio.currentTime).toBe(0);
    player.dispose();
  });
  it('releases playback and pending requests on disposal', async () => {
    let signal: AbortSignal | undefined;
    const { player, audio } = setupPlayer(async (_url, init) => {
      signal = init?.signal as AbortSignal;
      return new Response(clipBody());
    });
    await player.play();
    player.dispose();
    expect(signal?.aborted).toBe(true);
    expect(audio.paused).toBe(true);
    expect(audio.onended).toBeNull();
    await player.play();
    expect(audio.play).toHaveBeenCalledOnce();
  });
});
