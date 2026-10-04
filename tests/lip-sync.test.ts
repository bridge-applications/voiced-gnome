import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cueAt, parseMouthCues } from '../apps/client/src/gnome/speech';
import { LiveSpeech, wordVisemes } from '../apps/client/src/gnome/liveSpeech';

const alignment = (text: string, milliseconds = 100) => ({
  chars: [...text],
  char_start_times_ms: [...text].map((_, i) => i * milliseconds),
  char_durations_ms: [...text].map(() => milliseconds),
});

describe('recorded lip sync', () => {
  it('follows playback time, anticipates by 25ms and rests between cues', () => {
    const cues = parseMouthCues({
      mouthCues: [
        { start: 0.2, end: 0.4, value: 'A' },
        { start: 0.4, end: 0.8, value: 'F' },
      ],
    });
    expect(cueAt(cues, 0)).toBe('rest');
    expect(cueAt(cues, 0.18)).toBe('pressed');
    expect(cueAt(cues, 0.42)).toBe('pucker');
    expect(cueAt(cues, 1)).toBe('rest');
    expect(cueAt(cues, NaN)).toBe('rest');
  });
  it('rejects overlapping, nonfinite and unknown cue data', () => {
    expect(
      parseMouthCues({ mouthCues: [{ start: 0, end: Infinity, value: 'A' }] }),
    ).toEqual([]);
    expect(
      parseMouthCues({ mouthCues: [{ start: 0, end: 1, value: 'nope' }] }),
    ).toEqual([]);
    expect(
      parseMouthCues({
        mouthCues: [
          { start: 0, end: 1, value: 'A' },
          { start: 0.5, end: 2, value: 'B' },
        ],
      }),
    ).toEqual([]);
  });
  it('uses valid audio-derived cues for all five shipped recordings', () => {
    for (const name of ['hello', 'wave', 'story', 'wardrobe', 'name']) {
      const data = JSON.parse(
        readFileSync(
          new URL(
            `../apps/client/public/preview/${name}.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const cues = parseMouthCues(data);
      expect(cues.length).toBeGreaterThan(name === 'name' ? 10 : 20);
      expect(cues.at(-1)!.end).toBeCloseTo(data.duration, 1);
      expect(new Set(cues.map((cue) => cue.value)).size).toBeGreaterThan(5);
    }
  });
});

describe('live lip sync', () => {
  it('uses pronunciation rather than the spelling of silent letters', () => {
    expect(wordVisemes('gnome', { gnome: 'BEFA' })).toBe('BEFA');
    expect(wordVisemes('Phone', {})).toBe('GEB');
  });
  it('waits for audible playback before starting the alignment clock', () => {
    let now = 10;
    const speech = new LiveSpeech({ mom: 'AEA' }, () => now);
    speech.pushAlignment(alignment('mom'));
    expect(speech.sample(0)).toBe('rest');
    now = 12;
    expect(speech.sample(0.6)).toBe('pressed');
    now += 0.12;
    expect(speech.sample(0.6)).toBe('round');
  });
  it('queues chunk-relative timings without replaying the beginning', () => {
    let now = 10;
    const speech = new LiveSpeech({ mom: 'A', woo: 'F' }, () => now);
    speech.pushAlignment(alignment('mom '));
    speech.pushAlignment(alignment('woo'));
    expect(speech.sample(0.6)).toBe('pressed');
    now += 0.48;
    expect(speech.sample(0.6)).toBe('pucker');
  });
  it('retains a reply across an audible pause, then starts fresh for the next reply', () => {
    let now = 10;
    const speech = new LiveSpeech({ ah: 'D', woo: 'F', mom: 'A' }, () => now);
    speech.pushEvent({
      type: 'audio',
      audio_event: { event_id: 1, alignment: alignment('ah woo') },
    });
    expect(speech.sample(0.6)).toBe('wide');
    now += 0.15;
    expect(speech.sample(0)).toBe('rest');
    // A temporary listening phase doesn't discard later cues or restart time.
    now = 10.4;
    expect(speech.sample(0.6)).toBe('pucker');
    now = 11;
    speech.pushEvent({
      type: 'audio',
      audio_event: { event_id: 2, alignment: alignment('mom') },
    });
    expect(speech.sample(0.6)).toBe('pressed');
    // Delayed metadata for the previous reply must not append to the new one.
    speech.pushEvent({
      type: 'audio',
      audio_event: { event_id: 1, alignment: alignment('woo') },
    });
    now += 0.4;
    expect(speech.sample(0.6)).toBe('rest');
  });
  it('does not clear usable cues for malformed or empty new-reply metadata', () => {
    let now = 10;
    const speech = new LiveSpeech({ woo: 'F' }, () => now);
    speech.pushEvent({
      type: 'audio',
      audio_event: { event_id: 1, alignment: alignment('woo') },
    });
    expect(speech.sample(0.6)).toBe('pucker');
    for (const id of [2, NaN, Infinity]) {
      speech.pushEvent({
        type: 'audio',
        audio_event: { event_id: id, alignment: alignment('') },
      });
    }
    now += 0.1;
    expect(speech.sample(0.6)).toBe('pucker');
  });
  it('drops interrupted audio and clears pending cues immediately', () => {
    const speech = new LiveSpeech({ mom: 'A' }, () => 1);
    speech.pushEvent({
      type: 'audio',
      audio_event: { event_id: 5, alignment: alignment('mom') },
    });
    expect(speech.sample(0.6)).toBe('pressed');
    speech.reset(5);
    speech.pushEvent({
      type: 'audio',
      audio_event: { event_id: 4, alignment: alignment('mom') },
    });
    expect(speech.sample(0.6)).toBeUndefined();
    speech.pushEvent({
      type: 'audio',
      audio_event: { event_id: 6, alignment: alignment('mom') },
    });
    expect(speech.sample(0.6)).toBe('pressed');
  });
  it('accepts fresh event IDs when reconnecting after an interruption', () => {
    const speech = new LiveSpeech({ mom: 'A' }, () => 1);
    speech.reset(30);
    speech.startSession({ mom: 'A' });
    speech.pushEvent({
      type: 'audio',
      audio_event: { event_id: 1, alignment: alignment('mom') },
    });
    expect(speech.sample(0.6)).toBe('pressed');
  });

  it('rests during silence and ignores malformed alignment arrays', () => {
    let now = 1;
    const speech = new LiveSpeech({ mom: 'A' }, () => now);
    speech.pushAlignment({
      chars: ['m'],
      char_start_times_ms: [],
      char_durations_ms: [100],
    });
    expect(speech.sample(0.6)).toBeUndefined();
    speech.pushAlignment(alignment('mom'));
    speech.sample(0.6);
    now += 0.15;
    expect(speech.sample(0)).toBe('rest');
  });
  it('does not animate ElevenLabs delivery tags as spoken words', () => {
    const speech = new LiveSpeech({}, () => 1);
    speech.pushAlignment(alignment('[cheerful]'));
    expect(speech.sample(0.6)).toBeUndefined();
  });
});
