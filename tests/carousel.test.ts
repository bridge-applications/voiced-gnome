import { describe, expect, it } from 'vitest';
import {
  carouselMoves,
  carouselPose,
  interpolatePose,
} from '../apps/client/src/gnome/carousel';
describe('individual carousel movement', () => {
  it('moves left to centre and centre to right when moving right', () => {
    expect(carouselMoves(1)).toEqual([
      { from: -1, to: 0 },
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: -2, to: -1 },
    ]);
  });
  it('moves right to centre and introduces a neighbour from the right when moving left', () => {
    expect(carouselMoves(-1)).toEqual([
      { from: -1, to: -2 },
      { from: 0, to: -1 },
      { from: 1, to: 0 },
      { from: 2, to: 1 },
    ]);
  });
  it('grows the entering character and lowers it smoothly into the centre', () => {
    for (const [width, height] of [
      [320, 390],
      [760, 528],
    ]) {
      const left = carouselPose(-1, width!, height!),
        centre = carouselPose(0, width!, height!);
      const middle = interpolatePose(left, centre, 0.5);
      expect(middle.x).toBeGreaterThan(left.x);
      expect(middle.x).toBeLessThan(centre.x);
      expect(middle.scale).toBeGreaterThan(left.scale);
      expect(middle.scale).toBeLessThan(centre.scale);
      expect(middle.y).toBeGreaterThan(left.y);
      expect(interpolatePose(left, centre, 1)).toEqual(centre);
      const entering = carouselPose(-2, width!, height!);
      expect(entering.x).toBeLessThan(0);
      expect(carouselPose(2, width!, height!).x).toBeGreaterThan(width!);
    }
  });
});
