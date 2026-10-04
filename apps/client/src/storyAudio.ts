import { z } from 'zod';
import { demoAccess } from './demoAccess';
import type {
  Speaker,
  Story,
  StoryTurn,
} from '@bridge-applications/voiced-gnome-types';
import { characterCues, type Pronunciations } from './gnome/liveSpeech';
import { cueAt, type MouthCue, type MouthPose } from './gnome/speech';
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const alignment = z
  .object({
    characters: z.array(z.string()),
    character_start_times_seconds: z.array(z.number().finite().nonnegative()),
    character_end_times_seconds: z.array(z.number().finite().nonnegative()),
  })
  .refine(
    (a) =>
      a.characters.length === a.character_start_times_seconds.length &&
      a.characters.length === a.character_end_times_seconds.length,
  );
const packet = z.object({
  audio_base64: z.string().max(1_500_000),
  normalized_alignment: alignment.nullable().optional(),
  alignment: alignment.nullable().optional(),
});
interface TimedChar {
  text: string;
  start: number;
  end: number;
}
interface Clip {
  url: string;
  cues: MouthCue[];
  characters: TimedChar[];
}
export function sentenceResumeTime(
  characters: TimedChar[],
  position: number,
): number {
  let start = 0;
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i]!;
    if (c.end > position) break;
    if (
      /[.!?]/.test(c.text) &&
      characters[i + 1] &&
      characters[i + 1]!.start <= position
    )
      start = characters[i + 1]!.start;
  }
  return start;
}
export async function loadStoryClip(
  turn: Pick<StoryTurn, 'speaker' | 'text'>,
  dictionary: Pronunciations,
  signal: AbortSignal,
  characterId?: string,
): Promise<Clip> {
  const response = characterId
    ? await demoAccess.request(
        '/api/characters/speech',
        { characterId, text: turn.text },
        signal,
      )
    : await fetch(base + '/api/story/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker: turn.speaker, text: turn.text }),
        signal,
      });
  if (!response.ok || !response.body)
    throw new Error('This story line could not be voiced. Please retry.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '',
    total = 0,
    end = 0;
  const audio: Uint8Array<ArrayBuffer>[] = [];
  const characters: TimedChar[] = [];
  const consume = (line: string) => {
    if (!line.trim()) return;
    const p = packet.parse(JSON.parse(line));
    const bytes = Uint8Array.from(atob(p.audio_base64), (c) => c.charCodeAt(0));
    audio.push(bytes);
    const a = p.normalized_alignment ?? p.alignment;
    if (!a) return;
    const first = a.character_start_times_seconds[0] ?? end;
    const offset = first < end - 0.05 ? end : 0;
    a.characters.forEach((text, i) => {
      const start = a.character_start_times_seconds[i]! + offset;
      const finish = a.character_end_times_seconds[i]! + offset;
      if (finish < start) throw new Error('Invalid speech timing');
      characters.push({ text, start, end: finish });
      end = Math.max(end, finish);
    });
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2_000_000) throw new Error('Story audio exceeded its limit');
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    pending += decoder.decode();
    consume(pending);
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    throw cause;
  } finally {
    reader.releaseLock();
  }
  if (!audio.length || !characters.length)
    throw new Error('Story audio or timing is missing');
  return {
    url: URL.createObjectURL(new Blob(audio, { type: 'audio/mpeg' })),
    characters,
    cues: characterCues(characters, dictionary),
  };
}
export type PlaybackState =
  'loading' | 'playing' | 'paused' | 'ended' | 'error';
export class StoryPlayer {
  private audio = new Audio();
  private context = new AudioContext();
  private analyser = this.context.createAnalyser();
  private source = this.context.createMediaElementSource(this.audio);
  private samples = new Uint8Array(256);
  private abort = new AbortController();
  private cache = new Map<number, Promise<Clip>>();
  private clip: Clip | null = null;
  private loadedIndex = -1;
  private index = 0;
  private wanted = false;
  private disposed = false;
  private version = 0;
  private savedTime = 0;
  private preparation: AbortController | null = null;
  private announced = new Set<number>();
  constructor(
    private story: Pick<Story, 'turns'> & Partial<Pick<Story, 'cast'>>,
    private dictionary: Pronunciations,
    private callbacks: {
      prepare: (
        speaker: Speaker,
        turn: StoryTurn,
        index: number,
        signal: AbortSignal,
      ) => Promise<void>;
      state: (state: PlaybackState, error?: string) => void;
      line: (turn: StoryTurn, index: number) => void;
    },
    private characterId?: string,
  ) {
    this.analyser.fftSize = 256;
    this.source.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.audio.onended = () => {
      if (!this.wanted || this.disposed) return;
      this.index++;
      this.savedTime = 0;
      void this.play().catch(() => undefined);
    };
    this.audio.onerror = () => {
      if (!this.disposed) {
        this.wanted = false;
        this.callbacks.state(
          'error',
          'This story line could not play. You can retry it.',
        );
      }
    };
  }
  private load(index: number) {
    let existing = this.cache.get(index);
    if (!existing) {
      const turn = this.story.turns[index];
      if (!turn) return Promise.reject(new Error('No story turn'));
      existing = loadStoryClip(
        turn,
        this.dictionary,
        this.abort.signal,
        this.characterId,
      ).catch((cause) => {
        this.cache.delete(index);
        throw cause;
      });
      this.cache.set(index, existing);
      void existing.then(
        (clip) => {
          if (this.disposed) URL.revokeObjectURL(clip.url);
        },
        () => undefined,
      );
    }
    return existing;
  }
  async play() {
    if (this.disposed) return;
    this.wanted = true;
    const version = ++this.version;

    const turn = this.story.turns[this.index];
    if (!turn) {
      this.wanted = false;
      this.callbacks.state('ended');
      return;
    }
    this.callbacks.state('loading');
    try {
      await this.context.resume();
      if (this.disposed || !this.wanted || version !== this.version) return;
      const clip = await this.load(this.index);
      if (this.disposed || !this.wanted || version !== this.version) return;
      this.preparation?.abort();
      const preparation = new AbortController();
      this.preparation = preparation;
      await this.callbacks.prepare(
        turn.speaker,
        turn,
        this.index,
        AbortSignal.any([this.abort.signal, preparation.signal]),
      );
      if (this.disposed || !this.wanted || version !== this.version) return;
      if (this.loadedIndex !== this.index) {
        this.audio.src = clip.url;
        this.loadedIndex = this.index;
        this.clip = clip;
      }
      this.audio.currentTime = this.savedTime;
      await this.audio.play();
      if (this.disposed || !this.wanted || version !== this.version) {
        this.audio.pause();
        return;
      }
      this.callbacks.state('playing');
      if (!this.announced.has(this.index)) {
        this.announced.add(this.index);
        this.callbacks.line(turn, this.index);
      }
      if (this.index + 1 < this.story.turns.length)
        void this.load(this.index + 1).catch(() => undefined);
    } catch (cause) {
      if (this.disposed || !this.wanted || version !== this.version) return;
      this.wanted = false;
      this.callbacks.state(
        'error',
        cause instanceof Error
          ? cause.message
          : 'The story could not continue.',
      );
    }
  }
  pause() {
    this.wanted = false;
    this.version++;
    this.preparation?.abort();
    this.audio.pause();
    this.savedTime =
      this.clip && this.loadedIndex === this.index
        ? sentenceResumeTime(this.clip.characters, this.audio.currentTime)
        : 0;
    this.callbacks.state('paused');
  }
  getCheckpoint() {
    return {
      turn: this.index,
      time: this.loadedIndex === this.index ? this.audio.currentTime : 0,
      spokenText:
        this.loadedIndex === this.index
          ? (this.clip?.characters
              .filter((c) => c.end <= this.audio.currentTime)
              .map((c) => c.text)
              .join('') ?? '')
          : '',
    };
  }
  getLevel = () => {
    if (this.disposed || this.audio.paused || this.audio.muted) return 0;
    this.analyser.getByteTimeDomainData(this.samples);
    let n = 0;
    for (const x of this.samples) n += ((x - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(n / this.samples.length) * 4);
  };
  getMouth = (): MouthPose | undefined =>
    this.audio.paused
      ? 'rest'
      : this.clip
        ? cueAt(this.clip.cues, this.audio.currentTime)
        : undefined;
  setMuted(muted: boolean) {
    this.audio.muted = muted;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.wanted = false;
    this.version++;
    this.preparation?.abort();
    this.abort.abort();
    this.audio.pause();
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.removeAttribute('src');
    this.audio.load();
    for (const p of this.cache.values())
      void p.then(
        (c) => URL.revokeObjectURL(c.url),
        () => undefined,
      );
    this.cache.clear();
    this.source.disconnect();
    this.analyser.disconnect();
    void this.context.close().catch(() => undefined);
  }
}
