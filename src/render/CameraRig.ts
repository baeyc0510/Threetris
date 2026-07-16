import * as THREE from "three";
import type { CameraMode } from "../core/types";
import { VISIBLE_HEIGHT } from "../core/constants";

/**
 * Orbits the camera on an invisible rail outside the well. Q/E step the yaw by
 * 90 degrees; the look-at target rises with the stack. Corner mode frames the
 * well from a diagonal (steeper, reads depth+height); Face mode looks nearly
 * straight at a flat face. Distance/height scale with board size.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = "corner";
  private boardSize = 9;

  private yawOffset = Math.PI / 4; // corner by default
  private targetYaw = Math.PI / 4;
  private currentYaw = Math.PI / 4;

  private targetLookY = 4;
  private currentLookY = 4;

  private radius = 22;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 500);
    this.recomputeRadius();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setBoardSize(size: number): void {
    this.boardSize = size;
    this.recomputeRadius();
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

  private recomputeRadius(): void {
    this.radius = this.boardSize * 1.7 + 7;
  }

  /** Current yaw so input can remap movement to the camera's facing. */
  getYaw(): number {
    return this.currentYaw;
  }

  reset(): void {
    this.targetYaw = this.yawOffset;
    this.currentYaw = this.yawOffset;
  }

  /**
   * @param dt seconds since last frame
   * @param stackHeight highest occupied logic layer (0..VISIBLE_HEIGHT)
   */
  update(dt: number, stackHeight: number): void {
    // Target look height follows the stack, framed around the visible well.
    const h = Math.max(0, Math.min(stackHeight, VISIBLE_HEIGHT));
    this.targetLookY = h * 0.55 + VISIBLE_HEIGHT * 0.18 + 2;

    // Smooth follow.
    const kYaw = 1 - Math.pow(0.001, dt);
    const kLook = 1 - Math.pow(0.02, dt);
    this.currentYaw += (this.targetYaw - this.currentYaw) * kYaw;
    this.currentLookY += (this.targetLookY - this.currentLookY) * kLook;

    const eyeLift = this.mode === "corner" ? this.radius * 0.62 : this.radius * 0.32;
    const eyeY = this.currentLookY + eyeLift;

    this.camera.position.set(
      Math.sin(this.currentYaw) * this.radius,
      eyeY,
      Math.cos(this.currentYaw) * this.radius,
    );
    this.camera.lookAt(0, this.currentLookY, 0);
  }
}
