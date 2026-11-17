import type { Barycentric, SlopeInfo, SurveyPoint, Triangle, Vec2, Vec3 } from './types.ts';

/**
 * 基于 Delaunay TIN 的地形模型：
 *  - 空间哈希 + 邻接行走做快速点位定位；
 *  - 重心坐标做线性高程插值（三角形内部即平面，坡度解析精确）；
 *  - 支持等值线提取，供图例与等高线打印对照。
 */
export class Terrain {
  readonly points: SurveyPoint[];
  readonly triangles: Triangle[];
  readonly bounds: { minX: number; maxX: number; minY: number; maxY: number };
  private readonly cell: number;
  private readonly grid = new Map<string, number[]>();
  private readonly originX: number;
  private readonly originY: number;
  private hull: Vec2[] | null = null;

  constructor(points: SurveyPoint[], triangles: Triangle[]) {
    if (points.length < 3) throw new Error('地形至少需要 3 个测点');
    this.points = points;
    this.triangles = triangles;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    this.bounds = { minX, maxX, minY, maxY };
    this.originX = minX;
    this.originY = minY;

    // 网格尺寸取测点平均间距量级，使每格只覆盖少量三角形
    const area = (maxX - minX) * (maxY - minY);
    this.cell = Math.max(Math.sqrt(area / points.length), 1e-6);

    triangles.forEach((t, i) => this.registerTri(t, i));
  }

  private cellKey(cx: number, cy: number) {
    return `${cx},${cy}`;
  }

  private registerTri(t: Triangle, idx: number) {
    const touched = new Set<string>();
    for (const vi of [t.a, t.b, t.c]) {
      const p = this.points[vi];
      const cx = Math.floor((p.x - this.originX) / this.cell);
      const cy = Math.floor((p.y - this.originY) / this.cell);
      touched.add(this.cellKey(cx, cy));
    }
    for (const key of touched) {
      const list = this.grid.get(key);
      if (list) list.push(idx);
      else this.grid.set(key, [idx]);
    }
  }

  /** 重心坐标；点在三角形外时返回 null。 */
  private barycentric(t: Triangle, x: number, y: number): Barycentric | null {
    const A = this.points[t.a];
    const B = this.points[t.b];
    const C = this.points[t.c];
    const den = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(den) < 1e-15) return null;
    const wA = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / den;
    const wB = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / den;
    const wC = 1 - wA - wB;
    const eps = 1e-9;
    if (wA < -eps || wB < -eps || wC < -eps) return null;
    return {
      tri: this.triangles.indexOf(t),
      wA: Math.max(0, wA),
      wB: Math.max(0, wB),
      wC: Math.max(0, wC),
    };
  }

  /** 点是否在 TIN 凸包内（边界含），用于哈希未命中时快速判定。 */
  private inHull(x: number, y: number): boolean {
    if (!this.hull) this.hull = this.boundaryLoop();
    const loop = this.hull;
    if (loop.length < 3) return false;
    // boundaryLoop 按边界边正向串联，先统一为逆时针
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      area += a.x * b.y - b.x * a.y;
    }
    const ccw = area > 0;
    let inside = true;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (ccw ? cross < -1e-9 : cross > 1e-9) {
        inside = false;
        break;
      }
    }
    return inside;
  }

  /** 定位点所在三角形；TIN 外返回 null。 */
  locate(x: number, y: number): Barycentric | null {
    const cx = Math.floor((x - this.originX) / this.cell);
    const cy = Math.floor((y - this.originY) / this.cell);
    const checked = new Set<number>();
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const list = this.grid.get(this.cellKey(gx, gy));
        if (!list) continue;
        for (const ti of list) {
          if (checked.has(ti)) continue;
          checked.add(ti);
          const b = this.barycentric(this.triangles[ti], x, y);
          if (b) return b;
        }
      }
    }
    // 哈希落空：凸包外直接判出界；凸包内（网格边缘等）全量兜底一次
    if (!this.inHull(x, y)) return null;
    for (let ti = 0; ti < this.triangles.length; ti++) {
      if (checked.has(ti)) continue;
      const b = this.barycentric(this.triangles[ti], x, y);
      if (b) return b;
    }
    return null;
  }

  /** 最近测点（用于 TIN 外的兜底取值）。 */
  nearestPoint(x: number, y: number): { index: number; dist: number } {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.points.length; i++) {
      const dx = this.points[i].x - x;
      const dy = this.points[i].y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, dist: Math.sqrt(bestD) };
  }

  /** 线性插值高程；TIN 外返回 null。 */
  heightAt(x: number, y: number): number | null {
    const b = this.locate(x, y);
    if (!b) return null;
    const t = this.triangles[b.tri];
    return (
      this.points[t.a].z * b.wA +
      this.points[t.b].z * b.wB +
      this.points[t.c].z * b.wC
    );
  }

  /** 三角形平面单位法向（朝上）与平面方程系数。 */
  planeAt(triIndex: number): { normal: Vec3; d: number } {
    const t = this.triangles[triIndex];
    const A = this.points[t.a];
    const B = this.points[t.b];
    const C = this.points[t.c];
    const ux = B.x - A.x;
    const uy = B.y - A.y;
    const uz = B.z - A.z;
    const vx = C.x - A.x;
    const vy = C.y - A.y;
    const vz = C.z - A.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    if (nz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    // 平面: nx*x + ny*y + nz*z + d = 0
    const d = -(nx * A.x + ny * A.y + nz * A.z);
    return { normal: { x: nx, y: ny, z: nz }, d };
  }

  /** 坡度信息（三角形内为常量，等价于该平面的解析坡度）。 */
  slopeAt(x: number, y: number): SlopeInfo | null {
    const b = this.locate(x, y);
    if (!b) return null;
    const { normal } = this.planeAt(b.tri);
    const horiz = Math.hypot(normal.x, normal.y);
    const percent = (horiz / normal.z) * 100;
    const degrees = (Math.atan2(horiz, normal.z) * 180) / Math.PI;
    // 高度梯度 grad h = (−nx/nz, −ny/nz) 指向上坡，故下坡取其负方向
    const gx = -normal.x / normal.z;
    const gy = -normal.y / normal.z;
    const gLen = Math.hypot(gx, gy);
    const downhill: Vec2 = gLen > 1e-12 ? { x: -gx / gLen, y: -gy / gLen } : { x: 0, y: 0 };
    const aspectDeg = (Math.atan2(downhill.y, downhill.x) * 180) / Math.PI;
    return { percent, degrees, downhill, normal, aspectDeg };
  }

  /** TIN 凸包边界环（逆时针顶点序列，2D）。 */
  boundaryLoop(): Vec2[] {
    const edges: [Vec2, Vec2][] = [];
    for (const t of this.triangles) {
      if (t.boundaryAB) edges.push([this.points[t.a], this.points[t.b]]);
      if (t.boundaryBC) edges.push([this.points[t.b], this.points[t.c]]);
      if (t.boundaryCA) edges.push([this.points[t.c], this.points[t.a]]);
    }
    if (edges.length === 0) return [];
    const map = new Map<string, Vec2>();
    const key = (p: Vec2) => `${p.x.toFixed(6)}_${p.y.toFixed(6)}`;
    for (const [u, v] of edges) {
      map.set(key(u), v);
    }
    const start = edges[0][0];
    const loop: Vec2[] = [start];
    let cur = start;
    for (let i = 0; i < edges.length; i++) {
      const next = map.get(key(cur));
      if (!next) break;
      loop.push(next);
      cur = next;
    }
    return loop;
  }

  /**
   * 等值线提取：逐三角形做平面与水平面 z=level 的求交，
   * 返回若干折线段（顶点带三维坐标，可直接贴地渲染）。
   */
  contours(level: number): Vec3[][] {
    const lines: Vec3[][] = [];
    const z = (i: number) => this.points[i].z;
    const p = (i: number) => this.points[i];
    const interp = (i: number, j: number): Vec3 => {
      const t = (level - z(i)) / (z(j) - z(i));
      const a = p(i);
      const b = p(j);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: level,
      };
    };
    for (const tri of this.triangles) {
      const vals = [
        { i: tri.a, v: z(tri.a) - level },
        { i: tri.b, v: z(tri.b) - level },
        { i: tri.c, v: z(tri.c) - level },
      ];
      const cross: Vec3[] = [];
      for (let k = 0; k < 3; k++) {
        const e1 = vals[k];
        const e2 = vals[(k + 1) % 3];
        if (e1.v === 0) cross.push(p(e1.i));
        else if (e1.v * e2.v < 0) cross.push(interp(e1.i, e2.i));
      }
      if (cross.length >= 2) lines.push(cross.slice(0, 2));
    }
    return lines;
  }
}
