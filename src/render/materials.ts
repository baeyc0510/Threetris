import * as THREE from "three";
import type { PieceType } from "../core/types";
import { PIECE_COLORS } from "../core/constants";

/** Cube visual size (a gap around 1.0 makes individual blocks readable). */
export const CUBE_SIZE = 0.9;

export function pieceColor(type: PieceType): THREE.Color {
  return new THREE.Color(PIECE_COLORS[type]);
}

/**
 * Standard material for solid blocks. Relies on InstancedMesh `instanceColor`
 * to tint each cube (Three defines USE_COLOR in the fragment shader when an
 * instanceColor buffer is present, so `vColor` is available there). A patched
 * shader adds an emissive glow from that instance color so neon hues bloom
 * without a unique material per piece.
 *
 * NOTE: we intentionally do NOT set `vertexColors: true`. That would force the
 * vertex shader to multiply by a non-existent `color` attribute and zero out
 * every cube (rendering them black).
 */
export function makeSolidMaterial(glow = 0.5): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.35,
    metalness: 0.25,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: glow };
    // `vColor` only exists when USE_COLOR is defined, which Three enables when
    // the InstancedMesh has an instanceColor buffer. Guard against the program
    // that gets compiled while the mesh is still empty (count 0, no instanceColor).
    shader.fragmentShader =
      "uniform float uGlow;\n" +
      shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n\t#ifdef USE_COLOR\n\ttotalEmissiveRadiance += vColor.rgb * uGlow;\n\t#endif",
      );
  };
  return mat;
}

/** Translucent material for the ghost (landing preview). Tinted via instanceColor. */
export function makeGhostMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
}
