import envelopes from './emote-framing.json';
// Envelopes were sampled from all 18 equipped characters across each full clip.
// Keep the resting character large; only wide or high gestures need more space.
export function characterScale(
  width: number,
  height: number,
  animation?: string,
) {
  const envelope = animation
    ? envelopes[animation as keyof typeof envelopes]
    : undefined;
  return Math.min(
    width / Math.max(1150, envelope?.horizontal ?? 0),
    height / Math.max(1900, envelope?.vertical ?? 0),
  );
}
