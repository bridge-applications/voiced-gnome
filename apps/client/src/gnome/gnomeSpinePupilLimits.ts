/**
 * Pure geometry that keeps a pupil inside the aperture the eyelids of a facial
 * expression leave open. Everything is expressed in the eye's local space:
 * `up` runs from the lower lid towards the upper lid and `left` runs along the
 * lid edge. A lid edge is sampled from the lid mesh, so its curvature and the
 * way it flares out at the eye corners are respected instead of treating the
 * lid as a straight horizontal line. This module knows nothing about Spine;
 * `gnomeSpineFace.ts` samples the rig and applies the results. The overall
 * process and rig assumptions are described in `docs/gnome-spine-face.md`.
 */

export interface GnomeSpineEyePoint {
  readonly up: number;
  readonly left: number;
}

export type GnomeSpineLidSide = 'lower' | 'upper';

/** Evenly spaced `left` positions at which a lid edge is sampled. */
export interface GnomeSpineLidSampling {
  readonly start: number;
  readonly step: number;
  readonly count: number;
}

/** The edge of a lid that faces the eye centre, sampled along `left`. */
export interface GnomeSpineLidProfile {
  readonly start: number;
  readonly step: number;
  /** The `up` coordinate of the lid edge at `start + index * step`. */
  readonly edges: readonly number[];
}

/**
 * A lid edge that is being mixed between two expression profiles, together
 * with the radius the pupil must keep clear of it.
 */
export interface GnomeSpineLidBound {
  side: GnomeSpineLidSide;
  from: GnomeSpineLidProfile;
  to: GnomeSpineLidProfile;
  /** 0 applies `from`, 1 applies `to`. */
  mix: number;
  /** The pupil radius minus the overlap the pupil is allowed under the lid. */
  pupilRadius: number;
}

/**
 * Horizontal offsets across the pupil (as a fraction of its radius) at which
 * the lid edge is checked, so a curved edge cannot cut into the side of the
 * pupil while the centre is still clear.
 */
const PUPIL_WIDTH_SAMPLES = [-0.8, -0.4, 0, 0.4, 0.8] as const;

function lerp(from: number, to: number, mix: number): number {
  // Guards infinite (unbounded) edges, which would otherwise produce NaN.
  if (from === to) return from;

  return from + (to - from) * mix;
}

function createUnboundedEdge(side: GnomeSpineLidSide): number {
  return side === 'lower' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
}

/**
 * Samples the edge of a lid polygon that faces the eye centre: the highest
 * boundary for a lower lid and the lowest boundary for an upper lid. Where the
 * polygon does not reach a sample, the nearest sampled edge is repeated; a
 * polygon that reaches no sample yields an unbounded edge.
 */
export function rasterizeLidEdge(
  hull: readonly GnomeSpineEyePoint[],
  side: GnomeSpineLidSide,
  sampling: GnomeSpineLidSampling,
): GnomeSpineLidProfile {
  const edges: number[] = [];
  const pickExtreme = side === 'lower' ? Math.max : Math.min;

  for (let index = 0; index < sampling.count; index += 1) {
    const left = sampling.start + index * sampling.step;
    let edge = Number.NaN;

    hull.forEach((point, pointIndex) => {
      const next = hull[(pointIndex + 1) % hull.length];
      if (next === undefined) return;

      const minLeft = Math.min(point.left, next.left);
      const maxLeft = Math.max(point.left, next.left);
      if (left < minLeft || left > maxLeft) return;

      const crossing =
        point.left === next.left
          ? pickExtreme(point.up, next.up)
          : lerp(
              point.up,
              next.up,
              (left - point.left) / (next.left - point.left),
            );
      edge = Number.isNaN(edge) ? crossing : pickExtreme(edge, crossing);
    });

    edges.push(edge);
  }

  let previousEdge = Number.NaN;
  edges.forEach((edge, index) => {
    if (Number.isNaN(edge)) edges[index] = previousEdge;
    else previousEdge = edge;
  });
  previousEdge = Number.NaN;
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (edge === undefined || Number.isNaN(edge)) {
      edges[index] = Number.isNaN(previousEdge)
        ? createUnboundedEdge(side)
        : previousEdge;
    } else {
      previousEdge = edge;
    }
  }

  return { edges, start: sampling.start, step: sampling.step };
}

/** Linearly interpolates the sampled lid edge at `left`, holding the outermost samples beyond the range. */
export function sampleLidEdge(
  profile: GnomeSpineLidProfile,
  left: number,
): number {
  const lastIndex = profile.edges.length - 1;
  if (lastIndex < 0) return Number.NaN;

  const position = Math.min(
    Math.max((left - profile.start) / profile.step, 0),
    lastIndex,
  );
  const lowerIndex = Math.floor(position);
  const lowerEdge = profile.edges[lowerIndex];
  const upperEdge = profile.edges[Math.min(lowerIndex + 1, lastIndex)];
  if (lowerEdge === undefined || upperEdge === undefined) return Number.NaN;

  return lerp(lowerEdge, upperEdge, position - lowerIndex);
}

function mixedLidEdgeAt(bound: GnomeSpineLidBound, left: number): number {
  if (bound.mix <= 0) return sampleLidEdge(bound.from, left);
  if (bound.mix >= 1) return sampleLidEdge(bound.to, left);

  return lerp(
    sampleLidEdge(bound.from, left),
    sampleLidEdge(bound.to, left),
    bound.mix,
  );
}

/**
 * The most restrictive `up` the pupil centre may take at `left` so that the
 * whole pupil disc stays clear of the (curved) lid edge.
 */
export function pupilLimitAt(bound: GnomeSpineLidBound, left: number): number {
  const radius = bound.pupilRadius;
  const pickExtreme = bound.side === 'lower' ? Math.max : Math.min;
  let limit = createUnboundedEdge(bound.side);

  PUPIL_WIDTH_SAMPLES.forEach((fraction) => {
    const edge = mixedLidEdgeAt(bound, left + fraction * radius);
    const reach = radius * Math.sqrt(1 - fraction * fraction);
    limit = pickExtreme(
      limit,
      bound.side === 'lower' ? edge + reach : edge - reach,
    );
  });

  return limit;
}

export interface GnomeSpinePupilResolution {
  readonly up: number;
  readonly left: number;
  readonly lower: GnomeSpineLidBound | null;
  readonly upper: GnomeSpineLidBound | null;
}

/**
 * Moves the pupil centre vertically until it is clear of both lids. When the
 * lids leave no room, the pupil settles halfway between them.
 */
export function resolvePupilUp({
  left,
  lower,
  up,
  upper,
}: GnomeSpinePupilResolution): number {
  const minUp =
    lower === null ? Number.NEGATIVE_INFINITY : pupilLimitAt(lower, left);
  const maxUp =
    upper === null ? Number.POSITIVE_INFINITY : pupilLimitAt(upper, left);
  if (minUp > maxUp) return (minUp + maxUp) / 2;

  return Math.min(Math.max(up, minUp), maxUp);
}

export interface GnomeSpinePupilOverlapMeasurement {
  readonly profile: GnomeSpineLidProfile;
  readonly side: GnomeSpineLidSide;
  readonly pupilRadius: number;
  /** How far the unconstrained pupil centre can travel from the eye centre. */
  readonly reach: number;
}

/**
 * Measures how far the unconstrained pupil (its centre moving on a disc of
 * `reach` around the eye centre) already tucks under the lid. Keeping that
 * overlap allowed means the resting face looks exactly as it did before.
 */
export function measurePupilLidOverlap({
  profile,
  pupilRadius,
  reach,
  side,
}: GnomeSpinePupilOverlapMeasurement): number {
  const bound: GnomeSpineLidBound = {
    from: profile,
    mix: 0,
    pupilRadius,
    side,
    to: profile,
  };
  let overlap = Number.NEGATIVE_INFINITY;

  profile.edges.forEach((_edge, index) => {
    const left = profile.start + index * profile.step;
    if (Math.abs(left) > reach) return;

    const extent = Math.sqrt(reach * reach - left * left);
    const limit = pupilLimitAt(bound, left);
    const penetration = side === 'lower' ? limit - -extent : extent - limit;
    if (Number.isFinite(penetration)) {
      overlap = Math.max(overlap, penetration);
    }
  });

  return Number.isFinite(overlap) ? overlap : 0;
}
