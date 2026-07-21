import * as THREE from "three";
import type { CameraMode } from "../core/types";
import { VISIBLE_HEIGHT } from "../core/constants";

/**
 * Orbits the camera on an invisible rail outside the well. Q/E step the yaw by
 * 90 degrees. Corner mode frames the well from a diagonal (steeper, reads
 * depth+height); Face mode looks nearly straight at a flat face.
 *
 * Framing is fit-based: each frame the rig computes the world region it wants on
 * screen — from the floor up to the settled stack (plus headroom for incoming
 * pieces) — and derives the look height and orbit distance so that region fits
 * the frustum at the current board size and aspect. This guarantees the floor
 * (and the blocks resting on it) stay visible at every difficulty, and the view
 * only rises as blocks actually stack.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = "face";
  private boardSize = 9;

  private yawOffset = 0; // face by default; corner adds a 45-degree offset
  private targetYaw = 0;
  private currentYaw = 0;

  private targetLookY = 4;
  private currentLookY = 4;

  private targetRadius = 22;
  private currentRadius = 22;

  // Vertical headroom kept above the settled stack, and the minimum vertical
  // span framed so a near-empty well is not zoomed in too far.
  private static readonly HEADROOM = 6;
  private static readonly MIN_SPAN = 9;
  // Extra breathing room around the fitted region (bounding sphere over-covers a
  // little already, so this stays modest).
  private static readonly FIT_MARGIN = 1.12;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 500);
    this.computeFraming(0);
    this.currentLookY = this.targetLookY;
    this.currentRadius = this.targetRadius;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setBoardSize(size: number): void {
    this.boardSize = size;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    const newOffset = mode === "corner" ? Math.PI / 4 : 0;
    // Preserve the nearest facing while switching the diagonal/face offset.
    const step = Math.round((this.targetYaw - this.yawOffset) / (Math.PI / 2));
    this.yawOffset = newOffset;
    this.targetYaw = step * (Math.PI / 2) + this.yawOffset;
  }

  /** Snap-rotate by 90 degrees. dir +1 = one way, -1 = the other. */
  rotate(dir: 1 | -1): void {
    this.targetYaw += dir * (Math.PI / 2);
  }

  /** Continuous small yaw nudge (used for a lively idle menu). */
  nudgeYaw(rad: number): void {
    this.targetYaw += rad;
  }

  /** Current yaw so input can remap movement to the camera's facing. */
  getYaw(): number {
    return this.currentYaw;
  }

  reset(): void {
    this.targetYaw = this.yawOffset;
    this.currentYaw = this.yawOffset;
    this.computeFraming(0);
    this.currentLookY = this.targetLookY;
    this.currentRadius = this.targetRadius;
  }

  /** Downward tilt of the view, in radians, per camera mode. */
  private pitch(): number {
    return this.mode === "corner" ? THREE.MathUtils.degToRad(32) : THREE.MathUtils.degToRad(18);
  }

  /**
   * Recompute the look height and orbit radius so the region [floor .. top]
   * fits the frustum for the current board size and aspect.
   */
  private computeFraming(stackHeight: number): void {
    const h = Math.max(0, Math.min(stackHeight, VISIBLE_HEIGHT));
    const topY = Math.min(Math.max(h + CameraRig.HEADROOM, CameraRig.MIN_SPAN), VISIBLE_HEIGHT);
    this.targetLookY = topY / 2;

    // Bounding sphere enclosing the framed box (half-width in x/z, half-span in y).
    const half = this.boardSize / 2 + 0.5;
    const R = Math.hypot(topY / 2, half * Math.SQRT2);

    // Fit the sphere within the tighter of the vertical/horizontal half-FOVs.
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const fitHalf = Math.min(vHalf, hHalf);
    const dist = (R / Math.sin(fitHalf)) * CameraRig.FIT_MARGIN;

    // Convert straight-line distance to the horizontal orbit radius.
    this.targetRadius = dist * Math.cos(this.pitch());
  }

  /**
   * @param dt seconds since last frame
   * @param stackHeight highest settled logic layer (0..VISIBLE_HEIGHT)
   */
  update(dt: number, stackHeight: number): void {
    this.computeFraming(stackHeight);

    // Smooth follow.
    const kYaw = 1 - Math.pow(0.001, dt);
    const kFrame = 1 - Math.pow(0.02, dt);
    this.currentYaw += (this.targetYaw - this.currentYaw) * kYaw;
    this.currentLookY += (this.targetLookY - this.currentLookY) * kFrame;
    this.currentRadius += (this.targetRadius - this.currentRadius) * kFrame;

    const eyeY = this.currentLookY + this.currentRadius * Math.tan(this.pitch());
    this.camera.position.set(
      Math.sin(this.currentYaw) * this.currentRadius,
      eyeY,
      Math.cos(this.currentYaw) * this.currentRadius,
    );
    this.camera.lookAt(0, this.currentLookY, 0);
  }
}
