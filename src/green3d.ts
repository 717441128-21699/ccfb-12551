import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GreenSurface } from './surface';
import type { TurfSettings } from './types';
import { effectiveStimpmeter } from './stimpmeter';

/** 坡度百分比 → 颜色(0% 绿 → 2% 黄绿 → 4% 橙 → ≥6% 红) */
export function slopeColor(pct: number): THREE.Color {
  const stops: [number, THREE.Color][] = [
    [0, new THREE.Color('#2e8b3a')],
    [2, new THREE.Color('#a8c832')],
    [4, new THREE.Color('#e08a1e')],
    [6, new THREE.Color('#c22f1e')],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (pct <= stops[i][0]) {
      const t = (pct - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return stops[i - 1][1].clone().lerp(stops[i][1], t);
    }
  }
  return stops[stops.length - 1][1].clone();
}

export interface SceneOptions {
  contourInterval: number; // 米
  showContours: boolean;
  showArrows: boolean;
  timeOfDay: number; // 6–19 时
  exaggeration: number; // 高程夸张倍数
}

export class GreenScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private surface: GreenSurface | null = null;
  private greenGroup = new THREE.Group();
  private overlayGroup = new THREE.Group(); // 等高线/箭头
  private puttGroup = new THREE.Group();    // 推杆轨迹/球/洞
  private opts: SceneOptions;
  private center = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private mesh: THREE.Mesh | null = null;
  private animId = 0;
  private onResize = () => this.resize();

  constructor(private container: HTMLElement, opts: SceneOptions) {
    this.opts = { ...opts };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#b8d4e8');
    this.scene.fog = new THREE.Fog('#b8d4e8', 60, 220);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    // 触屏:单指旋转,双指缩放/平移(OrbitControls 默认即支持)

    this.sun = new THREE.DirectionalLight('#fff5e0', 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.ambient = new THREE.AmbientLight('#cfe4ff', 0.9);
    this.scene.add(this.sun, this.ambient, this.greenGroup, this.overlayGroup, this.puttGroup);

    // 地面
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(150, 48),
      new THREE.MeshLambertMaterial({ color: '#4a7c3f' }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.35;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.resize();
    window.addEventListener('resize', this.onResize);
    this.setTimeOfDay(opts.timeOfDay);
    this.animate();
  }

  dispose() {
    cancelAnimationFrame(this.animId);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = () => {
    this.animId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  /** 由曲面重建果岭网格与覆盖物 */
  buildSurface(surface: GreenSurface) {
    this.surface = surface;
    this.greenGroup.clear();
    this.overlayGroup.clear();
    this.puttGroup.clear();

    const ex = this.opts.exaggeration;
    const cx = (surface.minX + surface.maxX) / 2;
    const cy = (surface.minY + surface.maxY) / 2;
    const cz = (surface.minZ + surface.maxZ) / 2;
    this.center.set(cx, cz * ex, cy);

    // 顶点:索引化,法线用顶点梯度反推,颜色按顶点坡度
    const n = surface.points.length;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = surface.points[i];
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.z * ex;
      positions[i * 3 + 2] = p.y;
      const g = surface.vertexGradients[i];
      const inv = 1 / Math.hypot(g.x, 1, g.y);
      normals[i * 3] = -g.x * inv;
      normals[i * 3 + 1] = inv;
      normals[i * 3 + 2] = -g.y * inv;
      const c = slopeColor(Math.hypot(g.x, g.y) * 100);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    const indices: number[] = [];
    for (const t of surface.triangles) indices.push(t.a, t.b, t.c);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.greenGroup.add(this.mesh);

    // 裙边:果岭边缘垂下一圈,视觉上更立体
    this.addSkirt(surface, ex);

    // 相机取景
    const size = Math.max(surface.maxX - surface.minX, surface.maxY - surface.minY);
    this.camera.position.set(cx, cz * ex + size * 1.1, cy + size * 0.9);
    this.controls.target.copy(this.center);
    this.controls.update();

    // 阴影相机范围
    const r = size * 0.9;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 300 });
    this.sun.shadow.camera.updateProjectionMatrix();

    this.rebuildOverlays();
  }

  private addSkirt(surface: GreenSurface, ex: number) {
    // 找边界边(只属于一个三角形的边)
    const edgeCount = new Map<string, [number, number, number]>();
    const add = (i: number, j: number) => {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      const e = edgeCount.get(key);
      if (e) e[2]++;
      else edgeCount.set(key, [i, j, 1]);
    };
    for (const t of surface.triangles) { add(t.a, t.b); add(t.b, t.c); add(t.c, t.a); }
    const pos: number[] = [];
    const col: number[] = [];
    const skirtColor = new THREE.Color('#3d6b33');
    for (const [i, j, count] of edgeCount.values()) {
      if (count !== 1) continue;
      const a = surface.points[i], b = surface.points[j];
      const y0 = Math.min(surface.minZ * ex, 0) - 0.3;
      pos.push(a.x, a.z * ex, a.y, b.x, b.z * ex, b.y, b.x, y0, b.y);
      pos.push(a.x, a.z * ex, a.y, b.x, y0, b.y, a.x, y0, a.y);
      for (let k = 0; k < 12; k++) col.push(skirtColor.r, skirtColor.g, skirtColor.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    geo.computeVertexNormals();
    const skirt = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.greenGroup.add(skirt);
  }

  /** 重建等高线与下坡箭头 */
  rebuildOverlays() {
    if (!this.surface) return;
    this.overlayGroup.clear();
    const ex = this.opts.exaggeration;
    const lift = 0.03; // 抬高避免 z-fighting

    if (this.opts.showContours) {
      const contours = this.surface.contours(this.opts.contourInterval);
      const pos: number[] = [];
      const col: number[] = [];
      const major = new THREE.Color('#ffffff');
      const minor = new THREE.Color('#e8e0c8');
      const majorEvery = 5;
      contours.forEach((c, idx) => {
        const color = idx % majorEvery === 0 ? major : minor;
        for (const [x1, y1, x2, y2] of c.segments) {
          const z1 = c.level * ex + lift, z2 = c.level * ex + lift;
          pos.push(x1, z1, y1, x2, z2, y2);
          col.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
      this.overlayGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
    }

    if (this.opts.showArrows) {
      const spacing = Math.max(this.surface.maxX - this.surface.minX, this.surface.maxY - this.surface.minY) / 12;
      const arrows = this.surface.downhillArrows(spacing);
      const group = new THREE.Group();
      for (const a of arrows) {
        const len = 0.35 + Math.min(a.slopePct / 6, 1) * 0.55;
        const dir = new THREE.Vector3(a.dirX, 0, a.dirY).normalize();
        const origin = new THREE.Vector3(a.x, a.z * ex + 0.06, a.y);
        const arrow = new THREE.ArrowHelper(dir, origin, len, '#1a1a4a', len * 0.35, len * 0.2);
        group.add(arrow);
      }
      this.overlayGroup.add(group);
    }
  }

  setOptions(opts: Partial<SceneOptions>) {
    Object.assign(this.opts, opts);
    if (opts.timeOfDay !== undefined) this.setTimeOfDay(opts.timeOfDay);
    if (opts.exaggeration !== undefined && this.surface) this.buildSurface(this.surface);
    else this.rebuildOverlays();
  }

  /** 太阳位置随时刻变化(简化太阳轨迹:6 点日出,12 点最高,19 点落山) */
  setTimeOfDay(hour: number) {
    const t = (hour - 6) / 13; // 0 → 1
    const elev = Math.sin(Math.PI * t) * (Math.PI / 2.4); // 最大 ~75°
    const azim = Math.PI * (0.15 + 0.7 * t); // 东 → 西
    const dist = 80;
    const y = Math.sin(elev) * dist;
    const horiz = Math.cos(elev) * dist;
    this.sun.position.set(
      this.center.x + Math.cos(azim) * horiz,
      Math.max(y, 2),
      this.center.z + Math.sin(azim) * horiz,
    );
    this.sun.target.position.copy(this.center);
    this.sun.target.updateMatrixWorld();
    // 早晚光色偏暖、强度低
    const warmth = 1 - Math.sin(Math.PI * t);
    this.sun.color.setHSL(0.1 - 0.04 * (1 - warmth), 0.5 * warmth + 0.1, 0.85);
    this.sun.intensity = 1.2 + Math.sin(Math.PI * t) * 2.0;
    this.ambient.intensity = 0.5 + Math.sin(Math.PI * t) * 0.5;
  }

  /** 屏幕坐标 → 果岭表面点(局部坐标),未命中返回 null */
  pickSurface(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    if (!this.mesh || !this.surface) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.mesh);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    return { x: p.x, y: p.z, z: p.y / this.opts.exaggeration };
  }

  /** 画球位/洞位标记 */
  setMarkers(ball: { x: number; y: number } | null, hole: { x: number; y: number } | null) {
    if (!this.surface) return;
    // 清掉旧标记(保留轨迹线)
    const toRemove = this.puttGroup.children.filter(c => c.userData.marker);
    toRemove.forEach(c => this.puttGroup.remove(c));
    const ex = this.opts.exaggeration;
    if (ball) {
      const z = this.surface.heightAt(ball.x, ball.y);
      if (z !== null) {
        const s = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 24, 16),
          new THREE.MeshPhongMaterial({ color: '#ffffff' }),
        );
        s.position.set(ball.x, z * ex + 0.11, ball.y);
        s.castShadow = true;
        s.userData.marker = true;
        this.puttGroup.add(s);
      }
    }
    if (hole) {
      const z = this.surface.heightAt(hole.x, hole.y);
      if (z !== null) {
        const cup = new THREE.Mesh(
          new THREE.CylinderGeometry(0.054, 0.054, 0.02, 24),
          new THREE.MeshBasicMaterial({ color: '#111111' }),
        );
        cup.position.set(hole.x, z * ex + 0.015, hole.y);
        cup.userData.marker = true;
        this.puttGroup.add(cup);
        const flag = new THREE.Mesh(
          new THREE.CylinderGeometry(0.008, 0.008, 1.6, 8),
          new THREE.MeshPhongMaterial({ color: '#dddddd' }),
        );
        flag.position.set(hole.x, z * ex + 0.8, hole.y);
        flag.castShadow = true;
        flag.userData.marker = true;
        this.puttGroup.add(flag);
        const pennant = new THREE.Mesh(
          new THREE.PlaneGeometry(0.35, 0.22),
          new THREE.MeshBasicMaterial({ color: '#e33', side: THREE.DoubleSide }),
        );
        pennant.position.set(hole.x + 0.18, z * ex + 1.45, hole.y);
        pennant.userData.marker = true;
        this.puttGroup.add(pennant);
      }
    }
  }

  /** 画推杆轨迹 */
  showPuttPath(points: { x: number; y: number; z: number }[] | null) {
    const old = this.puttGroup.children.filter(c => c.userData.path);
    old.forEach(c => this.puttGroup.remove(c));
    if (!points || points.length < 2) return;
    const ex = this.opts.exaggeration;
    const pos: number[] = [];
    for (const p of points) pos.push(p.x, p.z * ex + 0.05, p.y);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ff2d78' }));
    line.userData.path = true;
    this.puttGroup.add(line);
  }

  /** 截图:渲染帧 + 图例合成 PNG */
  screenshot(meta: { greenName: string; contourInterval: number; turf: TurfSettings; timeOfDay: number }) {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    const legendH = 96;
    out.width = src.width;
    out.height = src.height + legendH * (src.width / src.clientWidth || 1);
    const scale = src.width / (src.clientWidth || src.width);
    const lh = legendH * scale;
    out.height = src.height + lh;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, 0, 0);

    // 图例背景
    ctx.fillStyle = 'rgba(12, 24, 16, 0.92)';
    ctx.fillRect(0, src.height, out.width, lh);
    const pad = 14 * scale;
    const fs = 13 * scale;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${15 * scale}px system-ui, sans-serif`;
    ctx.fillText(`${meta.greenName}  坡度图`, pad, src.height + pad + fs);
    ctx.font = `${fs}px system-ui, sans-serif`;
    ctx.fillText(
      `等高距 ${meta.contourInterval.toFixed(2)} m · 斯坦普 ${effectiveStimpmeter(meta.turf).toFixed(1)} ft · ` +
      `修剪 ${meta.turf.mowingHeightMm.toFixed(1)} mm · ${meta.timeOfDay.toFixed(0)}:00`,
      pad, src.height + pad + fs * 2.4,
    );

    // 坡度色标
    const barX = pad, barY = src.height + pad + fs * 3.4;
    const barW = Math.min(320 * scale, out.width - pad * 2 - 90 * scale);
    const barH = 12 * scale;
    for (let i = 0; i < barW; i++) {
      const c = slopeColor((i / barW) * 6);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(barX + i, barY, 1, barH);
    }
    ctx.fillStyle = '#fff';
    ctx.fillText('0%', barX, barY + barH + fs);
    ctx.fillText('3%', barX + barW / 2 - 8 * scale, barY + barH + fs);
    ctx.fillText('≥6%', barX + barW - 24 * scale, barY + barH + fs);
    ctx.fillText('↓ 箭头指向下坡方向', barX + barW + 20 * scale, barY + barH);

    const a = document.createElement('a');
    a.download = `${meta.greenName}-坡度图.png`;
    a.href = out.toDataURL('image/png');
    a.click();
  }
}
