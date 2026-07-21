/**
 * Camera-yaw quantization shared by input mapping and the HUD compass.
 *
 * The camera orbits in 90-degree snaps, so movement picks a board axis by
 * rounding the yaw to the nearest quarter turn. Corner mode rests exactly
 * halfway between two quarter turns (45, 135, ...), which puts the rounding
 * right on a tie: the smoothed yaw settles a hair above or below the rest angle
 * depending on which way the player orbited in, and a plain round would then
 * hand the same on-screen view two different arrow mappings. Biasing the tie a
 * fixed direction makes the mapping depend only on where the camera is, not on
 * how it got there.
 */
const STEP = Math.PI / 2;
const TIE_BIAS = 1e-6;

/** Index of the nearest quarter turn; exact ties resolve downward. */
export function yawStepIndex(yaw: number): number {
  return Math.round(yaw / STEP - TIE_BIAS);
}

/** The nearest quarter turn, in radians. */
export function snappedYaw(yaw: number): number {
  return yawStepIndex(yaw) * STEP;
}

/**
 * How far the real camera sits from the axis the input mapping uses: 0 in face
 * view, 45 degrees in corner view. Rotating the compass by this shows which way
 * each arrow key actually sends the piece on screen.
 */
export function yawResidual(yaw: number): number {
  return yaw - snappedYaw(yaw);
}
