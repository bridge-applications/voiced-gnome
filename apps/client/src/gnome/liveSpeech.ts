import { assetUrl } from '../assetUrl';
import { cueAt, type MouthCue, type MouthPose, type Viseme } from './speech';

export type Pronunciations = Record<string, string>;
interface Alignment {
  chars: string[];
  char_start_times_ms: number[];
  char_durations_ms: number[];
}
interface TimedCharacter {
  text: string;
  start: number;
  end: number;
}
let pronunciationPromise: Promise<Pronunciations> | undefined;

// Loaded only when live mode starts; previews need no dictionary or recognizer.
export function loadPronunciations(): Promise<Pronunciations> {
  pronunciationPromise ??= fetch(assetUrl('/speech/english-visemes.json'))
    .then(async (response) => {
      if (!response.ok) throw new Error('Pronunciation data unavailable');
      return (await response.json()) as Pronunciations;
    })
    .catch(() => {
      pronunciationPromise = undefined;
      return {};
    });
  return pronunciationPromise;
}

export function wordVisemes(word: string, dictionary: Pronunciations): string {
  const normalized = word.toLowerCase().replaceAll('’', "'");
  if (Object.hasOwn(dictionary, normalized)) return dictionary[normalized]!;
  // Unfamiliar names use a small English spelling fallback, never a random pose.
  const sounds =
    normalized
      .replace(/[^a-z]/g, '')
      .replace(/e$/, '')
      .match(/th|sh|ch|ph|oo|ou|ow|oa|ee|ea|ai|ay|[a-z]/g) ?? [];
  return (
    sounds
      .map((sound) => {
        if (/^[pbm]$/.test(sound)) return 'A';
        if (/^(f|v|ph)$/.test(sound)) return 'G';
        if (sound === 'l') return 'H';
        if (/^(oo|ou|ow|w|u)$/.test(sound)) return 'F';
        if (/^(o|oa|r)$/.test(sound)) return 'E';
        if (/^(a|ai|ay)$/.test(sound)) return 'D';
        if (sound === 'e' || sound === 'h') return 'C';
        return 'B';
      })
      .join('') || 'B'
  );
}

export function characterCues(
  chars: readonly TimedCharacter[],
  dictionary: Pronunciations,
): MouthCue[] {
  const text = chars.map((char) => char.text).join('');
  const offsets: { index: number; char: TimedCharacter }[] = [];
  let index = 0;
  for (const char of chars) {
    offsets.push({ index, char });
    index += char.text.length;
  }
  const tags = [
    ...text.matchAll(/\[[^\]]*\]|<\/?(?:Hero|Friend|Narrator)>/gi),
  ].map((match): readonly [number, number] => [
    match.index!,
    match.index! + match[0].length,
  ]);
  const cues: MouthCue[] = [];
  for (const match of text.matchAll(/[a-z]+(?:['’][a-z]+)*/gi)) {
    const begin = match.index!,
      end = begin + match[0].length;
    if (tags.some(([a, b]) => begin >= a && begin < b)) continue;
    const wordChars = offsets.filter(
      (entry) =>
        entry.index < end && entry.index + entry.char.text.length > begin,
    );
    if (!wordChars.length) continue;
    const startTime = wordChars[0]!.char.start;
    const endTime = wordChars[wordChars.length - 1]!.char.end;
    const sequence = wordVisemes(match[0], dictionary).split('') as Viseme[];
    const weights = sequence.map((pose) => ('CDEF'.includes(pose) ? 1.4 : 0.8));
    const total = weights.reduce((a, b) => a + b, 0);
    let start = startTime;
    sequence.forEach((value, i) => {
      const end =
        i === sequence.length - 1
          ? endTime
          : start + ((endTime - startTime) * weights[i]!) / total;
      if (end > start) cues.push({ start, end, value });
      start = end;
    });
  }
  return cues;
}

// Align received character timings to the first audio that is actually audible.
// Internal phoneme times are estimated from dictionary pronunciation within each
// word, because ElevenLabs supplies characters, not timestamped phonemes.
export class LiveSpeech {
  private chars: TimedCharacter[] = [];
  private cues: MouthCue[] = [];
  private origin: number | null = null;
  private lastSound = 0;
  private lastPose: MouthPose = 'rest';
  private lastChange = 0;
  private minimumEventId = -Infinity;
  private alignmentEventId: number | undefined;
  constructor(
    private dictionary: Pronunciations = {},
    private clock = () => performance.now() / 1000,
  ) {}
  startSession(dictionary: Pronunciations): void {
    this.reset();
    this.minimumEventId = -Infinity;
    this.dictionary = dictionary;
  }
  reset(interruptionId?: number): void {
    this.chars = [];
    this.cues = [];
    this.origin = null;
    this.lastSound = 0;
    this.lastPose = 'rest';
    this.lastChange = 0;
    this.alignmentEventId = undefined;
    if (Number.isFinite(interruptionId)) this.minimumEventId = interruptionId!;
  }
  pushEvent(event: unknown): void {
    if (
      !event ||
      typeof event !== 'object' ||
      !('type' in event) ||
      event.type !== 'audio' ||
      !('audio_event' in event)
    )
      return;
    const audio = event.audio_event;
    if (
      !audio ||
      typeof audio !== 'object' ||
      !('event_id' in audio) ||
      typeof audio.event_id !== 'number' ||
      !Number.isFinite(audio.event_id) ||
      audio.event_id <= this.minimumEventId ||
      audio.event_id < (this.alignmentEventId ?? -Infinity) ||
      !('alignment' in audio)
    )
      return;
    this.pushAlignment(audio.alignment, audio.event_id);
  }
  pushAlignment(value: unknown, eventId?: number): void {
    if (!value || typeof value !== 'object') return;
    const alignment = value as Alignment;
    const {
      chars,
      char_start_times_ms: starts,
      char_durations_ms: durations,
    } = alignment;
    if (
      !Array.isArray(chars) ||
      !Array.isArray(starts) ||
      !Array.isArray(durations) ||
      !chars.length ||
      chars.length > 4000 ||
      starts.length !== chars.length ||
      durations.length !== chars.length
    )
      return;
    if (
      chars.some((char) => typeof char !== 'string' || char.length > 32) ||
      starts.some(
        (time, i) =>
          !Number.isFinite(time) ||
          time < 0 ||
          (i > 0 && time < starts[i - 1]!),
      ) ||
      durations.some(
        (time) => !Number.isFinite(time) || time < 0 || time > 10000,
      )
    )
      return;
    // Alignment chunks share the reply's event ID. Reset on a genuinely new
    // reply, not on transient SDK listening modes between its audio chunks.
    if (eventId !== undefined && eventId !== this.alignmentEventId) {
      this.reset();
      this.alignmentEventId = eventId;
    }
    const end = this.chars.at(-1)?.end ?? 0;
    // Both chunk-relative and utterance-relative timings occur in SDK payloads.
    const offset = starts[0]! / 1000 < end - 0.02 ? end : 0;
    for (let i = 0; i < chars.length; i++)
      this.chars.push({
        text: chars[i]!,
        start: offset + starts[i]! / 1000,
        end: offset + (starts[i]! + durations[i]!) / 1000,
      });
    // Bound work and memory for the short demo; a normal turn is much smaller.
    if (this.chars.length > 12000) {
      this.reset();
      return;
    }
    this.cues = characterCues(this.chars, this.dictionary);
  }
  sample(level: number): MouthPose | undefined {
    if (!this.cues.length) return undefined;
    const now = this.clock();
    if (level > 0.04) {
      this.origin ??= now;
      this.lastSound = now;
    }
    if (this.origin === null || now - this.lastSound > 0.1) {
      this.lastPose = 'rest';
      this.lastChange = now;
      return 'rest';
    }
    const next = cueAt(this.cues, now - this.origin);
    // Keep short consonants readable and avoid sub-frame attachment chatter.
    if (
      next !== this.lastPose &&
      (now - this.lastChange >= 0.045 ||
        next === 'pressed' ||
        next === 'fv' ||
        next === 'rest')
    ) {
      this.lastPose = next;
      this.lastChange = now;
    }
    return this.lastPose;
  }
}
