/**
 * Animation track layering for the Spine Gnome.
 *
 * Higher tracks override lower ones for every property they key, so the body
 * sits at the bottom and the runtime-controlled face on top. Whatever a body
 * animation keys on the face (the export carries stray lid, brow, and gaze
 * keys) is therefore overridden by the expression track, and the blink is
 * applied additively above both. The face slots themselves are re-applied by
 * `gnomeSpineFace.ts` on every frame, so the empty attachment keys the body
 * animations still carry on the expression slots cannot hide the face either.
 */
export const GNOME_SPINE_BODY_TRACK = 0;
export const GNOME_SPINE_EXPRESSION_TRACK = 1;
export const GNOME_SPINE_BLINK_TRACK = 2;
