import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '@bridge-applications/voiced-gnome-types';
import {
  IntroductionTimeline,
  introductionData,
} from '../apps/client/src/introduction';
import { cueAt, parseMouthCues } from '../apps/client/src/gnome/speech';

const generation = JSON.parse(
  readFileSync(
    new URL('../docs/character-introductions.json', import.meta.url),
    'utf8',
  ),
);

describe('recorded character introductions', () => {
  it('includes playable, voice-matched audio and valid mouth/gesture timing for every character', () => {
    const base = new URL(
      '../apps/client/public/introductions/',
      import.meta.url,
    );
    for (const character of CHARACTERS) {
      const raw = JSON.parse(
        readFileSync(new URL(character.id + '.json', base), 'utf8'),
      );
      const data = introductionData(raw, character.id);
      expect(raw.voiceId, character.name).toBe(character.voiceId);
      expect(raw.modelId, character.name).toBe(generation.model_id);
      expect(data.duration).toBeGreaterThan(8);
      expect(data.beats.length).toBe(2);
      const cues = parseMouthCues(raw);
      expect(cues.length, character.name).toBeGreaterThan(30);
      expect(cues.at(-1)!.end).toBeLessThanOrEqual(data.duration + 0.02);
      expect(cueAt(cues, data.duration + 0.1)).toBe('rest');
      expect(
        readFileSync(new URL(character.id + '.mp3', base)).byteLength,
      ).toBeGreaterThan(20_000);
    }
  });
  it('advances gestures once against playback time and stays still during buffering', () => {
    const beats = new IntroductionTimeline([
      { time: 0, gesture: 'wave' },
      { time: 9, gesture: 'awkward' },
    ]);
    const gestures: string[] = [];
    const record = (name: string) => gestures.push(name);
    beats.advance(0, record);
    beats.advance(0, record);
    beats.advance(4, record);
    beats.advance(4, record);
    expect(gestures).toEqual(['wave']);
    beats.advance(9.1, record);
    beats.advance(10, record);
    expect(gestures).toEqual(['wave', 'awkward']);
  });
  it('does not queue obsolete gestures after skipped playback updates', () => {
    const beats = new IntroductionTimeline([
      { time: 0, gesture: 'wave' },
      { time: 9, gesture: 'awkward' },
    ]);
    const gestures: string[] = [];
    beats.advance(NaN, (name) => gestures.push(name));
    beats.advance(-1, (name) => gestures.push(name));
    beats.advance(12, (name) => gestures.push(name));
    expect(gestures).toEqual(['awkward']);
  });
  it('rejects mismatched identities, invalid emotes and timing outside the recording', () => {
    const valid = {
      characterId: 'pip',
      text: 'Ahoy!',
      duration: 15,
      beats: [{ time: 0, gesture: 'wave' }],
    };
    expect(() => introductionData(valid, 'ember')).toThrow();
    expect(() =>
      introductionData(
        { ...valid, beats: [{ time: 16, gesture: 'wave' }] },
        'pip',
      ),
    ).toThrow();
    expect(() =>
      introductionData(
        { ...valid, beats: [{ time: 1, gesture: 'unknown' }] },
        'pip',
      ),
    ).toThrow();
    expect(() =>
      introductionData(
        {
          ...valid,
          beats: [
            { time: 9, gesture: 'wave' },
            { time: 1, gesture: 'bow' },
          ],
        },
        'pip',
      ),
    ).toThrow();
  });
});
