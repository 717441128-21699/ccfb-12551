import * as THREE from 'three';
import type { Terrain } from '../lib/terrain.ts';
import type { SlopeInfo } from '../lib/types.ts';
import { sunPosition } from '../lib/sun.ts';

export interface SceneOptions {
  latitude: number;
  longitude: number;
  utcOffset: number;
}

const LINE_COLORS = {
  light: 0x2ecc71,
  medium: 0xf1c40f,
  heavy: 0xe74c3c,
} as const;

/** 三维果岭场景：TIN 地形、下坡箭头、太阳光照与阴影贴图。 */
export class GreenScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private terrainMesh: THREE.Mesh | null = null;
  private arrowMesh: THREE.InstancedMesh | null = null;
  private contourGroup = new THREE.Group();
  private lineGroup = new THREE.Group();
  private ballMarker: THREE.Mesh;
  private holeMarker: THREE.Mesh;
  private aimMarker: THREE.Group;
  private readonly opts: SceneOptions;
  private terrain: Terrain | null = null;
  private verticalScale = 4;

  constructor(container: HTMLElement, opts: SceneOptions) {
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xbfd9e8);
    this.scene.fog = new THREE.Fog(0xbfd9e8, 60, 140);

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      500,
    );
    this.camera.position.set(18, 22, 24);
    this.camera.lookAt(0, 0, 0);

    this.hemi = new THREE.HemisphereLight(0xdfeefc, 0x4a6b3d, 0.55);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 120;
    const s = 30;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 地面底板（承接阴影）
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x7fae6b, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.scene.add(this.contourGroup, this.lineGroup);

    this.ballMarker = this.makeMarker(0xffffff, 0.107, true);
    this.holeMarker = this.makeMarker(0x111111, 0.108 / 2, false);
    this.aimMarker = this.makeAimMarker();
    this.scene.add(this.ballMarker, this.holeMarker, this.aimMarker);

    new ResizeObserver(() => this.resize(container)).observe(container);
  }

  private makeMarker(color: number, radius: number, cast: boolean): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45 }),
    );
    m.castShadow = cast;
    m.visible = false;
    return m;
  }

  private makeAimMarker(): THREE.Group {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 32),
      new THREE.MeshBasicMaterial({ color: 0x0066ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 1.1, 8),
      new THREE.MeshBasicMaterial({ color: 0x0066ff }),
    );
    pole.position.y = 0.55;
    g.add(ring, pole);
    g.visible = false;
    return g;
  }

  setVerticalScale(k: number) {
    this.verticalScale = k;
    if (this.terrain) this.buildTerrain(this.terrain);
  }

  /** 由 TIN 构建地形网格（顶点 z 做垂直夸张）。 */
  buildTerrain(terrain: Terrain) {
    this.terrain = terrain;
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
    const pos: number[] = [];
    terrain.points.forEach((p) => {
      pos.push(p.x, p.z * this.verticalScale, p.y);
    });
    const idx: number[] = [];
    terrain.triangles.forEach((t) => {
      // 保证绕序使法向朝上（场景 y 向上，平面点在 xz）
      const a = terrain.points[t.a];
      const b = terrain.points[t.b];
      const c = terrain.points[t.c];
      const cr =
        (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      if (cr > 0) idx.push(t.a, t.c, t.b);
      else idx.push(t.a, t.b, t.c);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // 按坡度着色：缓坡深绿 → 陡坡浅黄
    const colors = new Float32Array(terrain.points.length * 3);
    const cLow = new THREE.Color(0x3d7a34);
    const cHigh = new THREE.Color(0xc9c25a);
    terrain.points.forEach((p, i) => {
      const s: SlopeInfo | null = terrain.slopeAt(p.x, p.y);
      const f = Math.min(1, (s?.percent ?? 0) / 8);
      const cc = cLow.clone().lerp(cHigh, f);
      colors[i * 3] = cc.r;
      colors[i * 3 + 1] = cc.g;
      colors[i * 3 + 2] = cc.b;
    });
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);

    this.buildArrows(terrain);
    this.buildContours(terrain);
  }

  /** 网格采样点上的实例化下坡箭头，朝向坡度下坡方向，颜色随坡度。 */
  private buildArrows(terrain: Terrain) {
    if (this.arrowMesh) {
      this.scene.remove(this.arrowMesh);
      this.arrowMesh.geometry.dispose();
    }
    const samples: { x: number; y: number; slope: SlopeInfo }[] = [];
    const step = Math.max(
      1.5,
      Math.min(terrain.bounds.maxX - terrain.bounds.minX, terrain.bounds.maxY - terrain.bounds.minY) / 10,
    );
    for (let x = terrain.bounds.minX + step / 2; x < terrain.bounds.maxX; x += step) {
      for (let y = terrain.bounds.minY + step / 2; y < terrain.bounds.maxY; y += step) {
        const slope = terrain.slopeAt(x, y);
        if (slope && slope.percent > 0.3) samples.push({ x, y, slope });
      }
    }
    const geo = new THREE.ConeGeometry(0.09, 0.5, 10);
    geo.translate(0, 0.25, 0);
    geo.rotateX(Math.PI / 2); // 锥尖转向 -z，默认朝向
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const mesh = new THREE.InstancedMesh(geo, mat, samples.length);
    mesh.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    samples.forEach((smp, i) => {
      const z = terrain.heightAt(smp.x, smp.y)! * this.verticalScale + 0.06;
      // 场景 xz 平面：数学 (x,y) → three (x, z)，下坡 (dx,dy) → (dx, dz)
      const dir = new THREE.Vector3(smp.slope.downhill.x, 0, smp.slope.downhill.y).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      m.compose(new THREE.Vector3(smp.x, z, smp.y), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      const f = Math.min(1, smp.slope.percent / 6);
      col.setHSL(0.33 - f * 0.3, 0.85, 0.45);
      mesh.setColorAt(i, col);
    });
    this.arrowMesh = mesh;
    this.scene.add(mesh);
  }

  /** 等高线（0.1m 间隔），与打印图对照。 */
  private buildContours(terrain: Terrain) {
    this.contourGroup.clear();
    const zs = terrain.points.map((p) => p.z);
    const min = Math.min(...zs);
    const max = Math.max(...zs);
    const interval = 0.1;
    const mat = new THREE.LineBasicMaterial({ color: 0x1f3d1b, transparent: true, opacity: 0.45 });
    for (let level = Math.ceil(min / interval) * interval; level <= max; level += interval) {
      const segs = terrain.contours(level);
      for (const seg of segs) {
        const pts = seg.map((p) => new THREE.Vector3(p.x, p.z * this.verticalScale + 0.015, p.y));
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        this.contourGroup.add(new THREE.Line(g, mat));
      }
    }
  }

  /** 时刻（当地小时，支持小数）→ 太阳位置、光色与阴影方向。 */
  setTime(localHour: number) {
    if (!this.terrain) return;
    const now = new Date();
    const date = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Math.floor(localHour) - this.opts.utcOffset,
      Math.round((localHour % 1) * 60),
      0,
    ));
    const sun = sunPosition(date, this.opts.latitude, this.opts.longitude, this.opts.utcOffset);
    const dist = 60;
    this.sun.position.set(
      sun.direction.x * dist,
      Math.max(2, sun.direction.z * dist),
      sun.direction.y * dist,
    );
    this.sun.target.position.set(0, 0, 0);
    const elev = sun.elevationDeg;
    const dayFactor = THREE.MathUtils.clamp((elev + 6) / 30, 0, 1);
    this.sun.intensity = 0.25 + 2.3 * dayFactor;
    this.sun.color.setHSL(0.11 - 0.05 * dayFactor, 0.5, 0.55 + 0.3 * dayFactor);
    this.hemi.intensity = 0.25 + 0.4 * dayFactor;
    this.renderer.toneMappingExposure = 0.85 + 0.25 * dayFactor;
  }

  setBall(p: { x: number; y: number } | null) {
    if (!p || !this.terrain) {
      this.ballMarker.visible = false;
      return;
    }
    const z = this.terrain.heightAt(p.x, p.y);
    if (z === null) return;
    this.ballMarker.visible = true;
    this.ballMarker.position.set(p.x, z * this.verticalScale + 0.107, p.y);
  }

  setHole(p: { x: number; y: number } | null) {
    if (!p || !this.terrain) {
      this.holeMarker.visible = false;
      return;
    }
    const z = this.terrain.heightAt(p.x, p.y);
    if (z === null) return;
    this.holeMarker.visible = true;
    this.holeMarker.position.set(p.x, z * this.verticalScale + 0.012, p.y);
    this.holeMarker.scale.set(1, 0.12, 1);
  }

  setAimPoint(p: { x: number; y: number } | null) {
    if (!p || !this.terrain) {
      this.aimMarker.visible = false;
      return;
    }
    const z = this.terrain.heightAt(p.x, p.y);
    if (z === null) return;
    this.aimMarker.visible = true;
    this.aimMarker.position.set(p.x, z * this.verticalScale, p.y);
  }

  /** 绘制轻/中/重三条滚动线（含果岭外段，虚线区分）。 */
  drawLines(lines: {
    light: { samples: { x: number; y: number; z: number; offGreen: boolean }[] };
    medium: { samples: { x: number; y: number; z: number; offGreen: boolean }[] };
    heavy: { samples: { x: number; y: number; z: number; offGreen: boolean }[] };
  }) {
    this.lineGroup.clear();
    (['light', 'medium', 'heavy'] as const).forEach((touch) => {
      const samples = lines[touch].samples;
      const on: THREE.Vector3[] = [];
      const off: THREE.Vector3[] = [];
      let wasOff = false;
      for (const s of samples) {
        const v = new THREE.Vector3(s.x, s.z * this.verticalScale + 0.03, s.y);
        if (s.offGreen) {
          off.push(v);
          wasOff = true;
        } else {
          on.push(v);
        }
      }
      const makeLine = (pts: THREE.Vector3[], dashed: boolean) => {
        if (pts.length < 2) return;
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = dashed
          ? new THREE.LineDashedMaterial({ color: LINE_COLORS[touch], dashSize: 0.25, gapSize: 0.15, linewidth: 2 })
          : new THREE.LineBasicMaterial({ color: LINE_COLORS[touch], linewidth: 2 });
        const line = new THREE.Line(g, mat);
        if (dashed) line.computeLineDistances();
        this.lineGroup.add(line);
      };
      makeLine(on, false);
      if (wasOff) makeLine(off, true);
    });
  }

  clearLines() {
    this.lineGroup.clear();
  }

  /** 屏幕坐标 → 地形平面射线交点（数学 x/y）。 */
  pickGround(clientX: number, clientY: number, el: HTMLElement): { x: number; y: number } | null {
    if (!this.terrain) return null;
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    if (!this.terrainMesh) return null;
    const hit = ray.intersectObject(this.terrainMesh, false)[0];
    if (!hit) return null;
    return { x: hit.point.x, y: hit.point.z };
  }

  /** 截图（保留绘制缓冲），返回 dataURL。 */
  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private resize(container: HTMLElement) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
