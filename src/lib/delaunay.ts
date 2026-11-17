import type { SurveyPoint, Triangle } from './types.ts';

/**
 * 手写 Bowyer–Watson Delaunay 三角剖分（增量插入法）。
 *
 * 流程：
 *  1. 构造一个包围全部测点的超级三角形；
 *  2. 逐点插入：找出所有外接圆包含新点的三角形（“坏三角形”），
 *     删除后沿其空腔边界重新与新点连三角；
 *  3. 删除所有引用超级三角形顶点的三角形；
 *  4. 重排索引并重建邻接关系 / 边界标记。
 *
 * 测点为规则网格时本实现同样适用（退化情形由 inCircle 的严格判定与
 * 插入前去重共同处理）。
 */

interface WorkTri {
  ia: number;
  ib: number;
  ic: number;
  /** 外接圆心与半径平方（2D，忽略 z） */
  cx: number;
  cy: number;
  r2: number;
  alive: boolean;
}

function circumcircle(p: SurveyPoint[], ia: number, ib: number, ic: number) {
  const ax = p[ia].x;
  const ay = p[ia].y;
  const bx = p[ib].x;
  const by = p[ib].y;
  const cx = p[ic].x;
  const cy = p[ic].y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const dx = ax - ux;
  const dy = ay - uy;
  return { cx: ux, cy: uy, r2: dx * dx + dy * dy };
}

/** 去重：同一 xy（容差 1mm）只保留首个点，返回紧凑数组。 */
export function dedupe(points: SurveyPoint[]): SurveyPoint[] {
  const out: SurveyPoint[] = [];
  for (const pt of points) {
    let dup = false;
    for (const q of out) {
      const dx = pt.x - q.x;
      const dy = pt.y - q.y;
      if (dx * dx + dy * dy < 1e-6) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push(pt);
  }
  return out;
}

export interface DelaunayResult {
  points: SurveyPoint[];
  triangles: Triangle[];
}

export function delaunay(rawPoints: SurveyPoint[]): DelaunayResult {
  const points = dedupe(rawPoints);
  if (points.length < 3) throw new Error('Delaunay 至少需要 3 个不重合测点');

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
  const dx = maxX - minX;
  const dy = maxY - minY;
  const span = Math.max(dx, dy, 1);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  // 超级三角形：足够大且远离测点，保证其外接圆不干扰最终结果
  const M = 20 * span;
  const s0: SurveyPoint = { x: midX - M, y: midY - M, z: 0 };
  const s1: SurveyPoint = { x: midX + M, y: midY - M, z: 0 };
  const s2: SurveyPoint = { x: midX, y: midY + M, z: 0 };
  const all = [...points, s0, s1, s2];
  const i0 = all.length - 3;
  const i1 = all.length - 2;
  const i2 = all.length - 1;

  const cc = circumcircle(all, i0, i1, i2);
  const tris: WorkTri[] = [
    { ia: i0, ib: i1, ic: i2, cx: cc.cx, cy: cc.cy, r2: cc.r2, alive: true },
  ];

  for (let ip = 0; ip < points.length; ip++) {
    const px = points[ip].x;
    const py = points[ip].y;
    const bad: number[] = [];
    for (let t = 0; t < tris.length; t++) {
      const tri = tris[t];
      if (!tri.alive) continue;
      const ddx = px - tri.cx;
      const ddy = py - tri.cy;
      // 点在闭合外接圆内（含圆上，严格处理共圆退化）
      if (ddx * ddx + ddy * ddy <= tri.r2 + 1e-12) {
        tri.alive = false;
        bad.push(t);
      }
    }

    // 统计坏三角形各边出现次数：只出现 1 次的边就是空腔边界
    const edges = new Map<string, { u: number; v: number; count: number }>();
    const addEdge = (u: number, v: number) => {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      const e = edges.get(key);
      if (e) e.count++;
      else edges.set(key, { u, v, count: 1 });
    };
    for (const t of bad) {
      const tri = tris[t];
      addEdge(tri.ia, tri.ib);
      addEdge(tri.ib, tri.ic);
      addEdge(tri.ic, tri.ia);
    }

    for (const e of edges.values()) {
      if (e.count !== 1) continue;
      const c = circumcircle(all, e.u, e.v, ip);
      tris.push({
        ia: e.u,
        ib: e.v,
        ic: ip,
        cx: c.cx,
        cy: c.cy,
        r2: c.r2,
        alive: true,
      });
    }
  }

  // 剔除超级三角形顶点并压缩索引
  const remap = new Map<number, number>();
  const kept: WorkTri[] = [];
  for (const tri of tris) {
    if (!tri.alive) continue;
    if (tri.ia >= i0 || tri.ib >= i0 || tri.ic >= i0) continue;
    for (const idx of [tri.ia, tri.ib, tri.ic]) {
      if (!remap.has(idx)) remap.set(idx, remap.size);
    }
    kept.push(tri);
  }

  const finalPts: SurveyPoint[] = [];
  for (const [oldIdx] of remap) finalPts.push(all[oldIdx]);

  const result: Triangle[] = kept.map((t) => ({
    a: remap.get(t.ia)!,
    b: remap.get(t.ib)!,
    c: remap.get(t.ic)!,
    nAB: -1,
    nBC: -1,
    nCA: -1,
    boundaryAB: false,
    boundaryBC: false,
    boundaryCA: false,
  }));

  buildAdjacency(result);
  return { points: finalPts, triangles: result };
}

const edgeKey = (u: number, v: number) => (u < v ? `${u}_${v}` : `${v}_${u}`);

/** 重建三角形邻接表与边界边标记。 */
export function buildAdjacency(tris: Triangle[]): void {
  const edgeOwner = new Map<string, { tri: number; edge: 0 | 1 | 2 }[]>();
  const record = (u: number, v: number, tri: number, edge: 0 | 1 | 2) => {
    const key = edgeKey(u, v);
    const list = edgeOwner.get(key);
    if (list) list.push({ tri, edge });
    else edgeOwner.set(key, [{ tri, edge }]);
  };
  tris.forEach((t, i) => {
    record(t.a, t.b, i, 0);
    record(t.b, t.c, i, 1);
    record(t.c, t.a, i, 2);
  });

  for (const owners of edgeOwner.values()) {
    if (owners.length === 1) {
      const o = owners[0];
      const t = tris[o.tri];
      if (o.edge === 0) t.boundaryAB = true;
      else if (o.edge === 1) t.boundaryBC = true;
      else t.boundaryCA = true;
    } else if (owners.length === 2) {
      const [o1, o2] = owners;
      const t1 = tris[o1.tri];
      const t2 = tris[o2.tri];
      if (o1.edge === 0) t1.nAB = o2.tri;
      else if (o1.edge === 1) t1.nBC = o2.tri;
      else t1.nCA = o2.tri;
      if (o2.edge === 0) t2.nAB = o1.tri;
      else if (o2.edge === 1) t2.nBC = o1.tri;
      else t2.nCA = o1.tri;
    }
  }
}
