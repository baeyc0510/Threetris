import * as THREE from "three";

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface LayerFlash {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

/**
 * Transient visual feedback for layer clears: a bright flat flash on each
 * cleared layer plus a short particle burst. Kept lightweight so it never
 * hides the board for long.
 */
export class Effects {
  private particles: Particle[] = [];
  private flashes: LayerFlash[] = [];
  private particleGeo = new THREE.SphereGeometry(0.12, 6, 6);

  constructor(private scene: THREE.Scene) {}

  /** Spawn a flash across a full layer and a burst of neon sparks. */
  layerClear(worldY: number, halfW: number, halfD: number, color: THREE.Color): void {
    // Flat glowing plane covering the cleared layer.
    const planeGeo = new THREE.PlaneGeometry(halfW * 2 + 1, halfD * 2 + 1);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, worldY, 0);
    this.scene.add(plane);
    this.flashes.push({ mesh: plane, life: 0, maxLife: 0.45 });

    // Particle burst.
    const count = 26;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      const ang = (i / count) * Math.PI * 2;
      const r = 0.5 + Math.random() * (halfW + halfD) * 0.5;
      mesh.position.set(Math.cos(ang) * 0.5, worldY, Math.sin(ang) * 0.5);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vel: new THREE.Vector3(
          Math.cos(ang) * r * (0.6 + Math.random()),
          1.5 + Math.random() * 3,
          Math.sin(ang) * r * (0.6 + Math.random()),
        ),
        life: 0,
        maxLife: 0.7 + Math.random() * 0.4,
      });
    }
  }

  update(dt: number): void {
    // Particles.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 9 * dt; // gravity
      p.mesh.position.addScaledVector(p.vel, dt);
      const t = 1 - p.life / p.maxLife;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = t;
      const s = 0.5 + t * 0.5;
      p.mesh.scale.setScalar(s);
    }

    // Layer flashes.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life += dt;
      if (f.life >= f.maxLife) {
        this.scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        f.mesh.geometry.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - f.life / f.maxLife);
    }
  }

  clear(): void {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    for (const f of this.flashes) {
      this.scene.remove(f.mesh);
      (f.mesh.material as THREE.Material).dispose();
      f.mesh.geometry.dispose();
    }
    this.particles = [];
    this.flashes = [];
  }
}
