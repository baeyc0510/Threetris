import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { GameManager } from "../core/GameManager";
import type { CameraRig } from "./CameraRig";
import { VISIBLE_HEIGHT } from "../core/constants";
import { CUBE_SIZE, makeSolidMaterial, makeGhostMaterial, pieceColor } from "./materials";
import { Effects } from "./effects";

/**
 * Owns the Three.js scene and syncs it from the logic layer every frame. The
 * logic grid is the source of truth: cubes are placed purely from cell
 * coordinates, never from mesh transforms.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  readonly effects: Effects;

  private boardSize = 9;
  private wellGroup = new THREE.Group();

  private boxGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  private lockedMat = makeSolidMaterial(0.45);
  private activeMat = makeSolidMaterial(0.85);
  private ghostMat = makeGhostMaterial();

  private lockedMesh!: THREE.InstancedMesh;
  private activeMesh!: THREE.InstancedMesh;
  private ghostMesh!: THREE.InstancedMesh;
  private outline: THREE.LineSegments[] = [];

  private dummy = new THREE.Object3D();

  constructor(
    canvas: HTMLCanvasElement,
    private rig: CameraRig,
    boardSize: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scene.background = new THREE.Color(0x070a1a);
    this.scene.fog = new THREE.FogExp2(0x070a1a, 0.012);

    this.setupLights();
    this.effects = new Effects(this.scene);

    // Post-processing bloom for the neon glow.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.75, // strength
      0.6, // radius
      0.55, // threshold
    );
    this.composer.addPass(this.bloom);
    this.composer.setSize(window.innerWidth, window.innerHeight);

    this.scene.add(this.wellGroup);
    this.setBoardSize(boardSize);
  }

  private setupLights(): void {
    this.scene.add(new THREE.AmbientLight(0x5566aa, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(8, 20, 12);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff2d9b, 0.4);
    rim.position.set(-12, 8, -10);
    this.scene.add(rim);
  }

  // --- Coordinate mapping: logic (x,y,z) -> world (X up = logic z) ---
  private halfW(): number {
    return (this.boardSize - 1) / 2;
  }

  private worldX(x: number): number {
    return x - this.halfW();
  }
  private worldY(z: number): number {
    return z + 0.5;
  }
  private worldZ(y: number): number {
    return y - this.halfW();
  }

  setBoardSize(size: number): void {
    this.boardSize = size;
    this.rig.setBoardSize(size);
    this.buildWell();
    this.buildInstancedMeshes();
  }

  private buildWell(): void {
    this.wellGroup.clear();
    const w = this.boardSize;
    const h = VISIBLE_HEIGHT;

    // Wireframe box around the well.
    const boxGeo = new THREE.BoxGeometry(w, h, w);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const box = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x18e0ff, transparent: true, opacity: 0.55 }),
    );
    box.position.set(0, h / 2, 0);
    this.wellGroup.add(box);
    boxGeo.dispose();

    // Floor grid.
    const grid = new THREE.GridHelper(w, w, 0xff3ea5, 0x1c3a66);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    grid.position.y = 0.0;
    this.wellGroup.add(grid);

    // Solid-ish dark floor to catch light.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w),
      new THREE.MeshStandardMaterial({ color: 0x0a1230, roughness: 0.9, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    this.wellGroup.add(floor);
  }

  private disposeInstanced(): void {
    for (const m of [this.lockedMesh, this.activeMesh, this.ghostMesh]) {
      if (m) {
        this.scene.remove(m);
        m.dispose();
      }
    }
    for (const o of this.outline) {
      this.scene.remove(o);
      o.geometry.dispose();
    }
    this.outline = [];
  }

  private buildInstancedMeshes(): void {
    this.disposeInstanced();
    const maxLocked = this.boardSize * this.boardSize * (VISIBLE_HEIGHT + 4);

    // Instanced meshes derive their frustum-cull bounding sphere lazily from the
    // instance matrices the first time they render, and never recompute it. With
    // count = 0 at startup that sphere is degenerate/at the origin, so the whole
    // mesh gets culled once the camera pans away from it and stacked blocks vanish.
    // The well is always on screen, so disable per-mesh culling instead.
    this.lockedMesh = new THREE.InstancedMesh(this.boxGeo, this.lockedMat, maxLocked);
    this.lockedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lockedMesh.frustumCulled = false;
    this.lockedMesh.count = 0;
    this.scene.add(this.lockedMesh);

    this.activeMesh = new THREE.InstancedMesh(this.boxGeo, this.activeMat, 8);
    this.activeMesh.frustumCulled = false;
    this.activeMesh.count = 0;
    this.scene.add(this.activeMesh);

    this.ghostMesh = new THREE.InstancedMesh(this.boxGeo, this.ghostMat, 8);
    this.ghostMesh.frustumCulled = false;
    this.ghostMesh.count = 0;
    this.scene.add(this.ghostMesh);

    // White edge outlines for the four active cells (clear active/locked distinction).
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    const edgeGeo = new THREE.EdgesGeometry(this.boxGeo);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.LineSegments(edgeGeo, edgeMat);
      seg.visible = false;
      this.outline.push(seg);
      this.scene.add(seg);
    }
  }

  private setInstance(
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
  ): void {
    this.dummy.position.set(this.worldX(x), this.worldY(z), this.worldZ(y));
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(1);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(i, this.dummy.matrix);
    mesh.setColorAt(i, color);
  }

  /** Pull the whole scene state from the game logic. */
  sync(game: GameManager): void {
    // Locked blocks.
    let li = 0;
    game.board.forEachFilled((x, y, z, type) => {
      this.setInstance(this.lockedMesh, li, x, y, z, pieceColor(type));
      li++;
    });
    this.lockedMesh.count = li;
    this.lockedMesh.instanceMatrix.needsUpdate = true;
    if (this.lockedMesh.instanceColor) this.lockedMesh.instanceColor.needsUpdate = true;

    // Active piece.
    const activeCells = game.activeCells();
    const activeType = game.activeType();
    const activeColor = activeType ? pieceColor(activeType) : new THREE.Color(0xffffff);
    activeCells.forEach((c, i) => {
      this.setInstance(this.activeMesh, i, c.x, c.y, c.z, activeColor);
    });
    this.activeMesh.count = activeCells.length;
    this.activeMesh.instanceMatrix.needsUpdate = true;
    if (this.activeMesh.instanceColor) this.activeMesh.instanceColor.needsUpdate = true;

    // Active outlines.
    this.outline.forEach((seg, i) => {
      const c = activeCells[i];
      if (c) {
        seg.visible = true;
        seg.position.set(this.worldX(c.x), this.worldY(c.z), this.worldZ(c.y));
      } else {
        seg.visible = false;
      }
    });

    // Ghost piece (hide if it coincides with the active piece position).
    const ghostCells = game.ghostCells();
    const showGhost = activeCells.length > 0 && ghostCells.some((g, i) => g.z !== activeCells[i].z);
    if (showGhost) {
      ghostCells.forEach((c, i) => {
        this.setInstance(this.ghostMesh, i, c.x, c.y, c.z, activeColor);
      });
      this.ghostMesh.count = ghostCells.length;
    } else {
      this.ghostMesh.count = 0;
    }
    this.ghostMesh.instanceMatrix.needsUpdate = true;
    if (this.ghostMesh.instanceColor) this.ghostMesh.instanceColor.needsUpdate = true;
  }

  /** Trigger the clear effect at the given logic layers. */
  playLayerClear(zsCleared: number[], color: THREE.Color): void {
    const half = this.halfW() + 0.5;
    for (const z of zsCleared) {
      this.effects.layerClear(this.worldY(z), half, half, color);
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.rig.setAspect(w / h);
  }

  render(dt: number): void {
    this.effects.update(dt);
    this.composer.render();
  }

  clearBoardVisual(): void {
    this.lockedMesh.count = 0;
    this.activeMesh.count = 0;
    this.ghostMesh.count = 0;
    this.effects.clear();
  }
}
