import { delaunay, type Triangle } from './delaunay';
import type { ElevPoint, Vec2 } from './types';

/**
 * 果岭曲面:由离散高程点三角剖分后得到的线性插值曲面。
 * 提供高度/坡度查询、等高线提取。
 */
export class GreenSurface {
  readonly points: ElevPoint[];
  readonly triangles: Triangle[];
  /** 每个三角形中心的坡度向量(∂z/∂x, ∂z/∂y),即平面梯度 */
  readonly triGradients: Vec2[];
  /** 每个顶点的坡度向量(相邻三角形梯度按面积加权平均) */
  readonly vertexGradients: Vec2[];
  private cellIndex: Map<string, number[]> = new Map();
  private cellSize: number;
  readonly minX: number; readonly minY: number;
  readonly maxX: number; readonly maxY: number;
  readonly minZ: number; readonly maxZ: number;

  constructor(points: ElevPoint[]) {
    this.points = points;
    this.triangles = delaunay(points);
    this.triGradients = this.triangles.map(t => this.triangleGradient(t));
    this.vertexGradients = this.computeVertexGradients();

    const xs = points.map(p => p.x), ys = points.map(p => p.y), zs = points.map(p => p.z);
    this.minX = Math.min(...xs); this.maxX = Math.max(...xs);
    this.minY = Math.min(...ys); this.maxY = Math.max(...ys);
    this.minZ = Math.min(...zs); this.maxZ = Math.max(...zs);

    // 空间索引:按包围盒把三角形放进网格,加速点定位
    const cellSize = Math.max(this.maxX - this.minX, this.maxY - this.minY) / 24 || 1;
    this.cellSize = cellSize;
    this.cellIndex = new Map();
    for (let i = 0; i < this.triangles.length; i++) {
      const t = this.triangles[i];
      const xs2 = [this.points[t.a].x, this.points[t.b].x, this.points[t.c].x];
      const ys2 = [this.points[t.a].y, this.points[t.b].y, this.points[t.c].y];
      const x0 = Math.floor(Math.min(...xs2) / cellSize), x1 = Math.floor(Math.max(...xs2) / cellSize);
      const y0 = Math.floor(Math.min(...ys2) / cellSize), y1 = Math.floor(Math.max(...ys2) / cellSize);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        const arr = this.cellIndex.get(key);
        if (arr) arr.push(i); else this.cellIndex.set(key, [i]);
      }
    }
  }

  private triangleGradient(t: Triangle): Vec2 {
    const a = this.points[t.a], b = this.points[t.b], c = this.points[t.c];
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    // 法线 = u × v,梯度 = (dz/dx, dz/dy) = (-nx/nz, -ny/nz)
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (Math.abs(nz) < 1e-12) return { x: 0, y: 0 };
    return { x: -nx / nz, y: -ny / nz };
  }

  private computeVertexGradients(): Vec2[] {
    const acc = this.points.map(() => ({ x: 0, y: 0, w: 0 }));
    for (let i = 0; i < this.triangles.length; i++) {
      const t = this.triangles[i];
      const area = Math.abs(
        (this.points[t.b].x - this.points[t.a].x) * (this.points[t.c].y - this.points[t.a].y) -
        (this.points[t.c].x - this.points[t.a].x) * (this.points[t.b].y - this.points[t.a].y)
      ) / 2;
      const g = this.triGradients[i];
      for (const vi of [t.a, t.b, t.c]) {
        acc[vi].x += g.x * area; acc[vi].y += g.y * area; acc[vi].w += area;
      }
    }
    return acc.map(g => g.w > 0 ? { x: g.x / g.w, y: g.y / g.w } : { x: 0, y: 0 });
  }

  /** 找到包含 (x,y) 的三角形索引,找不到返回 -1 */
  locateTriangle(x: number, y: number): number {
    const key = `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
    const candidates = this.cellIndex.get(key);
    if (!candidates) return -1;
    for (const ti of candidates) {
      const t = this.triangles[ti];
      if (pointInTriangle(x, y, this.points[t.a], this.points[t.b], this.points[t.c])) return ti;
    }
    return -1;
  }

  /** 插值高度,在凸包外返回 null */
  heightAt(x: number, y: number): number | null {
    const ti = this.locateTriangle(x, y);
    if (ti < 0) return null;
    const t = this.triangles[ti];
    const b = barycentric(x, y, this.points[t.a], this.points[t.b], this.points[t.c]);
    return b[0] * this.points[t.a].z + b[1] * this.points[t.b].z + b[2] * this.points[t.c].z;
  }

  /** 坡度向量(∂z/∂x, ∂z/∂y)。三角形内为常数,顶点处用顶点梯度 */
  gradientAt(x: number, y: number): Vec2 | null {
    const ti = this.locateTriangle(x, y);
    if (ti < 0) return null;
    return this.triGradients[ti];
  }

  /** 坡度百分比 = |∇z| * 100 */
  slopePercentAt(x: number, y: number): number | null {
    const g = this.gradientAt(x, y);
    if (!g) return null;
    return Math.hypot(g.x, g.y) * 100;
  }

  /**
   * 提取等高线(行进三角形法)。
   * @param interval 等高距(米)
   * @returns 每个高程等级对应一组线段 [[x1,y1,x2,y2], ...]
   */
  contours(interval: number): { level: number; segments: [number, number, number, number][] }[] {
    const result: { level: number; segments: [number, number, number, number][] }[] = [];
    const start = Math.ceil(this.minZ / interval) * interval;
    for (let level = start; level <= this.maxZ; level += interval) {
      const segs: [number, number, number, number][] = [];
      for (const t of this.triangles) {
        const pts = [this.points[t.a], this.points[t.b], this.points[t.c]];
        const crossings: [number, number][] = [];
        for (let i = 0; i < 3; i++) {
          const a = pts[i], b = pts[(i + 1) % 3];
          const d1 = a.z - level, d2 = b.z - level;
          if (d1 === 0 && d2 === 0) continue; // 边与等高线重合,跳过
          if ((d1 < 0 && d2 > 0) || (d1 > 0 && d2 < 0)) {
            const t2 = d1 / (d1 - d2);
            crossings.push([a.x + (b.x - a.x) * t2, a.y + (b.y - a.y) * t2]);
          } else if (d1 === 0 && d2 !== 0) {
            crossings.push([a.x, a.y]);
          }
        }
        if (crossings.length === 2) {
          segs.push([crossings[0][0], crossings[0][1], crossings[1][0], crossings[1][1]]);
        }
      }
      if (segs.length > 0) result.push({ level, segments: segs });
    }
    return result;
  }

  /**
   * 下坡箭头采样:在规则网格上取点,返回下坡方向单位向量与坡度。
   */
  downhillArrows(spacing: number): { x: number; y: number; z: number; dirX: number; dirY: number; slopePct: number }[] {
    const arrows: { x: number; y: number; z: number; dirX: number; dirY: number; slopePct: number }[] = [];
    for (let x = this.minX + spacing / 2; x < this.maxX; x += spacing) {
      for (let y = this.minY + spacing / 2; y < this.maxY; y += spacing) {
        const g = this.gradientAt(x, y);
        const z = this.heightAt(x, y);
        if (!g || z === null) continue;
        const mag = Math.hypot(g.x, g.y);
        if (mag < 1e-6) continue;
        arrows.push({ x, y, z, dirX: -g.x / mag, dirY: -g.y / mag, slopePct: mag * 100 });
      }
    }
    return arrows;
  }
}

function barycentric(x: number, y: number, a: ElevPoint, b: ElevPoint, c: ElevPoint): [number, number, number] {
  const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  const w1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d;
  const w2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d;
  return [w1, w2, 1 - w1 - w2];
}

function pointInTriangle(x: number, y: number, a: ElevPoint, b: ElevPoint, c: ElevPoint): boolean {
  const [w1, w2, w3] = barycentric(x, y, a, b, c);
  const eps = -1e-9;
  return w1 >= eps && w2 >= eps && w3 >= eps;
}
