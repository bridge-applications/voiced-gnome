import { characterScale } from './framing';
export type CarouselPose = { x: number; y: number; scale: number };
// Move the existing left/centre/right rigs and one incoming rig between slots.
export function carouselMoves(direction: -1 | 1) {
  return [-1, 0, 1, -2 * direction].map((from) => ({
    from,
    to: from + direction,
  }));
}
export function carouselPose(
  slot: number,
  width: number,
  height: number,
): CarouselPose {
  return {
    x: width * (0.5 + slot * 0.38),
    y: height * (slot === 0 ? 0.86 : 0.7),
    scale:
      slot === 0
        ? characterScale(width * 0.5, height)
        : Math.min((width * 0.22) / 1000, (height * 0.6) / 1900),
  };
}
export function interpolatePose(
  from: CarouselPose,
  to: CarouselPose,
  progress: number,
): CarouselPose {
  const mix = (a: number, b: number) => a + (b - a) * progress;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    scale: mix(from.scale, to.scale),
  };
}
