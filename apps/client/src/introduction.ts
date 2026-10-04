import { z } from 'zod';
import {
  GestureSchema,
  type Gesture,
} from '@bridge-applications/voiced-gnome-types';
const IntroductionSchema = z.object({
  characterId: z.string(),
  text: z.string().min(1).max(1000),
  duration: z.number().finite().min(1).max(60),
  beats: z
    .array(
      z.object({
        time: z.number().finite().nonnegative(),
        gesture: GestureSchema,
      }),
    )
    .max(4),
});
export function introductionData(value: unknown, characterId: string) {
  const data = IntroductionSchema.parse(value);
  if (
    data.characterId !== characterId ||
    data.beats.some(
      (beat, i) =>
        beat.time >= data.duration ||
        (i > 0 && beat.time < data.beats[i - 1]!.time),
    )
  )
    throw Error('Unexpected introduction');
  return data;
}
// Driven by media time, so buffering never advances choreography.
export class IntroductionTimeline {
  private next = 0;
  constructor(
    private readonly beats: readonly { time: number; gesture: Gesture }[],
  ) {}
  advance(time: number, gesture: (name: Gesture) => void) {
    if (!Number.isFinite(time) || time < 0) return;
    // If the browser skipped frames, show the latest beat rather than queuing old actions.
    let latest: Gesture | undefined;
    while (
      this.next < this.beats.length &&
      this.beats[this.next]!.time <= time
    ) {
      latest = this.beats[this.next++]!.gesture;
    }
    if (latest) gesture(latest);
  }
}
